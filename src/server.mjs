import http from 'node:http';
import { createRouter } from './router.mjs';
import { createMetrics } from './metrics.mjs';
import { registerRoutes } from './routes.mjs';

/**
 * createServer(config, deps = {}) -> node:http Server (not listening).
 * deps may carry { storage, state, auth, download, metrics } (all optional in Phase 0).
 * The server exposes `server.ctx` (the registerRoutes ctx) for tests and later wiring.
 */
export function createServer(config, deps = {}) {
  const metrics = deps.metrics ?? createMetrics();
  const router = createRouter({ publicPath: config.publicPath, bodyLimit: config.limits.bodyBytes, metrics });
  const ctx = {
    config,
    router,
    metrics,
    storage: deps.storage,
    state: deps.state,
    auth: deps.auth,
    download: deps.download,
    pushRunner: deps.pushRunner,
    adminAuth: deps.adminAuth,
    adminOidc: deps.adminOidc,
    now: deps.now,
  };
  registerRoutes(router, ctx);
  const server = http.createServer((req, res) => {
    if (ctx.auth?.handleCors?.(req, res)) return;
    router.handle(req, res);
  });
  server.ctx = ctx;
  return server;
}
