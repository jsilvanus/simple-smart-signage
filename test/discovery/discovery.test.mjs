import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigError, loadConfig } from '../../src/config.mjs';
import {
  MAX_ENTRIES,
  aspectRatioOf,
  buildDiscoveryServices,
  createDiscovery,
  exportTargetOf,
} from '../../src/discovery/index.mjs';
import { createAdminAuth } from '../../src/admin-auth/index.mjs';
import { registerAdminRoutes } from '../../src/api/admin.mjs';
import { createState } from '../../src/state/index.mjs';
import { createMemoryStorage } from '../../src/storage/index.mjs';
import { http, startTestServer } from '../helpers/server.mjs';

const ISSUER = 'https://tunnus.example.org/identity';
const SECRET = 'sissi-secret-value';
const AUTH = 'Basic ' + Buffer.from(`sissi:${SECRET}`).toString('base64');
const SILENT = { info() {}, warn() {}, error() {}, debug() {} };

function discoveryEnv(extra = {}) {
  return {
    SISSI_DISCOVERY: '1',
    SISSI_TUNNUS_ISSUER: `${ISSUER}/`,
    SISSI_TUNNUS_AUDIENCE: 'https://sissi.example.org',
    SISSI_OIDC_CLIENT_SECRET: SECRET,
    SISSI_BASE_URL: 'https://sissi.example.org',
    ...extra,
  };
}

function screen(extra) {
  return { kind: 'screen', orientation: 'landscape', width: null, height: null, ...extra };
}

/** Fake state with a mutable screen list. */
function fakeState(screens) {
  return {
    screens,
    async listScreens() {
      return structuredClone(this.screens).sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}

/** Fake fetch that records calls. `respond(url, init)` may return a Response-like or throw. */
function fakeFetch(respond = () => ({ status: 200 })) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body };
    calls.push(call);
    const r = respond(call);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return r.json ?? { ok: true };
      },
      async text() {
        return r.text ?? '';
      },
    };
  };
  return { fetch, calls };
}

async function waitFor(cond, ms = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const realImmediate = (r) => new Promise((resolve) => setImmediate(resolve));

/** Lets pending promise chains run without advancing mocked timers. */
async function settle(t) {
  // Flush promise chains, then advance the mock clock so the package's setTimeout(0) start fires,
  // then flush the registration that it starts.
  for (let i = 0; i < 4; i += 1) await realImmediate();
  t?.mock.timers.tick(1);
  for (let i = 0; i < 6; i += 1) await realImmediate();
}

function controllerFor(env, { screens = [], fetchImpl, logger = SILENT, retryMinMs, retryMaxMs } = {}) {
  const config = loadConfig(discoveryEnv({ SISSI_DISCOVERY_HEARTBEAT_SECONDS: '5', ...env }));
  const state = fakeState(screens);
  const ff = fakeFetch();
  const controller = createDiscovery(config, {
    state,
    fetch: fetchImpl ?? ff.fetch,
    logger,
    retryMinMs,
    retryMaxMs,
  });
  return { controller, state, calls: fetchImpl ? null : ff.calls, config };
}

const putCalls = (calls) => calls.filter((c) => c.method === 'PUT');


// ---- config -------------------------------------------------------------

test('discovery is off by default', () => {
  assert.equal(loadConfig({}).discovery, null);
  assert.equal(loadConfig({ SISSI_DISCOVERY: '0' }).discovery, null);
});

test('enabled config resolves issuer base, client id default, venue, prefix and public base', () => {
  const d = loadConfig(discoveryEnv()).discovery;
  assert.equal(d.tunnusUrl, ISSUER, 'trailing slash stripped, issuer path kept');
  assert.equal(d.clientId, 'sissi');
  assert.equal(d.clientSecret, SECRET);
  assert.equal(d.audience, 'https://sissi.example.org');
  assert.equal(d.venue, 'parish-wide');
  assert.equal(d.servicePrefix, 'sissi');
  assert.equal(d.heartbeatSeconds, 60);
  assert.equal(d.publicBaseUrl, 'https://sissi.example.org/signage');
});

test('enabled without secret or issuer reports problems', () => {
  assert.throws(
    () => loadConfig({ SISSI_DISCOVERY: '1', SISSI_TUNNUS_AUDIENCE: 'x' }),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.ok(err.problems.some((p) => p.includes('SISSI_TUNNUS_ISSUER')));
      assert.ok(err.problems.some((p) => p.includes('SISSI_OIDC_CLIENT_SECRET')));
      return true;
    },
  );
});

