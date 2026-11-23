import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createAuth } from '../../src/auth/index.mjs';
import { createTunnusVerifier } from '../../src/auth/tunnus.mjs';
import { createAdminAuth } from '../../src/admin-auth/index.mjs';
import { registerAdminRoutes } from '../../src/api/admin.mjs';
import { registerPushRoutes } from '../../src/api/push.mjs';
import { loadConfig, ConfigError, parseGroupRights } from '../../src/config.mjs';
import { createState } from '../../src/state/index.mjs';
import { createMemoryStorage } from '../../src/storage/index.mjs';
import { http, startTestServer, testConfig } from '../helpers/server.mjs';

const ISSUER = 'https://id.example.test';
const AUD = 'https://signage.example.test/signage';
const GROUPS = 'editors=sissi:write;operators=sissi:operate;chiefs=sissi:write,sissi:operate;pi-admins=*,@admin,picontrol:admin';
const SHA = 'a'.repeat(64);

function b64(o) {
  return Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
}

function fakeTunnus({ now = () => Date.now() } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const calls = [];
  async function fetchFn(url) {
    calls.push(String(url));
    if (String(url) === `${ISSUER}/.well-known/openid-configuration`) {
      return { ok: true, status: 200, json: async () => ({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` }) };
    }
    if (String(url) === `${ISSUER}/jwks`) return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }
  function token(claims = {}, { key = privateKey, alg = 'RS256', kid = 'k1' } = {}) {
    const payload = {
      iss: ISSUER,
      aud: ['https://pigateway.example.test', AUD],
      sub: 'user-1',
      name: 'Test Person',
      groups: ['editors'],
      exp: Math.floor(now() / 1000) + 300,
      ...claims,
    };
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    const input = `${b64({ alg, typ: 'at+jwt', kid })}.${b64(payload)}`;
    return `${input}.${cryptoSign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
  }
  return { fetchFn, token, calls, wrongKey: other.privateKey };
}

const baseEnv = {
  SISSI_AUTH_MODE: 'tunnus',
  SISSI_TUNNUS_ISSUER: ISSUER,
  SISSI_TUNNUS_AUDIENCE: AUD,
  SISSI_TUNNUS_GROUP_RIGHTS: GROUPS,
};

async function reject(p, status, code) {
  await assert.rejects(p, (e) => e.status === status && e.code === code);
}

test('config: everything is off by default and a tunnus mode needs issuer, audience and a mapping', () => {
  const c = loadConfig({});
  assert.equal(c.authMode, 'legacy');
  assert.equal(c.tunnus, null);
  assert.throws(() => loadConfig({ SISSI_AUTH_MODE: 'tunnus' }), ConfigError);
  assert.throws(() => loadConfig({ ...baseEnv, SISSI_TUNNUS_GROUP_RIGHTS: 'pi=*,@admin' }), /grant at least one/);
  assert.throws(() => loadConfig({ SISSI_AUTH_MODE: 'nope' }), ConfigError);
  const ok = loadConfig(baseEnv);
  assert.equal(ok.tunnus.issuer, ISSUER);
});

test('group mapping grants only sissi:write and sissi:operate, never wildcards or Pi rights', () => {
  const m = parseGroupRights(GROUPS);
  assert.deepEqual([...m.get('editors')], ['sissi:write']);
  assert.deepEqual([...m.get('chiefs')].sort(), ['sissi:operate', 'sissi:write']);
  assert.equal(m.has('pi-admins'), false);
});

test('verifier accepts a good token (aud array) and discovers the JWKS once', async () => {
  const f = fakeTunnus();
  const v = createTunnusVerifier(testConfig(baseEnv), { fetch: f.fetchFn });
  const p = await v.verify(f.token());
  assert.equal(p.sub, 'user-1');
  assert.deepEqual([...p.rights], ['sissi:write']);
  await v.verify(f.token());
  assert.equal(f.calls.length, 2); // discovery + jwks, then cached
});

test('verifier rejects wrong issuer, audience, signature, alg, expiry, missing sub', async () => {
  const f = fakeTunnus();
  const v = createTunnusVerifier(testConfig(baseEnv), { fetch: f.fetchFn });
  const bad = [
    f.token({ iss: 'https://evil.test' }),
    f.token({ aud: 'https://pigateway.example.test' }),
    f.token({ aud: undefined }),
    f.token({ exp: Math.floor(Date.now() / 1000) - 3600 }),
    f.token({ exp: undefined }),
    f.token({ sub: undefined }),
    f.token({}, { key: f.wrongKey }),
    f.token({}, { alg: 'HS256' }),
    f.token({}, { kid: 'unknown' }),
    'not.a.jwt',
  ];
  for (const t of bad) await reject(v.verify(t), 401, 'UNAUTHORIZED');
});

test('a signed-in person with no signage group (or only Pi groups) gets 403, never a right', async () => {
  const f = fakeTunnus();
  const v = createTunnusVerifier(testConfig(baseEnv), { fetch: f.fetchFn });
  await reject(v.verify(f.token({ groups: [] })), 403, 'FORBIDDEN');
  await reject(v.verify(f.token({ groups: undefined })), 403, 'FORBIDDEN');
  await reject(v.verify(f.token({ groups: ['pi-admins', 'unknown'] })), 403, 'FORBIDDEN');
});

test('discovery that is down gives 401 and recovers later', async () => {
  const f = fakeTunnus();
  let down = true;
  const v = createTunnusVerifier(testConfig(baseEnv), {
    fetch: (u) => (down ? Promise.reject(new Error('offline')) : f.fetchFn(u)),
    now: () => Date.now() + (down ? 0 : 60_000),
  });
  await reject(v.verify(f.token()), 401, 'UNAUTHORIZED');
  down = false;
  assert.equal((await v.verify(f.token())).sub, 'user-1');
});

test('auth modes: legacy ignores Tunnus; both keeps the push key; tunnus refuses it', async () => {
  const f = fakeTunnus();
  const legacy = createAuth(testConfig({ SISSI_PUSH_KEY: 'k' }), { fetch: f.fetchFn });
  await reject(legacy.authenticate({ headers: { authorization: `Bearer ${f.token()}` } }), 401, 'UNAUTHORIZED');

  const both = createAuth(testConfig({ ...baseEnv, SISSI_AUTH_MODE: 'both', SISSI_PUSH_KEY: 'k' }), { fetch: f.fetchFn });
  assert.deepEqual(await both.authenticate({ headers: { authorization: 'Bearer k' } }), { kind: 'pushkey' });
  assert.equal((await both.authenticate({ headers: { authorization: `Bearer ${f.token()}` } })).kind, 'tunnus');

  const only = createAuth(testConfig({ ...baseEnv, SISSI_PUSH_KEY: 'k' }), { fetch: f.fetchFn });
  await reject(only.authenticate({ headers: { authorization: 'Bearer k' } }), 401, 'UNAUTHORIZED');
  assert.equal((await only.authenticate({ headers: { authorization: `Bearer ${f.token()}` } })).kind, 'tunnus');
});

async function setup(env = baseEnv) {
  const f = fakeTunnus();
  const storage = createMemoryStorage();
  const state = createState(storage);
  const config = testConfig({ SISSI_ADMIN_PASSWORD: 'pw', SISSI_GC_GRACE_MINUTES: '0', ...env });
  const tunnus = createTunnusVerifier(config, { fetch: f.fetchFn });
  const auth = createAuth(config, { fetch: f.fetchFn, tunnus });
  const adminAuth = createAdminAuth(config, { fetch: f.fetchFn, tunnus });
  const enqueued = [];
  const pushRunner = {
    enqueue: async (input) => {
      enqueued.push(input);
      return { pushId: 'push-x', screenId: input.screenId };
    },
    waitForIdle: async () => {},
  };
  const srv = await startTestServer(env, { storage, state, auth, adminAuth, pushRunner });
  registerPushRoutes(srv.ctx.router, srv.ctx);
  registerAdminRoutes(srv.ctx.router, srv.ctx);
  await state.createScreen({ id: 'hall', name: 'Hall' });
  await storage.putMediaFromFile(SHA, 'png', new URL(import.meta.url), 'image/png');
  await state.applyPush('hall', { pushId: 'p-off', title: 'Off', enabled: false, items: [{ mediaId: SHA, ext: 'png', kind: 'image', seconds: 5 }] });
  await state.applyPush('hall', { pushId: 'p-on', title: 'On', enabled: true, items: [{ mediaId: SHA, ext: 'png', kind: 'image', seconds: 5 }] });
  const bearer = (groups) => ({ authorization: `Bearer ${f.token({ groups })}` });
  return { ...srv, state, f, enqueued, bearer };
}

const page = { url: 'https://canva.com/a.png', kind: 'image' };
const pushBody = (extra = {}) => ({ screenId: 'hall', title: 'T', pages: [page], ...extra });

test('push: write publishes disabled; enabling or replacing also needs operate', async (t) => {
  const s = await setup();
  t.after(s.close);
  const post = (groups, body) => http(s.base, '/signage/api/v1/push', { method: 'POST', headers: s.bearer(groups), body });

  assert.equal((await post(['editors'], pushBody())).status, 202);
  assert.equal((await post(['editors'], pushBody({ enabled: true }))).status, 403);
  assert.equal((await post(['editors'], pushBody({ enabled: true, mode: 'replace' }))).status, 403);
  assert.equal((await post(['operators'], pushBody())).status, 403); // operate alone cannot publish content
  assert.equal((await post(['chiefs'], pushBody({ enabled: true }))).status, 202);
  assert.equal((await post(['chiefs'], pushBody({ enabled: true, mode: 'replace' }))).status, 202);
  assert.equal((await post(['pi-admins'], pushBody())).status, 403);
  const none = await http(s.base, '/signage/api/v1/push', { method: 'POST', body: pushBody() });
  assert.equal(none.status, 401);
  assert.equal(s.enqueued.length, 3);
});

test('screens list and push status need any sissi right', async (t) => {
  const s = await setup();
  t.after(s.close);
  for (const g of ['editors', 'operators']) {
    assert.equal((await http(s.base, '/signage/api/v1/screens', { headers: s.bearer([g]) })).status, 200);
  }
  assert.equal((await http(s.base, '/signage/api/v1/screens', { headers: s.bearer(['pi-admins']) })).status, 403);
});

test('admin API: write edits content, operate enables, removing live content needs operate', async (t) => {
  const s = await setup();
  t.after(s.close);
  const screen = await s.state.getScreen('hall');
  const off = screen.entries.find((e) => e.pushId === 'p-off');
  const on = screen.entries.find((e) => e.pushId === 'p-on');
  const url = (p) => `/signage/api/v1/admin/screens/hall/${p}`;
  const req = (p, method, groups, body) => http(s.base, url(p), { method, headers: s.bearer(groups), body });

  assert.equal((await req('entries', 'PUT', ['editors'], { entryIds: [on.entryId, off.entryId] })).status, 200);
  assert.equal((await req(`entries/${off.entryId}`, 'PATCH', ['editors'], { seconds: 9 })).status, 200);
  assert.equal((await req(`entries/${off.entryId}`, 'PATCH', ['editors'], { enabled: true })).status, 403);
  assert.equal((await req(`entries/${off.entryId}`, 'PATCH', ['operators'], { seconds: 9 })).status, 403);
  assert.equal((await req(`entries/${off.entryId}`, 'PATCH', ['editors'], { seconds: 9, enabled: true })).status, 403);
  assert.equal((await req(`entries/${off.entryId}`, 'PATCH', ['operators'], { enabled: true })).status, 200);
  assert.equal((await req('pushes/p-off', 'PATCH', ['editors'], { enabled: false })).status, 403);
  assert.equal((await req('pushes/p-off', 'PATCH', ['operators'], { enabled: false })).status, 200);
  // p-on is live: removing it needs operate; p-off is disabled again: write is enough.
  assert.equal((await req(`entries/${on.entryId}`, 'DELETE', ['editors'])).status, 403);
  assert.equal((await req('pushes/p-on', 'DELETE', ['editors'])).status, 403);
  assert.equal((await req('pushes/p-off', 'DELETE', ['editors'])).status, 204);
  assert.equal((await req('pushes/p-on', 'DELETE', ['operators'])).status, 204);
});

test('setup routes (screens, power) never accept a Tunnus token, and tunnus mode turns the password off', async (t) => {
  const s = await setup();
  t.after(s.close);
  const h = s.bearer(['chiefs']);
  assert.equal((await http(s.base, '/signage/api/v1/admin/screens', { method: 'POST', headers: h, body: { id: 'x', name: 'X' } })).status, 401);
  assert.equal((await http(s.base, '/signage/api/v1/admin/screens/hall', { method: 'DELETE', headers: h })).status, 401);
  const login = await http(s.base, '/signage/api/v1/admin/login', { method: 'POST', body: { password: 'pw' } });
  assert.equal(login.status, 401);
});

test('mode both: the admin password and cookie still work next to Tunnus', async (t) => {
  const s = await setup({ ...baseEnv, SISSI_AUTH_MODE: 'both' });
  t.after(s.close);
  const login = await http(s.base, '/signage/api/v1/admin/login', { method: 'POST', body: { password: 'pw' } });
  assert.equal(login.status, 204);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const list = await http(s.base, '/signage/api/v1/admin/screens', { headers: { cookie } });
  assert.equal(list.status, 200);
  assert.equal((await http(s.base, '/signage/api/v1/admin/screens', { headers: s.bearer(['editors']) })).status, 200);
});
