import fs from 'node:fs';
import { HttpError, ERROR_STATUS } from '../router.mjs';
import { scrubUrl } from '../download/index.mjs';

function scrubErrorMessage(message) {
  return String(message || 'Push failed').replace(/https?:\/\/[^\s)]+/gi, (match) => scrubUrl(match));
}

/**
 * Create the async push runner that downloads media, validates limits,
 * stores content-addressed objects, and applies completed pushes to screens.
 */
export function createPushRunner({ config, storage, state, download, metrics } = {}) {
  const maxConcurrentPushes = config?.limits?.maxConcurrentPushes ?? 3;
  const imageBytes = config?.limits?.imageBytes ?? 40 * 1024 * 1024;
  const videoBytes = config?.limits?.videoBytes ?? 500 * 1024 * 1024;
  const pushBytes = config?.limits?.pushBytes ?? 1024 * 1024 * 1024;
  const gcGraceMinutes = config?.gcGraceMinutes ?? 60;
  const pushRetentionHours = config?.pushRetentionHours ?? 24;

  let activeCount = 0;
  const activeTasks = new Set();
  const backgroundSweeps = new Set();

  function scheduleSweep() {
    const sweep = Promise.all([
      state.gcSweep(storage, { graceMinutes: gcGraceMinutes }).catch((err) => {
        console.error('gcSweep failed:', err);
      }),
      state.sweepPushes({ retentionHours: pushRetentionHours }).catch((err) => {
        console.error('sweepPushes failed:', err);
      }),
    ]).finally(() => {
      backgroundSweeps.delete(sweep);
    });
    backgroundSweeps.add(sweep);
  }

  async function runPush(pushId, { screenId, mode, title, pages, enabled = false }) {
    try {
      await state.updatePush(pushId, {
        state: 'downloading',
        progress: 0,
        pages: { done: 0, total: pages.length },
      });

      const screen = await state.getScreen(screenId);
      let totalBytes = 0;
      const items = [];

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const remainingPushBytes = pushBytes - totalBytes;
        const kindLimit =
          page.kind === 'image'
            ? imageBytes
            : page.kind === 'video'
              ? videoBytes
              : Math.max(imageBytes, videoBytes);
        const maxBytes = Math.min(kindLimit, remainingPushBytes);
        if (maxBytes <= 0) {
          throw new HttpError('TOO_LARGE', `Push exceeds ${pushBytes} byte limit`);
        }

        let dl = null;
        try {
          dl = await download.downloadPage({
            url: page.url,
            kindHint: page.kind,
            maxBytes,
          });

          const actualKindLimit = dl.kind === 'image' ? imageBytes : videoBytes;
          if (dl.size > actualKindLimit) {
            throw new HttpError('TOO_LARGE', `File is larger than the ${actualKindLimit} byte limit`);
          }
          totalBytes += dl.size;
          if (totalBytes > pushBytes) {
            throw new HttpError('TOO_LARGE', `Push exceeds ${pushBytes} byte limit`);
          }

          if (
            dl.kind === 'video' &&
            screen.maxVideoSeconds !== null &&
            screen.maxVideoSeconds !== undefined &&
            dl.durationSeconds > screen.maxVideoSeconds
          ) {
            throw new HttpError(
              'VIDEO_TOO_LONG',
              `Video duration (${dl.durationSeconds}s) exceeds screen limit (${screen.maxVideoSeconds}s)`,
            );
          }

          await storage.putMediaFromFile(dl.sha256, dl.ext, dl.tmpPath, dl.contentType);
          items.push({
            mediaId: dl.sha256,
            ext: dl.ext,
            kind: dl.kind,
            seconds: dl.kind === 'image' ? page.seconds : dl.durationSeconds,
            canvaDesignId: page.canvaDesignId ?? page.designId ?? null,
            alt: page.alt,
            headline: page.headline,
            caption: page.caption,
            link: page.link,
            startDatetime: page.startDatetime,
            endDatetime: page.endDatetime,
          });
        } finally {
          if (dl?.tmpPath) {
            await fs.promises.rm(dl.tmpPath, { force: true }).catch(() => {});
          }
        }

        const done = i + 1;
        await state.updatePush(pushId, {
          state: 'downloading',
          pages: { done, total: pages.length },
          progress: done / pages.length,
        });
      }

      const { playlistVersion } = await state.applyPush(screenId, {
        pushId,
        mode,
        title,
        items,
        enabled,
      });

      await state.updatePush(pushId, {
        state: 'ready',
        progress: 1,
        pages: { done: pages.length, total: pages.length },
        error: null,
        playlistVersion,
      });

      metrics?.inc('sissi_pushes_total', { state: 'ready' }, 1, 'Total pushes processed');
      scheduleSweep();
    } catch (err) {
      const code = err?.code && ERROR_STATUS[err.code] ? err.code : 'DOWNLOAD_FAILED';
      const message = scrubErrorMessage(err?.message || 'Push failed');
      metrics?.inc('sissi_pushes_total', { state: 'failed', code }, 1, 'Total pushes processed');
      try {
        await state.updatePush(pushId, {
          state: 'failed',
          error: { code, message },
        });
      } catch (updateErr) {
        console.error('Failed to mark push as failed:', updateErr);
      }
    }
  }

  /** Enqueue a validated push for background execution; throws 429 BUSY if > maxConcurrentPushes. */
  async function enqueue({ screenId, mode = 'append', title, pages, enabled = false }) {
    if (activeCount >= maxConcurrentPushes) {
      throw new HttpError('BUSY', 'Too many concurrent pushes', 429);
    }

    activeCount++;
    let push;
    try {
      push = await state.createPush({ screenId, pagesTotal: pages.length });
    } catch (err) {
      activeCount--;
      throw err;
    }

    const task = runPush(push.pushId, { screenId, mode, title, pages, enabled }).finally(() => {
      activeCount--;
      activeTasks.delete(task);
    });
    activeTasks.add(task);
    return push;
  }

  /** Wait until all in-flight pushes and background sweeps complete. */
  async function waitForIdle() {
    while (activeTasks.size > 0 || backgroundSweeps.size > 0) {
      await Promise.allSettled([...activeTasks, ...backgroundSweeps]);
    }
  }

  return { enqueue, waitForIdle };
}
