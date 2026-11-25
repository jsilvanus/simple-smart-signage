import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminOidc, pkceChallenge } from '../../src/admin-oidc/index.mjs';
import { loadConfig } from '../../src/config.mjs';

// Fake Tunnus: discovery, token endpoint, and a tunnus verifier that accepts one access token.
function fakeTunnus() {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/.well-known/openid-configuration')) {
      return new Response(JSON.stringify({
        authorization_endpoint: 'https://id.example/authorize',
        token_endpoint: 'https://id.example/token',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url) === 'https://id.example/token') {
      return new Response(JSON.stringify({ access_token: 'AT' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('nope', { status: 404 });
  };
  const tunnus = {
    verify: async (token) => {
      assert.equal(token, 'AT');
      return { kind: 'tunnus', sub: 'user-1', name: 'Test', rights: new Set(['sissi:write']) };
    },
  };
  return { fetch, tunnus, calls };
}

function config(env = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    SISSI_AUTH_MODE: 'both',
    SISSI_TUNNUS_ISSUER: 'https://id.example',
    SISSI_TUNNUS_AUDIENCE: 'https://kehitys.example/sissi',
    SISSI_TUNNUS_GROUP_RIGHTS: 'g=sissi:write',
    SISSI_OIDC_CLIENT_SECRET: 'client-secret-xyz',
    ...env,
  });
}

test('PKCE S256 matches the RFC 7636 example', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('login redirect carries state and PKCE; callback exchanges the code and yields a session', async () => {
  const f = fakeTunnus();
  const cfg = config();
  const oidc = createAdminOidc(cfg, { tunnus: f.tunnus, fetch: f.fetch });
  const { location, setCookie } = await oidc.beginLogin({ redirectUri: 'https://kehitys.example/sissi/admin/callback', cookiePath: '/sissi', secure: false });
  const u = new URL(location);
  assert.equal(u.origin + u.pathname, 'https://id.example/authorize');
  assert.equal(u.searchParams.get('client_id'), 'sissi');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  const state = u.searchParams.get('state');
  assert.ok(state && state.length > 20);
  const txCookie = setCookie.split(';')[0];

  const { sessionCookie } = await oidc.finishLogin({
    code: 'CODE',
    state,
    cookieHeader: txCookie,
    redirectUri: 'https://kehitys.example/sissi/admin/callback',
    cookiePath: '/sissi',
    secure: false,
  });
  const tokenCall = f.calls.find((c) => c.url === 'https://id.example/token');
  const body = new URLSearchParams(tokenCall.init.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('client_secret'), 'client-secret-xyz');
  assert.ok(body.get('code_verifier').length >= 43);

  const principal = oidc.readSession(sessionCookie.split(';')[0]);
  assert.equal(principal.sub, 'user-1');
  assert.ok(principal.rights.has('sissi:write'));
});

test('callback refuses a wrong state, a tampered session, and a missing transaction', async () => {
  const f = fakeTunnus();
  const oidc = createAdminOidc(config(), { tunnus: f.tunnus, fetch: f.fetch });
  const { setCookie } = await oidc.beginLogin({ redirectUri: 'https://x/sissi/admin/callback', cookiePath: '/sissi', secure: false });
  const txCookie = setCookie.split(';')[0];
  await assert.rejects(() => oidc.finishLogin({ code: 'c', state: 'wrong', cookieHeader: txCookie, redirectUri: 'https://x', cookiePath: '/sissi', secure: false }));
  await assert.rejects(() => oidc.finishLogin({ code: 'c', state: 'x', cookieHeader: '', redirectUri: 'https://x', cookiePath: '/sissi', secure: false }));
  assert.equal(oidc.readSession('sissi_oidc_session=forged.payload'), null);
});

test('no client secret means browser sign-in is not configured', () => {
  const f = fakeTunnus();
  assert.equal(createAdminOidc(config({ SISSI_OIDC_CLIENT_SECRET: '' }), { tunnus: f.tunnus, fetch: f.fetch }), null);
});

test('beginLogin includes nonce and groups scope without resource; finishLogin verifies id_token when present', async () => {
  let verifiedNonce = null;
  let issuedNonce = null;
  const fetch = async (url) => {
    if (String(url).endsWith('/.well-known/openid-configuration')) {
      return new Response(JSON.stringify({
        authorization_endpoint: 'https://id.example/authorize',
        token_endpoint: 'https://id.example/token',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url) === 'https://id.example/token') {
      return new Response(JSON.stringify({ access_token: 'opaque', id_token: 'ID_TOK' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('nope', { status: 404 });
  };
  const tunnus = {
    verify: async () => {
      throw new Error('should prefer id_token');
    },
    verifyIdToken: async (tok, opts) => {
      assert.equal(tok, 'ID_TOK');
      verifiedNonce = opts.nonce;
      return { kind: 'tunnus', sub: 'u-id', name: 'ID User', rights: new Set(['sissi:read']) };
    },
  };
  const oidc = createAdminOidc(config(), { tunnus, fetch });
  const { location, setCookie } = await oidc.beginLogin({
    redirectUri: 'https://kehitys.example/sissi/admin/callback',
    cookiePath: '/sissi',
    secure: false,
  });
  const u = new URL(location);
  assert.equal(u.searchParams.get('scope'), 'openid profile email groups');
  assert.equal(u.searchParams.get('resource'), null);
  issuedNonce = u.searchParams.get('nonce');
  assert.ok(issuedNonce && issuedNonce.length >= 20);

  const { sessionCookie } = await oidc.finishLogin({
    code: 'C',
    state: u.searchParams.get('state'),
    cookieHeader: setCookie.split(';')[0],
    redirectUri: 'https://kehitys.example/sissi/admin/callback',
    cookiePath: '/sissi',
    secure: false,
  });
  assert.equal(verifiedNonce, issuedNonce);
  assert.equal(oidc.readSession(sessionCookie.split(';')[0]).sub, 'u-id');
});
