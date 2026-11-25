import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HttpError, sendJson, sendText } from '../router.mjs';
import { joinMembers, escapeHtml, frameCsp, corsHeaders } from '../views/embed.mjs';

const VIEW_ID_RE = /^[a-z0-9-]{1,40}$/;
const RUNTIME = await readFile(fileURLToPath(new URL('../views/runtime.js', import.meta.url)), 'utf8');

/** JSON for a <script> block: escapes "<" so the content can never close the tag. */
function scriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function sendPublic(req, res, status, body, headers) {
  const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const etag = `"${createHash('sha1').update(data).digest('base64url')}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, {
      'cache-control': 'public, max-age=0, must-revalidate',
      etag,
      ...headers,
    });
    res.end();
    return;
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'public, max-age=0, must-revalidate',
    etag,
    ...headers,
  });
  res.end(data);
}

/**
 * Public view routes (no secret: views are public by design; embedding sites are limited per view).
 * - GET /v/:viewId/playlist.json  data for the embed (enabled entries; aggregates join their members)
 * - GET /v/:viewId/frame          standalone page for an <iframe>, CSP frame-ancestors = allowed origins
 * - GET /v/:viewId/embed.js       script embed: renders into every [data-sissi-embed] before it
 */
export function registerViewRoutes(router, ctx) {
  const { state } = ctx;

  async function loadView(viewId) {
    if (!VIEW_ID_RE.test(viewId)) throw new HttpError('SCREEN_NOT_FOUND', `Unknown view: ${viewId}`);
    try {
      return await state.getViewDoc(viewId);
    } catch (err) {
      if (err?.code) throw new HttpError(err.code, err.message);
      throw err;
    }
  }

  async function playlistOf(view) {
    if (view.kind === 'view') return { entries: view.entries, version: view.version };
    const members = [];
    for (const id of view.members ?? []) {
      try {
        const m = await state.getViewDoc(id);
        if (m.kind === 'view') members.push(m);
      } catch {
        // A member that was deleted or is not a view is skipped, not an error.
      }
    }
    const entries = joinMembers(members.map((m) => ({ id: m.id, entries: m.entries })));
    const version = `${view.version}:${members.map((m) => `${m.id}@${m.version}`).join(',')}`;
    return { entries, version };
  }

  function toPublicEntries(entries) {
    return entries.map((e) => ({
      entryId: e.entryId,
      sourceView: e.sourceView ?? undefined,
      kind: e.kind,
      url: router.url(`/media/${e.mediaId}.${e.ext || 'bin'}`),
      seconds: e.seconds,
      alt: e.alt ?? null,
      headline: e.headline ?? null,
      caption: e.caption ?? null,
      link: e.link ?? null,
    }));
  }

  router.options('/v/:viewId/playlist.json', async (req, res, { params }) => {
    const view = await loadView(params.viewId);
    const cors = corsHeaders(req.headers.origin, view.embed?.allowedOrigins ?? []);
    const allowMethods = cors['access-control-allow-origin'] ? { 'access-control-allow-methods': 'GET, HEAD, OPTIONS' } : {};
    res.writeHead(204, { ...cors, ...allowMethods, 'cache-control': 'public, max-age=300' });
    res.end();
  });

  router.get('/v/:viewId/playlist.json', async (req, res, { params }) => {
    const view = await loadView(params.viewId);
    const pl = await playlistOf(view);
    const entries = toPublicEntries(pl.entries);
    const body = {
      viewId: view.id,
      name: view.name,
      kind: view.kind,
      version: pl.version,
      embed: view.embed,
      entries,
    };
    const cors = corsHeaders(req.headers.origin, view.embed?.allowedOrigins ?? []);
    sendPublic(req, res, 200, body, cors);
  });

  router.get('/v/:viewId/frame', async (req, res, { params }) => {
    const view = await loadView(params.viewId);
    const config = {
      playlistUrl: 'playlist.json',
      embed: view.embed,
      intervalMs: 60000,
    };
    const html = `<!doctype html>
<html lang="fi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(view.name)}</title>
<style>html,body{margin:0;height:100%;background:#fff}body{display:flex;align-items:center;justify-content:center}#root{width:100%;max-height:100%}</style>
</head>
<body>
<div id="root"></div>
<script>${RUNTIME}</script>
<script>
(function () {
  var cfg = ${scriptJson(config)};
  window.SissiViews.mount(document.getElementById('root'), cfg);
})();
</script>
</body>
</html>
`;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': frameCsp(view.embed?.allowedOrigins ?? []),
      'cache-control': 'public, max-age=0, must-revalidate',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
    res.end(html);
  });

  router.options('/v/:viewId/embed.js', async (req, res, { params }) => {
    const view = await loadView(params.viewId);
    const cors = corsHeaders(req.headers.origin, view.embed?.allowedOrigins ?? []);
    const allowMethods = cors['access-control-allow-origin'] ? { 'access-control-allow-methods': 'GET, HEAD, OPTIONS' } : {};
    res.writeHead(204, { ...cors, ...allowMethods, 'cache-control': 'public, max-age=300' });
    res.end();
  });

  router.get('/v/:viewId/embed.js', async (req, res, { params }) => {
    const view = await loadView(params.viewId);
    const cors = corsHeaders(req.headers.origin, view.embed?.allowedOrigins ?? []);
    const scriptPath = router.url(`/v/${view.id}/embed.js`);
    const bootstrap = `
(function () {
  var viewId = ${JSON.stringify(view.id)};
  var self = document.currentScript;
  var src = (self && self.src) || new URL(${JSON.stringify(scriptPath)}, location.href).href;
  var base = new URL('.', src);
  var cfg = { playlistUrl: new URL('playlist.json', base).href, embed: ${scriptJson(view.embed)}, intervalMs: 60000 };
  function mountEl(h) {
    h.setAttribute('data-sissi-mounted', '1');
    var root = h.attachShadow ? h.attachShadow({ mode: 'open' }) : h;
    window.SissiViews.mount(root, cfg);
  }
  function mountAll() {
    var holders = document.querySelectorAll('[data-sissi-embed]');
    var mounted = 0;
    for (var i = 0; i < holders.length; i++) {
      var h = holders[i];
      if (h.getAttribute('data-sissi-mounted')) continue;
      var target = h.getAttribute('data-sissi-view');
      if (target && target !== viewId) continue;
      mountEl(h);
      mounted++;
    }
    if (!mounted && self && self.parentNode) {
      var box = document.createElement('div');
      box.setAttribute('data-sissi-embed', '');
      box.setAttribute('data-sissi-view', viewId);
      self.parentNode.insertBefore(box, self.nextSibling);
      mountEl(box);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll); else mountAll();
})();`;
    sendText(res, 200, `${RUNTIME}\n${bootstrap}`, 'text/javascript; charset=utf-8', {
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      ...cors,
    });
  });
}
