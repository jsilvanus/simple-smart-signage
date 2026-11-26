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
const PUBLIC_BASE = 'https://sissi.example.org/signage';
const SECRET = 'sissi-secret-value';
const AUTH = 'Basic ' + Buffer.from(`sissi:${SECRET}`).toString('base64');
const SILENT = { info() {}, warn() {}, error() {}, debug() {} };

function discoveryEnv(extra = {}) {
  return {
    SISSI_AUTH_MODE: 'tunnus',
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

/** Fake state with a mutable screen list (sorted by id, like state.listScreens). */
function fakeState(screens) {
  return {
    screens,
    async listScreens() {
      return structuredClone(this.screens).sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}

function abortError() {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

/**
 * Fake fetch that honours AbortSignal and records every call. `respond(call)` returns a
 * Response-like object, an Error, or a promise of either (a promise may reject on abort).
 */
function fakeFetch(respond = () => ({ status: 200 })) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = {
      url,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body,
      signal: init.signal,
      landed: false,
    };
    calls.push(call);
    if (init.signal?.aborted) throw abortError();
    const r = await respond(call);
    if (init.signal?.aborted) throw abortError();
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    if (status >= 200 && status < 300) call.landed = true;
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

const realImmediate = () => new Promise((resolve) => setImmediate(resolve));

/** Lets promise chains run; with mocked timers, also fires the package's setTimeout(0) start. */
async function settle(t) {
  for (let i = 0; i < 4; i += 1) await realImmediate();
  t?.mock.timers.tick(1);
  for (let i = 0; i < 6; i += 1) await realImmediate();
}

function controllerFor(env = {}, { screens = [], respond, logger = SILENT } = {}) {
  const config = loadConfig(discoveryEnv({ SISSI_DISCOVERY_HEARTBEAT_SECONDS: '5', ...env }));
  const state = fakeState(screens);
  const ff = fakeFetch(respond);
  const controller = createDiscovery(config, { state, fetch: ff.fetch, logger });
  return { controller, state, calls: ff.calls };
}

const putCalls = (calls) => calls.filter((c) => c.method === 'PUT');

/** Resolves an export target's ingest URL the way the Tunnus contract describes. */
function resolveIngest(target, service) {
  return target.ingest.url ? target.ingest.url : new URL(target.ingest.path, service.endpoint_url).toString();
}

// ---- config -------------------------------------------------------------

test('discovery is off by default', () => {
  assert.equal(loadConfig({}).discovery, null);
  assert.equal(loadConfig({ SISSI_DISCOVERY: '0' }).discovery, null);
});

test('enabled config resolves issuer base, client ids, venue, prefix and public base', () => {
  const d = loadConfig(discoveryEnv()).discovery;
  assert.equal(d.tunnusUrl, ISSUER, 'trailing slash stripped, issuer path kept');
  assert.equal(d.clientId, 'sissi');
  assert.equal(d.clientSecret, SECRET);
  assert.equal(d.publisherClientId, 'sissi', 'publisher id defaults to the sissi client id');
  assert.equal(d.audience, 'https://sissi.example.org');
  assert.equal(d.venue, 'parish-wide');
  assert.equal(d.servicePrefix, 'sissi');
  assert.equal(d.heartbeatSeconds, 60);
  assert.equal(d.publicBaseUrl, PUBLIC_BASE);
});

test('SISSI_DISCOVERY_PUBLISHER_CLIENT_ID overrides the advertised auth client id only', () => {
  const d = loadConfig(discoveryEnv({ SISSI_DISCOVERY_PUBLISHER_CLIENT_ID: 'publisher-app' })).discovery;
  assert.equal(d.publisherClientId, 'publisher-app');
  assert.equal(d.clientId, 'sissi', 'Basic auth still uses the Sissi client');
});

test('enabled without secret or issuer reports problems', () => {
  assert.throws(
    () => loadConfig({ SISSI_AUTH_MODE: 'tunnus', SISSI_DISCOVERY: '1', SISSI_TUNNUS_AUDIENCE: 'x' }),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.ok(err.problems.some((p) => p.includes('SISSI_TUNNUS_ISSUER')));
      assert.ok(err.problems.some((p) => p.includes('SISSI_OIDC_CLIENT_SECRET')));
      return true;
    },
  );
});

test('discovery is refused when the auth mode is legacy', () => {
  assert.throws(
    () => loadConfig(discoveryEnv({ SISSI_AUTH_MODE: 'legacy' })),
    (err) => {
      assert.ok(err.problems.some((p) => p.includes('SISSI_AUTH_MODE=both or tunnus')));
      return true;
    },
  );
  assert.doesNotThrow(() => loadConfig(discoveryEnv({ SISSI_AUTH_MODE: 'both' })));
});

test('production requires an explicit https SISSI_BASE_URL when discovery is on', () => {
  const base = { NODE_ENV: 'production', ...discoveryEnv() };
  delete base.SISSI_BASE_URL;
  assert.throws(
    () => loadConfig(base),
    (err) => {
      assert.ok(err.problems.some((p) => p.includes('SISSI_BASE_URL must be an explicit https URL')));
      return true;
    },
  );
  assert.throws(
    () => loadConfig({ ...discoveryEnv(), NODE_ENV: 'production', SISSI_BASE_URL: 'http://sissi.example.org' }),
    ConfigError,
  );
  assert.doesNotThrow(() => loadConfig({ ...discoveryEnv(), NODE_ENV: 'production' }));
  // Outside production the localhost default is fine for local runs.
  const dev = discoveryEnv();
  delete dev.SISSI_BASE_URL;
  assert.equal(loadConfig(dev).discovery.publicBaseUrl, 'http://localhost:3000/signage');
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
  const t = exportTargetOf(screen({ id: 'hall', name: 'Hall', orientation: 'vertical' }), PUBLIC_BASE);
  assert.deepEqual(t.resolution, { width: 1080, height: 1920 });
  assert.equal(t.body_defaults.screenId, 'hall');
  assert.equal(t.ingest.url, `${PUBLIC_BASE}/api/v1/push`);
  assert.equal(t.ingest.auth, undefined, 'screen targets inherit the service auth');
});

test('ingest URL keeps the public path when resolved the way the contract does', () => {
  const dc = loadConfig(discoveryEnv()).discovery;
  const { services } = buildDiscoveryServices(dc, [
    screen({ id: 'hall', name: 'Hall' }),
    { id: 'news', kind: 'view', name: 'News', embed: {} },
  ]);
  const [signage, views] = services;
  assert.equal(resolveIngest(signage.metadata.export_targets[0], signage), `${PUBLIC_BASE}/api/v1/push`);
  assert.equal(resolveIngest(views.metadata.export_targets[0], views), `${PUBLIC_BASE}/api/v1/push`);
  // A bare path would be resolved against the origin and lose /signage; that is why ingest.url is absolute.
  assert.equal(new URL('/api/v1/push', signage.endpoint_url).toString(), 'https://sissi.example.org/api/v1/push');
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
  assert.equal(signage.endpoint_url, PUBLIC_BASE);
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
      frame_url: `${PUBLIC_BASE}/v/news/frame`,
      embed_script_url: `${PUBLIC_BASE}/v/news/embed.js`,
      playlist_url: `${PUBLIC_BASE}/v/news/playlist.json`,
    },
    {
      id: 'all',
      kind: 'aggregate',
      name: 'All',
      frame_url: `${PUBLIC_BASE}/v/all/frame`,
      embed_script_url: `${PUBLIC_BASE}/v/all/embed.js`,
      playlist_url: `${PUBLIC_BASE}/v/all/playlist.json`,
    },
  ]);
  assert.deepEqual(views.metadata.export_targets.map((t) => t.id), ['news'], 'aggregates are not push targets');
});

test('view export targets carry the oidc ingest auth; the service itself has none', () => {
  const dc = loadConfig(discoveryEnv({ SISSI_DISCOVERY_PUBLISHER_CLIENT_ID: 'publisher-app' })).discovery;
  const { services } = buildDiscoveryServices(dc, [{ id: 'news', kind: 'view', name: 'News', embed: {} }]);
  const [target] = services[1].metadata.export_targets;
  assert.deepEqual(target.ingest.auth, { type: 'oidc', client_id: 'publisher-app', audience: 'https://sissi.example.org' });
  assert.deepEqual(services[1].auth, { type: 'none' });
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

test('size budget drops the same views from views and export_targets', () => {
  const dc = loadConfig(discoveryEnv()).discovery;
  const views = Array.from({ length: 200 }, (_, i) => ({
    id: `v${String(i).padStart(3, '0')}`,
    kind: 'view',
    name: 'N'.repeat(100),
    embed: {},
  }));
  const { services, truncated } = buildDiscoveryServices(dc, views);
  const meta = services[1].metadata;
  assert.ok(Buffer.byteLength(JSON.stringify(meta)) <= 80_000);
  assert.ok(truncated.includes('views (size budget)'));
  assert.ok(meta.views.length < 200);
  assert.deepEqual(
    meta.export_targets.map((t) => t.id),
    meta.views.map((v) => v.id),
    'the same views appear in both lists, in the same order',
  );
});

// ---- lifecycle (timers are mocked: @tunnus/discovery enforces a 5 s heartbeat and 1 s retry floor)

test('start registers both services with PUT, Basic auth and the Tunnus body shape', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { controller, calls } = controllerFor({}, { screens: [screen({ id: 'hall', name: 'Hall' })] });
  controller.start();
  await settle(t);
  assert.equal(putCalls(calls).length, 2);

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
  assert.equal(JSON.parse(viewsPut.body).type, 'webview');
  assert.equal(controller.status().registered, true);
  await controller.stop();
});

test('heartbeats both services on each heartbeat interval while nothing changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { controller, calls } = controllerFor({}, { screens: [screen({ id: 'hall' })] });
  controller.start();
  await settle(t);
  t.mock.timers.tick(5000);
  await settle(t);
  const hb = calls.filter((c) => c.url.endsWith('/heartbeat'));
  assert.ok(hb.some((c) => c.url === `${ISSUER}/api/v1/discovery/services/sissi-signage/heartbeat` && c.method === 'POST' && c.headers.Authorization === AUTH));
  assert.ok(hb.some((c) => c.url.endsWith('/sissi-views/heartbeat')));
  assert.equal(putCalls(calls).length, 2, 'no re-PUT without a change');
  await controller.stop();
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
  await controller.stop();
});

test('a replacement aborts the stale PUT and waits for it, so the stale body never lands', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let heldFirst = false;
  const respond = (call) => {
    if (call.method === 'PUT' && call.url.endsWith('/sissi-signage') && !heldFirst) {
      heldFirst = true;
      // A slow registration: it only ends when the client aborts it.
      return new Promise((_, reject) => call.signal.addEventListener('abort', () => reject(abortError())));
    }
    return { status: 200 };
  };
  const { controller, state, calls } = controllerFor({}, { screens: [screen({ id: 'hall' })], respond });
  controller.start();
  await settle(t);
  assert.equal(heldFirst, true);

  state.screens.push(screen({ id: 'lobby' }));
  assert.equal(await controller.refresh(), true);
  await settle(t);

  const signagePuts = putCalls(calls).filter((c) => c.url.endsWith('/sissi-signage'));
  assert.equal(signagePuts.length, 2);
  assert.equal(signagePuts[0].landed, false, 'the stale PUT was aborted');
  assert.equal(signagePuts[0].signal.aborted, true);
  const landed = signagePuts.filter((c) => c.landed).map((c) => JSON.parse(c.body).metadata.screens);
  assert.deepEqual(landed, [['hall', 'lobby']], 'only the newer payload landed');
  await controller.stop();
});

