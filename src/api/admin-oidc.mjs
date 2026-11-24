import { HttpError, sendJson, sendText } from '../router.mjs';

/**
 * Browser sign-in to /admin with Tunnus (see src/admin-oidc/index.mjs):
 * - GET /admin/login      -> 302 to Tunnus
 * - GET /admin/callback   -> finishes sign-in, sets the session cookie, 302 to /admin/
 * - GET /api/v1/admin/auth-config -> which sign-in methods this install offers (no secrets)
 */
export function registerAdminOidcRoutes(router, ctx) {
  const { config, adminOidc } = ctx;
  const cookiePath = config.publicPath || '/';
  const secure = Boolean(config.production);

  function redirectUri() {
    // SISSI_BASE_URL is the origin; the callback path carries the public path.
    return `${new URL(config.baseUrl).origin}${router.url('/admin/callback')}`;
  }

  router.get('/api/v1/admin/auth-config', (req, res) => {
    sendJson(res, 200, {
      tunnus: Boolean(adminOidc),
      password: config.authMode !== 'tunnus' && Boolean(config.adminPassword),
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
      sendText(res, 401, 'Sign-in was cancelled or refused.', 'text/plain; charset=utf-8', { 'cache-control': 'no-store' });
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
      sendText(res, 401, err.message || 'Sign-in failed.', 'text/plain; charset=utf-8', { 'cache-control': 'no-store' });
    }
  });
}

export { registerAdminOidcRoutes as registerAdminOidc };
