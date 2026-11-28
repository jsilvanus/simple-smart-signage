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
  const { state, config } = ctx;

  function publicOrigin(req) {
    const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
    if (host) {
      const proto = req?.headers?.['x-forwarded-proto'] || (req?.socket?.encrypted ? 'https' : 'http');
      return `${proto}://${host}`;
    }
    return config?.baseUrl ? new URL(config.baseUrl).origin : '';
  }

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
    if (view.kind === 'view') return { entries: view.entries, version: view.version, nextChangeAt: view.nextChangeAt };
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
    const changes = members.map((m) => m.nextChangeAt).filter(Boolean).sort();
    return { entries, version, nextChangeAt: changes[0] ?? null };
  }

  function toPublicEntries(entries, origin = '') {
    return entries.map((e) => {
      const origUrl = `${origin}${router.url(`/media/${e.mediaId}.${e.ext || 'bin'}`)}`;
      const pub = {
        entryId: e.entryId,
        sourceView: e.sourceView ?? undefined,
        kind: e.kind,
        url: origUrl,
        seconds: e.seconds,
        alt: e.alt ?? null,
        headline: e.headline ?? null,
        caption: e.caption ?? null,
        link: e.link ?? null,
        background: e.background ?? null,
        width: e.width ?? null,
        height: e.height ?? null,
      };
      if (e.kind === 'image') {
        const variants = Array.isArray(e.variants) && e.variants.length > 0
          ? e.variants.map((v) => ({
              width: v.width,
              height: v.height,
              url: `${origin}${router.url(`/media/${v.mediaId}.${v.ext || 'webp'}`)}`,
            }))
          : [
              { width: 480, url: `${origin}${router.url(`/media/${e.mediaId}-480w.webp`)}` },
              { width: 720, url: `${origin}${router.url(`/media/${e.mediaId}-720w.webp`)}` },
              { width: 1080, url: `${origin}${router.url(`/media/${e.mediaId}-1080w.webp`)}` },
            ];
        const srcsets = variants.map((v) => `${v.url} ${v.width}w`);
        if (e.width) {
          srcsets.push(`${origUrl} ${e.width}w`);
        } else {
          srcsets.push(`${origUrl} 1920w`);
        }
        pub.variants = variants;
        pub.srcset = srcsets.join(', ');
        pub.sizes = '(max-width: 600px) 480px, (max-width: 900px) 720px, 1080px';
      }
      return pub;
    });
  }

  // Martti, the parish font, for the view runtime. Public, cross-origin readable (embeds load it from other sites).
  const FONT_FILES = { 'Martti-Regular.ttf': null, 'Martti-Bold.ttf': null };
  router.get('/v/fonts/:file', async (req, res, { params }) => {
    if (!Object.hasOwn(FONT_FILES, params.file)) throw new HttpError('SCREEN_NOT_FOUND', `Unknown font: ${params.file}`);
    FONT_FILES[params.file] ??= await readFile(fileURLToPath(new URL(`../../public/fonts/martti/${params.file}`, import.meta.url)));
    const data = FONT_FILES[params.file];
    res.writeHead(200, {
      'content-type': 'font/ttf',
      'content-length': data.length,
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });

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
    const entries = toPublicEntries(pl.entries, publicOrigin(req));
    const body = {
      viewId: view.id,
      name: view.name,
      kind: view.kind,
      version: pl.version,
      nextChangeAt: pl.nextChangeAt,
      embed: view.embed,
      background: view.background ?? 'transparent',
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
<style>html,body{margin:0;height:100%;background:transparent}body{display:flex;align-items:center;justify-content:center}#root{width:100%;max-height:100%}</style>
</head>
<body>
<div id="root"></div>
<script>${RUNTIME}</script>
<script>
(function () {
  var cfg = ${scriptJson(config)};
  var q = new URLSearchParams(location.search);
  cfg.width = q.get('width');
  cfg.height = q.get('height');
  cfg.minWidth = q.get('minWidth') || q.get('min-width');
  cfg.maxWidth = q.get('maxWidth') || q.get('max-width');
  cfg.minHeight = q.get('minHeight') || q.get('min-height');
  cfg.maxHeight = q.get('maxHeight') || q.get('max-height');
  cfg.background = q.get('background');
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
    // Per-embed settings from the host page: width, height, min/max dimensions, background.
    var own = Object.assign({}, cfg, {
      width: h.getAttribute('data-sissi-width') || h.getAttribute('data-width'),
      height: h.getAttribute('data-sissi-height') || h.getAttribute('data-height'),
      minWidth: h.getAttribute('data-sissi-min-width') || h.getAttribute('data-min-width'),
      maxWidth: h.getAttribute('data-sissi-max-width') || h.getAttribute('data-max-width'),
      minHeight: h.getAttribute('data-sissi-min-height') || h.getAttribute('data-min-height'),
      maxHeight: h.getAttribute('data-sissi-max-height') || h.getAttribute('data-max-height'),
      background: h.getAttribute('data-sissi-background') || h.getAttribute('data-background')
    });
    window.SissiViews.mount(root, own);
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