test('invalid venue and prefix are reported only when enabled', () => {
  assert.throws(
    () => loadConfig(discoveryEnv({ SISSI_DISCOVERY_VENUE: 'Parish Wide', SISSI_DISCOVERY_SERVICE_ID_PREFIX: 'Bad Prefix' })),
    (err) => {
      assert.ok(err.problems.some((p) => p.includes('SISSI_DISCOVERY_VENUE')));
      assert.ok(err.problems.some((p) => p.includes('SISSI_DISCOVERY_SERVICE_ID_PREFIX')));
      return true;
    },
  );
  assert.doesNotThrow(() => loadConfig({ SISSI_DISCOVERY_VENUE: 'Parish Wide' }));
});

// ---- payload builder ----------------------------------------------------

test('aspect ratio and resolution come from size, else orientation defaults', () => {
  assert.equal(aspectRatioOf(screen({ width: 1920, height: 1080 })), '16:9');
  assert.equal(aspectRatioOf(screen({ width: 1080, height: 1920 })), '9:16');
  assert.equal(aspectRatioOf(screen({})), '16:9');
  assert.equal(aspectRatioOf(screen({ orientation: 'vertical' })), '9:16');
  const t = exportTargetOf(screen({ id: 'hall', name: 'Hall', orientation: 'vertical' }));
  assert.deepEqual(t.resolution, { width: 1080, height: 1920 });
  assert.equal(t.body_defaults.screenId, 'hall');
  assert.equal(t.ingest.path, '/api/v1/push');
});

test('builds signage and webview services with the agreed shape', () => {
  const dc = loadConfig(discoveryEnv()).discovery;
  const long = 'x'.repeat(150);
  const { services, truncated } = buildDiscoveryServices(dc, [
    screen({ id: 'hall', name: 'Hall', width: 1920, height: 1080 }),
    screen({ id: 'long', name: long }),
    { id: 'news', kind: 'view', name: 'News', embed: {} },
    { id: 'all', kind: 'aggregate', name: 'All', members: ['news'] },
  ]);
  assert.deepEqual(truncated, []);
  const [signage, views] = services;

  assert.equal(signage.id, 'sissi-signage');
  assert.equal(signage.type, 'signage');
  assert.deepEqual(signage.capabilities, ['screen_push', 'playlist_management', 'export_target']);
  assert.deepEqual(signage.auth, { type: 'oidc', client_id: 'sissi', audience: 'https://sissi.example.org' });
  assert.equal(signage.endpoint_url, 'https://sissi.example.org/signage');
  assert.deepEqual(signage.metadata.screens, ['hall', 'long']);
  assert.equal(signage.metadata.export_targets.length, 2);
  assert.equal(signage.metadata.export_targets[1].name.length, 100);

  assert.equal(views.id, 'sissi-views');
  assert.equal(views.type, 'webview');
  assert.deepEqual(views.capabilities, ['embed', 'export_target']);
  assert.deepEqual(views.auth, { type: 'none' });
  assert.deepEqual(views.metadata.views, [
    {
      id: 'news',
      kind: 'view',
      name: 'News',
      frame_url: 'https://sissi.example.org/signage/v/news/frame',
      embed_script_url: 'https://sissi.example.org/signage/v/news/embed.js',
      playlist_url: 'https://sissi.example.org/signage/v/news/playlist.json',
    },
    {
      id: 'all',
      kind: 'aggregate',
      name: 'All',
      frame_url: 'https://sissi.example.org/signage/v/all/frame',
      embed_script_url: 'https://sissi.example.org/signage/v/all/embed.js',
      playlist_url: 'https://sissi.example.org/signage/v/all/playlist.json',
    },
  ]);
  assert.deepEqual(views.metadata.export_targets.map((t) => t.id), ['news'], 'aggregates are not push targets');
});

test('empty lists still produce both services, and entries are capped at 200', () => {
  const dc = loadConfig(discoveryEnv()).discovery;
  const empty = buildDiscoveryServices(dc, []).services;
  assert.deepEqual(empty[0].metadata, { export_targets: [], screens: [] });
  assert.deepEqual(empty[1].metadata, { views: [], export_targets: [] });

  const many = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => screen({ id: `s${i}`, name: `S${i}` }));
  const { services, truncated } = buildDiscoveryServices(dc, many);
  assert.equal(services[0].metadata.screens.length, MAX_ENTRIES);
  assert.deepEqual(truncated, ['screens']);
});

