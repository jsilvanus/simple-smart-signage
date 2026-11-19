const SW_MAX_VIDEO_MB = /*__SW_MAX_VIDEO_MB__*/ 100;
const MAX_VIDEO_BYTES = SW_MAX_VIDEO_MB * 1024 * 1024;

const SHELL_CACHE = 'sissi-shell-v1';
const MEDIA_CACHE = 'sissi-media-v1';

const PLAYLIST_RE = /\/s\/[^/]+\/playlist\.json$/;
const MEDIA_RE = /\/media\/[0-9a-f]{64}\.[a-z0-9]+$/;
const SHELL_RE = /\/s\/(?:player\.js|player\.css|[^/]+)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(['./player.js', './player.css']).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== MEDIA_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function parseRange(header, total) {
  const m = /^bytes=(\d*)-(\d*)$/i.exec((header || '').trim());
  if (!m || total <= 0) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, total - suffix), end: total - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start < 0 || start >= total) return null;
  if (rawEnd === '') return { start, end: total - 1 };
  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end: Math.min(end, total - 1) };
}

async function cacheMediaEntry(cache, entry) {
  const absUrl = new URL(entry.url, self.location.origin).href;
  const existing = await cache.match(absUrl);
  if (existing) return;

  if (entry.kind === 'video') {
    if (MAX_VIDEO_BYTES <= 0) return;
    try {
      const head = await fetch(absUrl, { method: 'HEAD' });
      if (!head.ok) return;
      const lenHeader = head.headers.get('content-length');
      if (lenHeader !== null) {
        const len = Number(lenHeader);
        if (!Number.isFinite(len) || len >= MAX_VIDEO_BYTES) return;
      }
      const res = await fetch(absUrl);
      if (!res.ok) return;
      const resLenHeader = res.headers.get('content-length');
      if (resLenHeader !== null) {
        const resLen = Number(resLenHeader);
        if (!Number.isFinite(resLen) || resLen >= MAX_VIDEO_BYTES) return;
        await cache.put(absUrl, res);
        return;
      }
      const buf = await res.clone().arrayBuffer();
      if (buf.byteLength < MAX_VIDEO_BYTES) {
        await cache.put(absUrl, res);
      }
    } catch {
      // Ignore background cache failures
    }
    return;
  }

  try {
    const res = await fetch(absUrl);
    if (res.ok) {
      await cache.put(absUrl, res);
    }
  } catch {
    // Ignore background cache failures
  }
}

const activeByScreen = new Map();

async function syncMediaCache(entries, screenKey = 'default') {
  if (!Array.isArray(entries)) return;
  const cache = await caches.open(MEDIA_CACHE);
  const screenUrls = new Set(entries.map((e) => new URL(e.url, self.location.origin).href));
  activeByScreen.set(screenKey, screenUrls);

  const allActiveUrls = new Set();
  for (const set of activeByScreen.values()) {
    for (const u of set) allActiveUrls.add(u);
  }

  const keys = await cache.keys();
  await Promise.all(
    keys.filter((req) => !allActiveUrls.has(req.url)).map((req) => cache.delete(req)),
  );

  await Promise.all(entries.map((entry) => cacheMediaEntry(cache, entry)));
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SYNC_PLAYLIST') {
    event.waitUntil(syncMediaCache(event.data.entries, event.data.screenId || 'default'));
  }
});

async function handleMediaRange(request, url) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(url.href);
  if (cached) {
    const buf = await cached.arrayBuffer();
    const total = buf.byteLength;
    const range = parseRange(request.headers.get('range'), total);
    if (!range) {
      return new Response(null, {
        status: 416,
        statusText: 'Range Not Satisfiable',
        headers: { 'content-range': `bytes */${total}` },
      });
    }
    const slice = buf.slice(range.start, range.end + 1);
    return new Response(slice, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'content-type': cached.headers.get('content-type') || 'video/mp4',
        'content-length': String(slice.byteLength),
        'content-range': `bytes ${range.start}-${range.end}/${total}`,
        'accept-ranges': 'bytes',
      },
    });
  }

  try {
    return await fetch(request);
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function handleMediaFull(request, url) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(url.href);
  if (cached) return cached;

  try {
    const res = await fetch(request);
    if (res.ok) {
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.startsWith('video/')) {
        const lenHeader = res.headers.get('content-length');
        if (MAX_VIDEO_BYTES > 0 && lenHeader !== null && Number(lenHeader) < MAX_VIDEO_BYTES) {
          await cache.put(url.href, res.clone());
        }
      } else {
        await cache.put(url.href, res.clone());
      }
    }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function handlePlaylist(event, request, url) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(url.href, res.clone());
      res
        .clone()
        .json()
        .then((data) => {
          if (data && Array.isArray(data.entries)) {
            const m = /\/s\/([^/]+)\/playlist\.json$/.exec(url.pathname);
            const screenKey = m ? decodeURIComponent(m[1]) : url.pathname;
            event.waitUntil(syncMediaCache(data.entries, screenKey));
          }
        })
        .catch(() => {});
      return res;
    }
    if (res.status < 500) return res;
  } catch {
    // Offline: fallback to cache
  }
  const cached = await cache.match(url.href);
  if (cached) return cached;
  return new Response('', { status: 504, statusText: 'Offline' });
}

async function handleShell(request, url) {
  const cache = await caches.open(SHELL_CACHE);
  const cacheKey = url.origin + url.pathname;
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(cacheKey, res.clone());
      return res;
    }
    if (res.status < 500) return res;
  } catch {
    // Offline: fallback to cache
  }
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  return new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/\/s\/sw\.js$/.test(url.pathname)) return;

  if (MEDIA_RE.test(url.pathname)) {
    if (request.headers.has('range')) {
      event.respondWith(handleMediaRange(request, url));
    } else {
      event.respondWith(handleMediaFull(request, url));
    }
    return;
  }

  if (PLAYLIST_RE.test(url.pathname)) {
    event.respondWith(handlePlaylist(event, request, url));
    return;
  }

  if (SHELL_RE.test(url.pathname)) {
    event.respondWith(handleShell(request, url));
  }
});
