import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAdminAuth } from '../admin-auth/index.mjs';
import { DownloadError, readMp4Duration, sniffKind } from '../download/index.mjs';
import { sha256Hex } from '../storage/common.mjs';
import { ERROR_STATUS, HttpError, sendJson } from '../router.mjs';
import { StateError } from '../state/index.mjs';
import { hasRight, rightsForTarget } from '../auth/tunnus.mjs';
import { rightsKeysForTarget } from '../views/embed.mjs';

const SCREEN_ID_RE = /^[a-z0-9-]{1,40}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;

function assertScreenId(screenId) {
  if (typeof screenId !== 'string' || !SCREEN_ID_RE.test(screenId)) {
    throw new HttpError('SCREEN_NOT_FOUND', `Unknown screen: ${screenId}`);
  }
}

function assertOpaqueId(id, errorCode, label) {
  if (typeof id !== 'string' || !OPAQUE_ID_RE.test(id) || id.includes('..')) {
    throw new HttpError(errorCode, `Unknown ${label}: ${id}`);
  }
}

async function runState(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StateError) {
      throw new HttpError(err.code, err.message, ERROR_STATUS[err.code] ?? err.status);
    }
    throw err;
  }
}

const PNG_MAX_TITLE = 200;
// Media kinds accepted by the manual upload endpoint (sniffKind kind/ext).
const UPLOAD_KINDS = new Set(['image/png', 'video/mp4']);

async function writeTmp(buf, ext) {
  const tmpPath = path.join(os.tmpdir(), `sissi-upload-${crypto.randomBytes(8).toString('hex')}.${ext}`);
  await fs.promises.writeFile(tmpPath, buf);
  return tmpPath;
}

async function mp4Seconds(tmpPath) {
  try {
    return await readMp4Duration(tmpPath);
  } catch (err) {
    if (err instanceof DownloadError) throw new HttpError('UNSUPPORTED_TYPE', 'Could not read the MP4 duration');
    throw err;
  }
}

