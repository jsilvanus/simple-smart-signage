// Minimal router: path-prefix aware, JSON body helper, JSON error helper.
// Handler signature: async (req, res, { params, query, url, router }) => void
// Handlers may throw HttpError; the router turns it into the JSON error shape.

export const ERROR_STATUS = Object.freeze({
  UNAUTHORIZED: 401,
  TEAM_NOT_ALLOWED: 403,
  AUTH_NOT_CONFIGURED: 503,
  SCREEN_NOT_FOUND: 404,
  SCREEN_EXISTS: 409,
  ENTRY_NOT_FOUND: 404,
  PUSH_NOT_FOUND: 404,
  INVALID_MODE: 422,
  INVALID_ENABLED: 422,
  INVALID_TITLE: 422,
  INVALID_PAGES: 422,
  INVALID_KIND: 422,
  INVALID_SECONDS: 422,
  INVALID_SCREEN: 422,
  PAGE_URL_NOT_ALLOWED: 422,
  TOO_MANY_PAGES: 422,
  BUSY: 429,
  RATE_LIMITED: 429,
  DOWNLOAD_FAILED: 502,
  TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
  KIND_MISMATCH: 422,
  VIDEO_TOO_LONG: 422,
  INTERRUPTED: 500,
});

/** Transport-level codes not in the OpenAPI enum (generic routing/parse failures). */
export const TRANSPORT_STATUS = Object.freeze({
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INVALID_JSON: 400,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
});

export class HttpError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = status ?? ERROR_STATUS[code] ?? TRANSPORT_STATUS[code] ?? 500;
  }
}

export function sendJson(res, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    ...headers,
  });
  res.end(data);
}

/** Writes {error:{code,message}}. `code` should be an ErrorCode from openapi/sissi-v1.yaml. */
export function sendError(res, code, message, status, headers = {}) {
  const st = status ?? ERROR_STATUS[code] ?? TRANSPORT_STATUS[code] ?? 500;
  if (res.headersSent) {
    res.end();
    return;
  }
  sendJson(res, st, { error: { code, message } }, headers);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', headers = {}) {
  const data = Buffer.from(text);
  res.writeHead(status, { 'content-type': contentType, 'content-length': data.length, ...headers });
  res.end(data);
}

/** Reads and parses a JSON body, enforcing a byte cap. Throws HttpError(INVALID_JSON | PAYLOAD_TOO_LARGE). */
export async function readJsonBody(req, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError('PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBytes} bytes`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError('PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') throw new HttpError('INVALID_JSON', 'Request body must be JSON');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError('INVALID_JSON', 'Request body is not valid JSON');
  }
}

function compile(pattern) {
  const names = [];
  const re = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        names.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { re: new RegExp(`^${re}$`), names };
}

/**
 * createRouter({ publicPath, bodyLimit, metrics })
 * Incoming paths are matched with `publicPath` stripped when present (Traefik normally strips it
 * already, so both prefixed and unprefixed requests work). Routes are registered WITHOUT prefix.
 * Patterns support `:param` segments. Handlers receive ({ params, query, url, router }).
 */
export function createRouter({ publicPath = '', bodyLimit = 256 * 1024, metrics } = {}) {
  const routes = [];
  const prefix = publicPath;

  function add(method, pattern, handler) {
    routes.push({ method: method.toUpperCase(), ...compile(pattern), pattern, handler });
  }

  function stripPrefix(pathname) {
    if (prefix && (pathname === prefix || pathname.startsWith(prefix + '/'))) {
      return pathname.slice(prefix.length) || '/';
    }
    return pathname;
  }

  const router = {
    publicPath: prefix,
    bodyLimit,
    add,
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    patch: (p, h) => add('PATCH', p, h),
    delete: (p, h) => add('DELETE', p, h),
    /** Root-relative URL including the public prefix, e.g. router.url('/media/x.png'). */
    url: (path) => prefix + path,
    readJson: (req) => readJsonBody(req, bodyLimit),
    stripPrefix,

    async handle(req, res) {
      const started = process.hrtime.bigint();
      let routeLabel = 'unmatched';
      if (metrics) {
        res.once('finish', () => {
          const secs = Number(process.hrtime.bigint() - started) / 1e9;
          metrics.inc('sissi_http_requests_total', { method: req.method, route: routeLabel, status: res.statusCode }, 1, 'HTTP requests handled');
          metrics.inc('sissi_http_request_seconds_total', { route: routeLabel }, secs, 'Total HTTP handling time in seconds');
        });
      }
      try {
        const url = new URL(req.url, 'http://internal');
        let pathname;
        try {
          pathname = decodeURIComponent(stripPrefix(url.pathname));
        } catch {
          throw new HttpError('NOT_FOUND', 'Not found');
        }
        const method = req.method === 'HEAD' ? 'GET' : req.method;
        let pathMatched = false;
        for (const r of routes) {
          const m = r.re.exec(pathname);
          if (!m) continue;
          pathMatched = true;
          if (r.method !== method) continue;
          const params = {};
          r.names.forEach((n, i) => (params[n] = m[i + 1]));
          routeLabel = r.pattern;
          await r.handler(req, res, { params, query: url.searchParams, url, router });
          return;
        }
        if (pathMatched) throw new HttpError('METHOD_NOT_ALLOWED', 'Method not allowed');
        throw new HttpError('NOT_FOUND', 'Not found');
      } catch (err) {
        if (err instanceof HttpError) {
          sendError(res, err.code, err.message, err.status);
        } else {
          console.error('unhandled error:', err);
          sendError(res, 'INTERNAL', 'Internal server error', 500);
        }
      }
    },
  };
  return router;
}


