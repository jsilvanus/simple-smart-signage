import { HttpError, sendJson, sendText } from '../router.mjs';

/**
 * Browser sign-in to /admin with Tunnus (see src/admin-oidc/index.mjs):
 * - GET /admin/login      -> 302 to Tunnus
 * - GET /admin/callback   -> finishes sign-in, sets the session cookie, 302 to /admin/
 * - GET /api/v1/admin/auth-config -> which sign-in methods this install offers (no secrets)
 */
export function registerAdminOidcRoutes(router, ctx) {
  const { config, adminOidc, adminAuth } = ctx;
  const cookiePath = config.publicPath || '/';
  const secure = Boolean(config.production);

  function redirectUri() {
    // SISSI_BASE_URL is the origin; the callback path carries the public path.
    return `${new URL(config.baseUrl).origin}${router.url('/admin/callback')}`;
  }

  function sendCallbackError(res, status, message) {
    const escaped = String(message || 'Sign-in failed.')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const backHref = router.url('/admin/');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title></head><body><h1>Sign-in failed</h1><p>${escaped}</p><p><a href="${backHref}">Back to Sissi Admin</a></p></body></html>`;
    sendText(res, status, html, 'text/html; charset=utf-8', { 'cache-control': 'no-store' });
  }

  router.get('/api/v1/admin/auth-config', (req, res) => {
    const session = Boolean(adminOidc?.readSession(req.headers.cookie) || adminAuth?.hasAdminCookie?.(req));
    sendJson(res, 200, {
      tunnus: Boolean(adminOidc),
      password: config.authMode !== 'tunnus' && config.passwordLogin !== false && Boolean(config.adminPassword),
      session,
    });
  });

  router.get('/admin/login', async (req, res) => {
    if (!adminOidc) throw new HttpError('NOT_FOUND', 'Not found');
    const { location, setCookie } = await adminOidc.beginLogin({ redirectUri: redirectUri(), cookiePath, secure });
    res.writeHead(302, { location, 'set-cookie': setCookie, 'cache-control': 'no-store' });
    res.end();
  });

  router.get('/admin/callback', async (req, res, { query }) => {
    if (!adminOidc) throw new HttpError('NOT_FOUND', 'Not found');
    if (query.get('error')) {
      sendCallbackError(res, 401, 'Sign-in was cancelled or refused.');
      return;
    }
    try {
      const { sessionCookie, clearTx } = await adminOidc.finishLogin({
        code: query.get('code'),
        state: query.get('state'),
        cookieHeader: req.headers.cookie,
        redirectUri: redirectUri(),
        cookiePath,
        secure,
      });
      res.writeHead(302, {
        location: router.url('/admin/'),
        'set-cookie': [sessionCookie, clearTx],
        'cache-control': 'no-store',
      });
      res.end();
    } catch (err) {
      sendCallbackError(res, 401, err.message || 'Sign-in failed.');
    }
  });
}

export { registerAdminOidcRoutes as registerAdminOidc };