/** Reads a raw request body up to maxBytes. Throws HttpError(TOO_LARGE) when over. */
async function readRawBody(req, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError('TOO_LARGE', `File is larger than the ${maxBytes} byte limit`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError('TOO_LARGE', `File is larger than the ${maxBytes} byte limit`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

/**
 * Register all /api/v1/admin/* endpoints on `router`.
 */
export function registerAdminRoutes(router, ctx) {
  const { config, state, storage } = ctx;
  // Tunnus discovery re-sync after screen/view changes (fire and forget; see src/discovery).
  const resyncDiscovery = () => {
    void ctx.discovery?.refresh?.();
  };
  const adminAuth = ctx.adminAuth ?? createAdminAuth(config);

  async function triggerGc() {
    if (!storage || typeof state?.gcSweep !== 'function') return;
    try {
      await state.gcSweep(storage, { graceMinutes: config.gcGraceMinutes });
    } catch (err) {
      console.error('admin gcSweep failed:', err);
    }
  }

  function targetOf(screen) {
    return { kind: (screen?.kind ?? 'screen') === 'screen' ? 'screen' : 'view', id: screen?.id ?? '' };
  }

  function withPowerStatus(screen, principal = null) {
    const powerStatus = typeof state?.getPowerStatus === 'function' ? state.getPowerStatus(screen.id) : null;
    const rights = principal?.kind === 'tunnus' ? rightsForTarget(principal, targetOf(screen)) : undefined;
    return {
      ...screen,
      ...(powerStatus ? { powerStatus } : {}),
      ...(rights ? { rights } : {}),
    };
  }

  router.post('/api/v1/admin/login', async (req, res) => {
    const body = await router.readJson(req);
    await adminAuth.login(req, res, body);
  });

  router.post('/api/v1/admin/logout', (req, res) => {
    // A Tunnus browser session is cleared by its own cookie; the password session keeps its old path.
    if (ctx.adminOidc?.readSession(req.headers.cookie)) {
      if (req.headers['x-sissi-admin'] !== '1') throw new HttpError('UNAUTHORIZED', 'Missing X-Sissi-Admin header');
      res.writeHead(204, { 'set-cookie': ctx.adminOidc.clearSession(config.publicPath || '/', Boolean(config.production)) });
      res.end();
      return;
    }
    adminAuth.requireAdmin(req);
    adminAuth.logout(req, res);
  });

  router.get('/api/v1/admin/screens', async (req, res) => {
    const principal = await adminAuth.authorize(req, 'read');
    let screens = await runState(() => state.listScreens());
    if (principal?.kind === 'tunnus') {
      screens = screens.filter((s) => hasRight(principal, 'read', targetOf(s)));
    }
    sendJson(res, 200, { serverTime: Date.now(), screens: screens.map((s) => withPowerStatus(s, principal)) });
  });

  router.get('/api/v1/admin/rights-keys', async (req, res) => {
    const principal = await adminAuth.authorize(req, 'read');
    let screens = await runState(() => state.listScreens());
    if (principal?.kind === 'tunnus') {
      screens = screens.filter((s) => hasRight(principal, 'read', targetOf(s)));
    }
    sendJson(res, 200, {
      keys: screens.map((s) => ({
        id: s.id,
        kind: s.kind ?? 'screen',
        name: s.name,
        rightsKeys: rightsKeysForTarget(s.id, s.kind ?? 'screen'),
      })),
    });
  });

  router.post('/api/v1/admin/screens', async (req, res) => {
    adminAuth.requireAdmin(req);
    const body = await router.readJson(req);
    const screen = await runState(() => state.createScreen(body));
    sendJson(res, 201, withPowerStatus(screen));
    resyncDiscovery();
  });

  router.patch('/api/v1/admin/screens/:screenId', async (req, res, { params }) => {
    assertScreenId(params.screenId);
    const body = await router.readJson(req);
    const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
    const screenNow = await runState(() => state.getScreen(params.screenId));
    if (screenNow.kind === 'aggregate' && keys.length === 1 && keys[0] === 'members') {
      const principal = await adminAuth.authorize(req, 'write', targetOf(screenNow));
      if (principal?.kind === 'tunnus' && Array.isArray(body.members)) {
        for (const memberId of body.members) {
          if (!hasRight(principal, 'read', { kind: 'view', id: memberId })) {
            throw new HttpError('FORBIDDEN', `Requires read right on view:${memberId}`);
          }
        }
      }
    } else {
      adminAuth.requireAdmin(req);
    }
    const screen = await runState(() => state.updateScreen(params.screenId, body));
    sendJson(res, 200, withPowerStatus(screen));
    resyncDiscovery();
  });

  router.post('/api/v1/admin/screens/:screenId/power/override', async (req, res, { params }) => {
    adminAuth.requireAdmin(req);
    assertScreenId(params.screenId);
    const body = await router.readJson(req);
    const screen = await runState(() => state.setPowerOverride(params.screenId, body?.override));
    sendJson(res, 200, withPowerStatus(screen));
  });

  router.delete('/api/v1/admin/screens/:screenId', async (req, res, { params }) => {
    adminAuth.requireAdmin(req);
    assertScreenId(params.screenId);
    await runState(() => state.deleteScreen(params.screenId));
    await triggerGc();
    sendNoContent(res);
    resyncDiscovery();
  });

  router.put('/api/v1/admin/screens/:screenId/entries', async (req, res, { params }) => {
    assertScreenId(params.screenId);
    const screenNow = await runState(() => state.getScreen(params.screenId));
    await adminAuth.authorize(req, 'write', targetOf(screenNow));
    const body = await router.readJson(req);
    const screen = await runState(() => state.reorderEntries(params.screenId, body?.entryIds));
    sendJson(res, 200, {
      screenId: screen.id,
      version: screen.playlistVersion,
      entries: screen.entries,
    });
  });

  router.patch('/api/v1/admin/screens/:screenId/entries/:entryId', async (req, res, { params }) => {
    assertScreenId(params.screenId);
    assertOpaqueId(params.entryId, 'ENTRY_NOT_FOUND', 'entry');
    const screenNow = await runState(() => state.getScreen(params.screenId));
    const target = targetOf(screenNow);
    await adminAuth.authorize(req, 'any', target);
    const body = await router.readJson(req);
    const hasText =
      body?.alt !== undefined ||
      body?.headline !== undefined ||
      body?.caption !== undefined ||
      body?.link !== undefined;
    // seconds and text metadata are content (sissi:write); enabled is the live change (sissi:operate).
    await adminAuth.authorize(
      req,
      [
        ...(body?.seconds !== undefined || hasText ? ['write'] : []),
        ...(body?.enabled !== undefined ? ['operate'] : []),
      ],
      target,
    );
    if (body?.seconds === undefined && body?.enabled === undefined && !hasText) {
      throw new HttpError('INVALID_SECONDS', 'Provide seconds, enabled, or text fields');
    }
    let screen;
    if (body.seconds !== undefined) {
      screen = await runState(() => state.setEntrySeconds(params.screenId, params.entryId, body.seconds));
    }
    if (hasText) {
      screen = await runState(() =>
        state.setEntryText(params.screenId, params.entryId, {
          alt: body.alt,
          headline: body.headline,
          caption: body.caption,
          link: body.link,
        }),
      );
    }
    if (body.enabled !== undefined) {
      screen = await runState(() => state.setEntryEnabled(params.screenId, params.entryId, body.enabled));
    }
    const entry = screen.entries.find((e) => e.entryId === params.entryId);
    sendJson(res, 200, entry);
  });

  router.delete('/api/v1/admin/screens/:screenId/entries/:entryId', async (req, res, { params }) => {
    assertScreenId(params.screenId);
    assertOpaqueId(params.entryId, 'ENTRY_NOT_FOUND', 'entry');
    // Removing a live entry changes what is on screen (operate); removing a disabled one is content (write).
    const screen = await runState(() => state.getScreen(params.screenId));
    const target = targetOf(screen);
    await adminAuth.authorize(req, 'any', target);
    const entry = screen.entries.find((e) => e.entryId === params.entryId);
    await adminAuth.authorize(req, entry?.enabled === false ? 'write' : 'operate', target);
    await runState(() => state.removeEntry(params.screenId, params.entryId));
    await triggerGc();
    sendNoContent(res);
  });

  // Manual upload into a screen's playlist: PNG (image) or MP4 (video). The entry is added
  // disabled, so it needs sissi:operate (enable) before it goes live. Body: raw file bytes.
  // Clients send a first-frame PNG for MP4s afterwards via the thumbnail endpoint below.
  router.post('/api/v1/admin/screens/:screenId/uploads', async (req, res, { params }) => {
    assertScreenId(params.screenId);
    const screenNow = await runState(() => state.getScreen(params.screenId));
    if (screenNow.kind === 'aggregate') {
      throw new HttpError('KIND_MISMATCH', 'Aggregates cannot receive uploaded media', 422);
    }
    await adminAuth.authorize(req, 'write', targetOf(screenNow));
    const buf = await readRawBody(req, config.limits.videoBytes);
    const sniffed = sniffKind(buf);
    if (!sniffed || !UPLOAD_KINDS.has(`${sniffed.kind}/${sniffed.ext}`)) {
      throw new HttpError('UNSUPPORTED_TYPE', 'Only PNG images and MP4 videos can be uploaded');
    }
    if (sniffed.kind === 'image' && buf.length > config.limits.imageBytes) {
      throw new HttpError('TOO_LARGE', `File is larger than the ${config.limits.imageBytes} byte limit`);
    }
    if (!storage) throw new HttpError('INTERNAL', 'Storage is not configured');

    const sha256 = sha256Hex(buf);
    const rawTitle = String(req.headers['x-upload-title'] ?? '').trim();
    const pushId = `upload_${crypto.randomBytes(8).toString('hex')}`;

    let item;
    let defaultTitle;
    let screen;
    const tmpPath = await writeTmp(buf, sniffed.ext);
    try {
      if (sniffed.kind === 'video') {
        const seconds = await mp4Seconds(tmpPath);
        if (screenNow.maxVideoSeconds && seconds > screenNow.maxVideoSeconds) {
          throw new HttpError('VIDEO_TOO_LONG', `Video is ${seconds}s; this screen allows at most ${screenNow.maxVideoSeconds}s`, 422);
        }
        item = { mediaId: sha256, ext: 'mp4', kind: 'video', seconds };
        defaultTitle = 'Uploaded video';
      } else {
        item = { mediaId: sha256, ext: 'png', kind: 'image' };
        defaultTitle = 'Uploaded PNG';
      }
      await storage.putMediaFromFile(sha256, sniffed.ext, tmpPath, sniffed.contentType);
      const title = (rawTitle || defaultTitle).slice(0, PNG_MAX_TITLE);
      screen = await runState(() =>
        state.applyPush(params.screenId, { pushId, mode: 'append', title, items: [item], enabled: false }),
      );
    } finally {
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    }
    const entry = (await runState(() => state.getScreen(params.screenId))).entries
      .filter((e) => e.mediaId === sha256)
      .at(-1);
    sendJson(res, 201, { screenId: params.screenId, version: screen.playlistVersion, entry });
  });

  // Thumbnail for a video entry: a raw PNG (the client grabs the first frame). Stored as media
  // and referenced from the entry so the playlist can show it instead of the generic video icon.
  router.put('/api/v1/admin/screens/:screenId/entries/:entryId/thumbnail', async (req, res, { params }) => {
    assertScreenId(params.screenId);
    assertOpaqueId(params.entryId, 'ENTRY_NOT_FOUND', 'entry');
    const screenNow = await runState(() => state.getScreen(params.screenId));
    await adminAuth.authorize(req, 'write', targetOf(screenNow));
    const buf = await readRawBody(req, config.limits.imageBytes);
    const sniffed = sniffKind(buf);
    if (!sniffed || sniffed.kind !== 'image' || sniffed.ext !== 'png') {
      throw new HttpError('UNSUPPORTED_TYPE', 'A thumbnail must be a PNG image');
    }
    if (!storage) throw new HttpError('INTERNAL', 'Storage is not configured');
    const target = screenNow.entries.find((e) => e.entryId === params.entryId);
    if (!target) throw new HttpError('ENTRY_NOT_FOUND', `Unknown entry: ${params.entryId}`);
    if (target.kind !== 'video') throw new HttpError('INVALID_KIND', 'Thumbnails are only for video entries', 422);

    const sha256 = sha256Hex(buf);
    const tmpPath = await writeTmp(buf, 'png');
    try {
      await storage.putMediaFromFile(sha256, 'png', tmpPath, 'image/png');
    } finally {
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    }
    const screen = await runState(() =>
      state.setEntryThumbnail(params.screenId, params.entryId, { mediaId: sha256, ext: 'png' }),
    );
    const entry = screen.entries.find((e) => e.entryId === params.entryId);
    sendJson(res, 200, entry);
  });

  router.patch('/api/v1/admin/screens/:screenId/pushes/:pushId', async (req, res, { params }) => {
    assertScreenId(params.screenId);
    assertOpaqueId(params.pushId, 'PUSH_NOT_FOUND', 'push');
    const screenNow = await runState(() => state.getScreen(params.screenId));
    await adminAuth.authorize(req, 'operate', targetOf(screenNow));
    const body = await router.readJson(req);
    const screen = await runState(() => state.setPushEnabled(params.screenId, params.pushId, body?.enabled));
    sendJson(res, 200, {
      screenId: screen.id,
      version: screen.playlistVersion,
      entries: screen.entries.filter((e) => e.pushId === params.pushId),
    });
  });

  router.delete('/api/v1/admin/screens/:screenId/pushes/:pushId', async (req, res, { params }) => {
    assertScreenId(params.screenId);
    assertOpaqueId(params.pushId, 'PUSH_NOT_FOUND', 'push');
    const screen = await runState(() => state.getScreen(params.screenId));
    const target = targetOf(screen);
    await adminAuth.authorize(req, 'any', target);
    const live = screen.entries.some((e) => e.pushId === params.pushId && e.enabled !== false);
    await adminAuth.authorize(req, live ? 'operate' : 'write', target);
    await runState(() => state.removePush(params.screenId, params.pushId));
    await triggerGc();
    sendNoContent(res);
  });
}

export { registerAdminRoutes as registerAdmin };
