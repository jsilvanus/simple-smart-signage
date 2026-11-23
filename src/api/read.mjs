import { pipeline } from 'node:stream/promises';
import { HttpError, sendJson } from '../router.mjs';

const SCREEN_ID_RE = /^[a-z0-9-]{1,40}$/;
const MEDIA_FILE_RE = /^([0-9a-f]{64})\.([a-z0-9]+)$/;
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err && err.name === 'StateError') {
    return new HttpError(err.code, err.message, err.status);
  }
  return err;
}

function isRangeUnsatisfiableError(err) {
  if (!err) return false;
  if (err instanceof RangeError) return true;
  if (err.name === 'InvalidRange' || err.Code === 'InvalidRange' || err.code === 'InvalidRange') return true;
  if (err.$metadata?.httpStatusCode === 416) return true;
  return false;
}

/**
 * Parses a single HTTP `Range: bytes=...` header against total `size`.
 * Returns `{ start, end }` (inclusive) or `null` when the range is invalid/unsatisfiable.
 */
function parseByteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;

  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  if (size <= 0) return null;

  if (rawStart === '') {
    // Suffix range: bytes=-N
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;

  if (rawEnd === '') {
    // Open-ended range: bytes=N-
    return { start, end: size - 1 };
  }

  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < start) return null;

  return { start, end: Math.min(end, size - 1) };
}

function sendRangeNotSatisfiable(res, size) {
  res.writeHead(416, {
    'content-range': `bytes */${size}`,
    'content-length': 0,
  });
  res.end();
}

async function resolveMissingExts(storage, entries) {
  if (!entries.some((e) => !e.ext)) return null;
  const bySha = new Map();
  for await (const obj of storage.listMedia()) {
    if (!bySha.has(obj.sha256)) {
      bySha.set(obj.sha256, obj.ext);
    }
  }
  return bySha;
}

function formatScreen(s) {
  return {
    id: s.id,
    name: s.name,
    orientation: s.orientation,
    width: s.width ?? null,
    height: s.height ?? null,
    defaultImageSeconds: s.defaultImageSeconds,
    maxVideoSeconds: s.maxVideoSeconds ?? null,
    entryCount: s.entryCount,
    enabledEntryCount: s.enabledEntryCount,
    playlistVersion: s.playlistVersion,
  };
}

async function streamMedia(req, res, status, headers, stream) {
  res.writeHead(status, headers);
  if (req.method === 'HEAD') {
    stream.destroy();
    res.end();
    return;
  }

  res.once('close', () => {
    if (!stream.destroyed) stream.destroy();
  });
  try {
    await pipeline(stream, res);
  } catch (err) {
    if (!res.destroyed && !res.writableEnded) {
      res.destroy(err);
    }
  }
}

/**
 * Registers Step 1 read-only endpoints:
 * - `GET /api/v1/screens` (authenticated)
 * - `GET /s/:screenId/playlist.json` (public)
 * - `GET /media/:file` (public, Range-capable)
 */
export function registerReadRoutes(router, ctx) {
  const { auth, state, storage } = ctx;

  router.get('/api/v1/screens', async (req, res) => {
    auth.applyCors(req, res);
    auth.assertRights?.(await auth.authenticate(req), 'any');
    const list = await state.listScreens();
    sendJson(res, 200, { screens: list.map(formatScreen) });
  });

  router.get('/s/:screenId/playlist.json', async (req, res, { params }) => {
    const { screenId } = params;
    if (!SCREEN_ID_RE.test(screenId)) {
      throw new HttpError('SCREEN_NOT_FOUND', `Unknown screen: ${screenId}`);
    }

    let playlist;
    try {
      playlist = await state.getPlaylist(screenId);
    } catch (err) {
      throw toHttpError(err);
    }

    const fallbackExts = await resolveMissingExts(storage, playlist.entries);
    const entries = playlist.entries.map((e) => {
      const ext = e.ext || fallbackExts?.get(e.mediaId) || 'bin';
      return {
        entryId: e.entryId,
        kind: e.kind,
        url: router.url(`/media/${e.mediaId}.${ext}`),
        sha256: e.mediaId,
        seconds: e.seconds,
      };
    });

    sendJson(
      res,
      200,
      {
        screenId: playlist.screenId,
        version: playlist.version,
        orientation: playlist.orientation,
        entries,
      },
      { 'cache-control': 'no-cache', 'access-control-allow-origin': '*' },
    );
  });

  router.get('/media/:file', async (req, res, { params }) => {
    const match = MEDIA_FILE_RE.exec(params.file);
    if (!match) {
      throw new HttpError('NOT_FOUND', 'Not found');
    }
    const [, sha256, ext] = match;
    const rangeHeader = req.headers.range;

    if (!rangeHeader) {
      const media = await storage.getMedia(sha256, ext);
      if (!media) {
        throw new HttpError('NOT_FOUND', 'Not found');
      }

      await streamMedia(
        req,
        res,
        200,
        {
          'accept-ranges': 'bytes',
          'content-type': media.contentType,
          'content-length': media.size,
          'cache-control': CACHE_IMMUTABLE,
          'access-control-allow-origin': '*',
        },
        media.stream,
      );
      return;
    }

    const stat = await storage.statMedia(sha256, ext);
    if (!stat) {
      throw new HttpError('NOT_FOUND', 'Not found');
    }

    const parsed = parseByteRange(rangeHeader, stat.size);
    if (!parsed) {
      sendRangeNotSatisfiable(res, stat.size);
      return;
    }

    let media;
    try {
      media = await storage.getMedia(sha256, ext, parsed);
    } catch (err) {
      if (isRangeUnsatisfiableError(err)) {
        sendRangeNotSatisfiable(res, stat.size);
        return;
      }
      throw err;
    }

    if (!media) {
      throw new HttpError('NOT_FOUND', 'Not found');
    }

    const chunkLen = media.end - media.start + 1;
    await streamMedia(
      req,
      res,
      206,
      {
        'accept-ranges': 'bytes',
        'content-type': media.contentType,
        'content-length': chunkLen,
        'content-range': `bytes ${media.start}-${media.end}/${media.size}`,
        'cache-control': CACHE_IMMUTABLE,
      },
      media.stream,
    );
  });
}
