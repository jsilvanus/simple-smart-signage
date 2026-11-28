import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../router.mjs';

const ADMIN_DIR = resolve(fileURLToPath(new URL('../../public/admin', import.meta.url)));
const SAFE_FILE_RE = /^[A-Za-z0-9._-]+$/;

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
});

function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function sendStatic(req, res, body, contentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': buf.length,
    'cache-control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

async function readAdminAsset(fileName) {
  if (typeof fileName !== 'string' || !SAFE_FILE_RE.test(fileName) || fileName.includes('..')) {
    throw new HttpError('NOT_FOUND', 'Not found');
  }
  const filePath = resolve(join(ADMIN_DIR, fileName));
  if (!filePath.startsWith(ADMIN_DIR)) {
    throw new HttpError('NOT_FOUND', 'Not found');
  }
  try {
    return await readFile(filePath);
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'EISDIR') {
      throw new HttpError('NOT_FOUND', 'Not found');
    }
    throw err;
  }
}

/**
 * Register GET /admin, GET /admin/, and GET /admin/:file static routes.
 */
export function registerAdminUiRoutes(router, _ctx = {}) {
  async function serveIndex(req, res) {
    const raw = (await readAdminAsset('index.html')).toString('utf8');
    const baseHref = router.url('/admin/');
    const html = raw.replace('<base href="/admin/">', `<base href="${escapeAttr(baseHref)}">`);
    sendStatic(req, res, html, 'text/html; charset=utf-8');
  }

  // Root goes to the admin page for now (respects the public path: /signage/ -> /signage/admin/).
  router.get('/', (req, res) => {
    res.writeHead(302, { location: router.url('/admin/'), 'cache-control': 'no-cache' });
    res.end();
  });

  router.get('/favicon.ico', async (req, res) => {
    try {
      const data = await readAdminAsset('sissi.svg');
      sendStatic(req, res, data, 'image/svg+xml; charset=utf-8');
    } catch {
      throw new HttpError('NOT_FOUND', 'Not found');
    }
  });

  router.get('/admin', serveIndex);
  router.get('/admin/', serveIndex);

  router.get('/admin/:file', async (req, res, { params }) => {
    const fileName = params.file;
    const data = await readAdminAsset(fileName);
    const contentType = MIME_TYPES[extname(fileName).toLowerCase()] ?? 'application/octet-stream';
    sendStatic(req, res, data, contentType);
  });
}

export { registerAdminUiRoutes as registerAdminUi };
