import { timingSafeEqual } from 'node:crypto';
import { sendJson, sendText, HttpError } from './router.mjs';
import { registerPush } from './api/push.mjs';
import { registerReadRoutes } from './api/read.mjs';
import { registerAdminRoutes } from './api/admin.mjs';
import { registerPlayerRoutes } from './api/player.mjs';
import { registerAdminUiRoutes } from './api/admin-ui.mjs';
import { registerViewRoutes } from './api/views.mjs';
import { registerPowerRoutes } from './api/power.mjs';
import { registerAdminOidcRoutes } from './api/admin-oidc.mjs';

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * EXTENSION POINT. Later tasks register their routes here, one module per surface.
 *
 * ctx = { config, router, metrics, storage, state, auth, download }
 *   - config, router, metrics: always present.
 *   - storage, state, auth, download: undefined in Phase 0; supplied through createServer(config, deps)
 *     (deps.storage etc.) once Phase 1 modules exist.
 *
 * Each module exports `register(router, ctx)`; add the import and call below.
 * Route patterns are WITHOUT the public prefix (router strips/adds SISSI_PUBLIC_PATH).
 * Throw HttpError(code, message) for errors; use router.readJson(req) for bodies.
 */
export function registerRoutes(router, ctx) {
  const { config, metrics } = ctx;

  router.get('/health', (req, res) => sendJson(res, 200, { ok: true }));

  router.get('/metrics', (req, res) => {
    const header = req.headers.authorization ?? '';
    const m = /^Bearer (.+)$/i.exec(header);
    if (!config.metricsToken) {
      throw new HttpError('AUTH_NOT_CONFIGURED', 'Metrics are not configured');
    }
    if (!m || !safeEqual(m[1], config.metricsToken)) {
      throw new HttpError('UNAUTHORIZED', 'Missing or invalid bearer token');
    }
    sendText(res, 200, metrics.render(), 'text/plain; version=0.0.4; charset=utf-8');
  });

  if (ctx.state && ctx.storage && ctx.auth && (ctx.pushRunner || ctx.download)) {
    registerPush(router, ctx);
  }
  if (ctx.state && ctx.storage && ctx.auth) {
    registerReadRoutes(router, ctx);
  }
  if (ctx.state && ctx.storage && ctx.adminAuth) {
    registerAdminRoutes(router, ctx);
  }
  if (ctx.state) {
    registerViewRoutes(router, ctx);
    registerPlayerRoutes(router, ctx);
    registerPowerRoutes(router, ctx);
  }
  registerAdminOidcRoutes(router, ctx);
  registerAdminUiRoutes(router, ctx);
}
