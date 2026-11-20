import { timingSafeEqual } from 'node:crypto';
import { HttpError, sendJson } from '../router.mjs';
import { evaluateSchedule } from '../power/schedule.mjs';

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function authenticateAgent(req, agentTokens) {
  const entries = Object.entries(agentTokens ?? {});
  if (entries.length === 0) {
    throw new HttpError('AUTH_NOT_CONFIGURED', 'Power agent tokens are not configured');
  }
  const header = req.headers.authorization ?? '';
  const m = /^Bearer (.+)$/i.exec(header);
  if (!m) {
    throw new HttpError('UNAUTHORIZED', 'Missing or invalid agent bearer token');
  }
  const token = m[1];
  let matchedLanId = null;
  for (const [lanId, expected] of entries) {
    if (safeEqual(token, expected)) {
      matchedLanId = lanId;
    }
  }
  if (!matchedLanId) {
    throw new HttpError('UNAUTHORIZED', 'Missing or invalid agent bearer token');
  }
  return matchedLanId;
}

/**
 * Register pull-style power agent endpoints:
 * - `GET /api/v1/power/desired`
 * - `POST /api/v1/power/report`
 */
export function registerPowerRoutes(router, ctx) {
  const { config, state } = ctx;

  router.get('/api/v1/power/desired', async (req, res) => {
    const lanId = authenticateAgent(req, config.agentTokens);
    const nowVal = ctx.now ? ctx.now() : new Date();
    const now = nowVal instanceof Date ? nowVal : new Date(nowVal);

    const screens = await state.listScreens();
    const devices = [];
    for (const s of screens) {
      const p = s.power;
      if (!p || p.lanId !== lanId || !p.driver || p.driver === 'none' || p.routerId) {
        continue;
      }
      devices.push({
        screenId: s.id,
        driver: p.driver,
        mac: p.mac ?? null,
        ip: p.ip ?? null,
        desiredState: evaluateSchedule(p, now),
      });
    }

    sendJson(res, 200, {
      lanId,
      serverTime: now.toISOString(),
      devices,
    });
  });

  router.post('/api/v1/power/report', async (req, res) => {
    const lanId = authenticateAgent(req, config.agentTokens);
    const body = await router.readJson(req);
    if (!body || typeof body !== 'object' || !Array.isArray(body.devices)) {
      throw new HttpError('INVALID_SCREEN', 'Request body must include a devices array');
    }
    const recorded = state.recordPowerReport(lanId, body.devices);
    sendJson(res, 200, { ok: true, recorded: recorded.length });
  });
}