// ---- lifecycle (timers are mocked: @tunnus/discovery enforces a 5 s heartbeat and 1 s retry floor)

test('start registers both services with PUT, Basic auth and the Tunnus body shape', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { controller, calls } = controllerFor({}, { screens: [screen({ id: 'hall', name: 'Hall' })] });
  controller.start();
  await settle(t);
  assert.equal(putCalls(calls).length, 2);
  controller.stop();

  const [signagePut, viewsPut] = putCalls(calls);
  assert.equal(signagePut.url, `${ISSUER}/api/v1/discovery/services/sissi-signage`);
  assert.equal(viewsPut.url, `${ISSUER}/api/v1/discovery/services/sissi-views`);
  assert.equal(signagePut.headers.Authorization, AUTH);
  assert.equal(signagePut.headers['Content-Type'], 'application/json');
  const body = JSON.parse(signagePut.body);
  assert.equal(body.id, undefined, 'id is the path segment, not part of the body');
  assert.deepEqual(
    Object.keys(body).sort(),
    ['auth', 'capabilities', 'disabled', 'endpoint_url', 'metadata', 'name', 'type', 'venue'],
  );
  assert.equal(body.venue, 'parish-wide');
  assert.equal(JSON.parse(viewsPut.body).type, 'webview');
  assert.equal(controller.status().registered, true);
});

test('heartbeats both services on each heartbeat interval while nothing changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { controller, calls } = controllerFor({}, { screens: [screen({ id: 'hall' })] });
  controller.start();
  await settle(t);
  t.mock.timers.tick(5000);
  await settle(t);
  controller.stop();
  const hb = calls.filter((c) => c.url.endsWith('/heartbeat'));
  assert.ok(hb.some((c) => c.url === `${ISSUER}/api/v1/discovery/services/sissi-signage/heartbeat` && c.method === 'POST' && c.headers.Authorization === AUTH));
  assert.ok(hb.some((c) => c.url.endsWith('/sissi-views/heartbeat')));
  assert.equal(putCalls(calls).length, 2, 'no re-PUT without a change');
});

test('a screen added to the state re-PUTs only the changed service; refresh() does it at once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { controller, state, calls } = controllerFor({}, { screens: [screen({ id: 'hall' })] });
  controller.start();
  await settle(t);
  assert.equal(putCalls(calls).length, 2);

  state.screens.push(screen({ id: 'lobby', name: 'Lobby' }));
  assert.equal(await controller.refresh(), true);
  await settle(t);
  const puts = putCalls(calls);
  assert.equal(puts.length, 3);
  assert.equal(puts[2].url, `${ISSUER}/api/v1/discovery/services/sissi-signage`);
  assert.deepEqual(JSON.parse(puts[2].body).metadata.screens, ['hall', 'lobby']);

  // The periodic check picks up a change too, without refresh().
  state.screens.push(screen({ id: 'foyer' }));
  t.mock.timers.tick(5000);
  await settle(t);
  assert.equal(putCalls(calls).length, 4);
  assert.deepEqual(JSON.parse(putCalls(calls)[3].body).metadata.screens, ['foyer', 'hall', 'lobby']);
  controller.stop();
});

test('stop with deregister DELETEs both services and makes no further calls', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { controller, calls } = controllerFor({}, { screens: [] });
  controller.start();
  await settle(t);
  const stopping = controller.stop({ deregister: true });
  await settle(t);
  await stopping;
  const deletes = calls.filter((c) => c.method === 'DELETE');
  assert.deepEqual(deletes.map((c) => c.url), [
    `${ISSUER}/api/v1/discovery/services/sissi-signage`,
    `${ISSUER}/api/v1/discovery/services/sissi-views`,
  ]);
  assert.equal(deletes[0].headers.Authorization, AUTH);
  const before = calls.length;
  t.mock.timers.tick(60000);
  await settle(t);
  assert.equal(calls.length, before, 'no calls after stop');
});