test('stop aborts in-flight PUTs and deregisters both services under one budget', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const respond = (call) => {
    if (call.method === 'PUT' && call.url.endsWith('/sissi-signage')) {
      return new Promise((_, reject) => call.signal.addEventListener('abort', () => reject(abortError())));
    }
    return { status: 200 };
  };
  const { controller, calls } = controllerFor({}, { screens: [], respond });
  controller.start();
  await settle(t);
  await controller.stop({ deregister: true, timeoutMs: 3000 });
  const deletes = calls.filter((c) => c.method === 'DELETE');
  assert.deepEqual(deletes.map((c) => c.url), [
    `${ISSUER}/api/v1/discovery/services/sissi-signage`,
    `${ISSUER}/api/v1/discovery/services/sissi-views`,
  ]);
  assert.equal(deletes[0].headers.Authorization, AUTH);
  assert.equal(calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/sissi-signage') && c.landed).length, 0);
  const before = calls.length;
  t.mock.timers.tick(120000);
  await settle(t);
  assert.equal(calls.length, before, 'no calls after stop');
});

test('stop without deregister leaves the registration alone', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { controller, calls } = controllerFor({}, { screens: [] });
  controller.start();
  await settle(t);
  await controller.stop();
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
});

test('401 stops everything after one attempt per service and logs an error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const errors = [];
  const { controller, state, calls } = controllerFor({}, {
    respond: () => ({ status: 401, text: 'bad client' }),
    logger: { ...SILENT, error: (m) => errors.push(m) },
  });
  controller.start();
  await settle(t);
  t.mock.timers.tick(120000);
  await settle(t);
  assert.equal(calls.length, 2, 'one PUT per service, then no retries');
  assert.equal(errors.filter((m) => m.includes('not retrying')).length, 1, 'controller logs the refusal once');
  assert.equal(controller.status().fatal, true);
  state.screens.push(screen({ id: 'late' }));
  assert.equal(await controller.refresh(), false);
  assert.equal(calls.length, 2, 'refresh does nothing once fatal');
  await controller.stop({ deregister: true });
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, 'no deregister after a fatal auth error');
});

