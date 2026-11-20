import { createAdminAuth } from '../admin-auth/index.mjs';
import { ERROR_STATUS, HttpError, sendJson } from '../router.mjs';
import { StateError } from '../state/index.mjs';

const SCREEN_ID_RE = /^[a-z0-9-]{1,40}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;

function assertScreenId(screenId) {
  if (typeof screenId !== 'string' || !SCREEN_ID_RE.test(screenId)) {
    throw new HttpError('SCREEN_NOT_FOUND', `Unknown screen: ${screenId}`);
  }
}

function assertOpaqueId(id, errorCode, label) {
  if (typeof id !== 'string' || !OPAQUE_ID_RE.test(id) || id.includes('..')) {
    throw new HttpError(errorCode, `Unknown ${label}: ${id}`);
  }
}

async function runState(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StateError) {
      throw new HttpError(err.code, err.message, ERROR_STATUS[err.code] ?? err.status);
    }
    throw err;
  }
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

/**
 * Register all /api/v1/admin/* endpoints on `router`.
 */
export function registerAdminRoutes(router, ctx) {
  const { config, state, storage } = ctx;
  const adminAuth = ctx.adminAuth ?? createAdminAuth(config);

  async function triggerGc() {
    if (!storage || typeof state?.gcSweep !== 'function') return;
    try {
      await state.gcSweep(storage, { graceMinutes: config.gcGraceMinutes });
    } catch (err) {
      console.error('admin gcSweep failed:', err);
    }
  }

  function withPowerStatus(screen) {
    const powerStatus = typeof state?.getPowerStatus === 'function' ? state.getPowerStatus(screen.id) : null;
    return powerStatus ? { ...screen, powerStatus } : screen;
  }

  router.post('/api/v1/admin/login', async (req, res) => {
    const body = await router.readJson(req);
    await adminAuth.login(req, res, body);
  });

  router.post('/api/v1/admin/logout', (req, res) => {
    adminAuth.requireAdmin(req);
    adminAuth.logout(req, res);
  });

  router.get('/api/v1/admin/screens', async (req, res) => {
    adminAuth.requireAdmin(req);
    const screens = await runState(() => state.listScreens());
    sendJson(res, 200, { screens: screens.map(withPowerStatus) });
  });

  router.post('/api/v1/admin/screens', async (req, res) => {
    adminAuth.requireAdmin(req);
    const body = await router.readJson(req);
    const screen = await runState(() => state.createScreen(body));
    sendJson(res, 201, withPowerStatus(screen));
  });

  router.patch('/api/v1/admin/screens/:screenId', async (req, res, { params }) => {
    adminAuth.requireAdmin(req);
    assertScreenId(params.screenId);
    const body = await router.readJson(req);
    const screen = await runState(() => state.updateScreen(params.screenId, body));
    sendJson(res, 200, withPowerStatus(screen));
  });

  router.post('/api/v1/admin/screens/:screenId/power/override', async (req, res, { params }) => {
    adminAuth.requireAdmin(req);
    assertScreenId(params.screenId);
    const body = await router.readJson(req);
    const screen = await runState(() => state.setPowerOverride(params.screenId, body?.override));
    sendJson(res, 200, withPowerStatus(screen));
  });

  router.delete('/api/v1/admin/screens/:screenId', async (req, res, { params }) => {
    adminAuth.requireAdmin(req);
    assertScreenId(params.screenId);
    await runState(() => state.deleteScreen(params.screenId));
    await triggerGc();
    sendNoContent(res);
  });

  router.put('/api/v1/admin/screens/:screenId/entries', async (req, res, { params }) => {
    adminAuth.requireAdmin(req);
    assertScreenId(params.screenId);
    const body = await router.readJson(req);
    const screen = await runState(() => state.reorderEntries(params.screenId, body?.entryIds));
    sendJson(res, 200, {
      screenId: screen.id,
      version: screen.playlistVersion,
      entries: screen.entries,
    });
  });

  router.patch('/api/v1/admin/screens/:screenId/entries/:entryId', async (req, res, { params }) => {
    adminAuth.requireAdmin(req);
    assertScreenId(params.screenId);
    assertOpaqueId(params.entryId, 'ENTRY_NOT_FOUND', 'entry');
    const body = await router.readJson(req);
    const screen = await runState(() => state.setEntrySeconds(params.screenId, params.entryId, body?.seconds));
    const entry = screen.entries.find((e) => e.entryId === params.entryId);
    sendJson(res, 200, entry);
  });

  router.delete('/api/v1/admin/screens/:screenId/entries/:entryId', async (req, res, { params }) => {
    adminAuth.requireAdmin(req);
    assertScreenId(params.screenId);
    assertOpaqueId(params.entryId, 'ENTRY_NOT_FOUND', 'entry');
    await runState(() => state.removeEntry(params.screenId, params.entryId));
    await triggerGc();
    sendNoContent(res);
  });

  router.delete('/api/v1/admin/screens/:screenId/pushes/:pushId', async (req, res, { params }) => {
    adminAuth.requireAdmin(req);
    assertScreenId(params.screenId);
    assertOpaqueId(params.pushId, 'PUSH_NOT_FOUND', 'push');
    await runState(() => state.removePush(params.screenId, params.pushId));
    await triggerGc();
    sendNoContent(res);
  });
}

export { registerAdminRoutes as registerAdmin };