test('401 stops everything after one attempt per service and logs an error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const errors = [];
  const { controller, calls } = controllerFor({}, {
    fetchImpl: fakeFetch(() => ({ status: 401, text: 'bad client' })).fetch,
    logger: { ...SILENT, error: (m) => errors.push(m) },
  });
  const seen = [];
  const ff = fakeFetch((call) => {
    seen.push(call);
    return { status: 401, text: 'bad client' };
  });
  // Rebuild with the recording fetch so we can count calls.
  const rebuilt = controllerFor({}, { fetchImpl: ff.fetch, logger: { ...SILENT, error: (m) => errors.push(m) } });
  rebuilt.controller.start();
  await settle(t);
  t.mock.timers.tick(120000);
  await settle(t);
  assert.equal(seen.length, 2, 'one PUT per service, then no retries');
  assert.equal(errors.filter((m) => m.includes('not retrying')).length, 1, 'controller logs the refusal once');
  assert.equal(rebuilt.controller.status().fatal, true);
  await rebuilt.controller.refresh();
  assert.equal(seen.length, 2, 'refresh does nothing once fatal');
  await rebuilt.controller.stop({ deregister: true });
  assert.equal(seen.filter((c) => c.method === 'DELETE').length, 0, 'no deregister after a fatal auth error');
  controller.stop();
  void calls;
});

test('403 is fatal too', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const seen = [];
  const { controller } = controllerFor({}, {
    fetchImpl: fakeFetch((call) => {
      seen.push(call);
      return { status: 403 };
    }).fetch,
  });
  controller.start();
  await settle(t);
  t.mock.timers.tick(120000);
  await settle(t);
  assert.equal(seen.length, 2);
  assert.equal(controller.status().fatal, true);
  controller.stop();
});

test('network failures are retried with backoff until registration succeeds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let failuresLeft = 2;
  const warnings = [];
  const seen = [];
  const { controller } = controllerFor({}, {
    fetchImpl: fakeFetch((call) => {
      seen.push(call);
      if (failuresLeft-- > 0) return new Error('ECONNREFUSED');
      return { status: 200 };
    }).fetch,
    logger: { ...SILENT, warn: (m) => warnings.push(m) },
  });
  controller.start();
  await settle(t);
  assert.equal(seen.length, 2, 'both first attempts failed');
  assert.ok(warnings.some((w) => w.includes('Retrying')), 'failure is logged as a warning');
  t.mock.timers.tick(20000);
  await settle(t);
  assert.equal(seen.length, 4, 'retried both services');
  assert.equal(controller.status().registered, true);
  controller.stop();
});

test('refresh never rejects when reading the screens fails', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const config = loadConfig(discoveryEnv());
  const errors = [];
  const controller = createDiscovery(config, {
    state: { async listScreens() { throw new Error('storage down'); } },
    fetch: fakeFetch().fetch,
    logger: { ...SILENT, warn: (m) => errors.push(m) },
  });
  assert.equal(await controller.refresh(), false, 'not running yet');
  controller.start();
  await settle(t);
  assert.equal(await controller.refresh(), false);
  assert.ok(errors.some((m) => m.includes('storage down')));
  await controller.stop();
});

test('disabled discovery is a no-op controller', async () => {
  const controller = createDiscovery(loadConfig({}), { state: fakeState([]) });
  assert.equal(controller.enabled, false);
  controller.start();
  assert.equal(await controller.refresh(), false);
  await controller.stop({ deregister: true });
});

test('admin screen create triggers a discovery refresh', async (t) => {
  const storage = createMemoryStorage();
  const state = createState(storage);
  const refreshes = [];
  const srv = await startTestServer(
    { SISSI_ADMIN_PASSWORD: 'correct-horse-battery-staple', SISSI_PUSH_KEY: 'push-secret-key' },
    { storage, state, discovery: { refresh: async () => refreshes.push(Date.now()) } },
  );
  t.after(() => srv.close());
  srv.ctx.adminAuth = createAdminAuth(srv.config);
  registerAdminRoutes(srv.ctx.router, srv.ctx);
  const login = await http(srv.base, '/signage/api/v1/admin/login', {
    method: 'POST',
    body: { password: 'correct-horse-battery-staple' },
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const res = await http(srv.base, '/signage/api/v1/admin/screens', {
    method: 'POST',
    headers: { cookie, 'x-sissi-admin': '1' },
    body: { id: 'hall', name: 'Hall' },
  });
  assert.equal(res.status, 201);
  await waitFor(() => refreshes.length === 1);
});