test('403 is fatal too', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { controller, calls } = controllerFor({}, { respond: () => ({ status: 403 }) });
  controller.start();
  await settle(t);
  t.mock.timers.tick(120000);
  await settle(t);
  assert.equal(calls.length, 2);
  assert.equal(controller.status().fatal, true);
  await controller.stop();
});

test('network failures are retried with backoff until registration succeeds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let failuresLeft = 2;
  const warnings = [];
  const { controller, calls } = controllerFor({}, {
    respond: () => {
      if (failuresLeft-- > 0) return new Error('ECONNREFUSED');
      return { status: 200 };
    },
    logger: { ...SILENT, warn: (m) => warnings.push(m) },
  });
  controller.start();
  await settle(t);
  assert.equal(calls.length, 2, 'both first attempts failed');
  assert.ok(warnings.some((w) => w.includes('Retrying')), 'failure is logged as a warning');
  t.mock.timers.tick(20000);
  await settle(t);
  assert.equal(calls.length, 4, 'retried both services');
  assert.equal(controller.status().registered, true);
  await controller.stop();
});

test('refresh never rejects when reading the screens fails', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const config = loadConfig(discoveryEnv());
  const warnings = [];
  const controller = createDiscovery(config, {
    state: { async listScreens() { throw new Error('storage down'); } },
    fetch: fakeFetch().fetch,
    logger: { ...SILENT, warn: (m) => warnings.push(m) },
  });
  assert.equal(await controller.refresh(), false, 'not running yet');
  controller.start();
  await settle(t);
  assert.equal(await controller.refresh(), false);
  assert.ok(warnings.some((m) => m.includes('storage down')));
  await controller.stop();
});

test('disabled discovery is a no-op controller', async () => {
  const controller = createDiscovery(loadConfig({}), { state: fakeState([]) });
  assert.equal(controller.enabled, false);
  controller.start();
  assert.equal(await controller.refresh(), false);
  await controller.stop({ deregister: true });
});

// ---- admin wiring -------------------------------------------------------

test('admin screen create, rename and delete each trigger a discovery refresh', async (t) => {
  const storage = createMemoryStorage();
  const state = createState(storage);
  let refreshes = 0;
  const password = 'correct-horse-battery-staple';
  const srv = await startTestServer(
    { SISSI_ADMIN_PASSWORD: password, SISSI_PUSH_KEY: 'push-secret-key' },
    { storage, state, discovery: { refresh: async () => { refreshes += 1; } } },
  );
  t.after(() => srv.close());
  srv.ctx.adminAuth = createAdminAuth(srv.config);
  registerAdminRoutes(srv.ctx.router, srv.ctx);

  const login = await http(srv.base, '/signage/api/v1/admin/login', { method: 'POST', body: { password } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'x-sissi-admin': '1' };

  const created = await http(srv.base, '/signage/api/v1/admin/screens', {
    method: 'POST',
    headers,
    body: { id: 'hall', name: 'Hall' },
  });
  assert.equal(created.status, 201);
  const renamed = await http(srv.base, '/signage/api/v1/admin/screens/hall', {
    method: 'PATCH',
    headers,
    body: { name: 'Renamed hall' },
  });
  assert.equal(renamed.status, 200);
  const deleted = await http(srv.base, '/signage/api/v1/admin/screens/hall', { method: 'DELETE', headers });
  assert.equal(deleted.status, 204);

  const deadline = Date.now() + 2000;
  while (refreshes < 3 && Date.now() < deadline) await realImmediate();
  assert.equal(refreshes, 3);
});
