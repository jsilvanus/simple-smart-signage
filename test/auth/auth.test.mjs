import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAuth, testing } from '../../src/auth/index.mjs';
import { createFakeCanva } from '../../src/auth/testing.mjs';
import { HttpError } from '../../src/router.mjs';
import { testConfig } from '../helpers/server.mjs';

function makeReq({ method = 'GET', headers = {} } = {}) {
  return { method, headers };
}

async function expectHttpError(promise, expectedStatus, expectedCode, expectedMessage) {
  let err;
  try {
    await promise;
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof HttpError, `Expected HttpError, got ${err}`);
  assert.equal(err.status, expectedStatus);
  assert.equal(err.code, expectedCode);
  if (expectedMessage !== undefined) {
    assert.equal(err.message, expectedMessage);
  }
  return err;
}

test('valid Canva token succeeds and caches JWKS', async () => {
  let nowMs = 1_700_000_000_000;
  const fake = createFakeCanva({ now: () => nowMs });
  assert.equal(typeof testing.createFakeCanva, 'function');

  const config = testConfig({
    SISSI_CANVA_APP_ID: 'app-123',
    SISSI_CANVA_ALLOWED_BRANDS: 'brand-ok,brand-2',
  });
  const auth = createAuth(config, { fetch: fake.jwksFetch, now: () => nowMs });

  const token = fake.signToken({ brandId: 'brand-ok', aud: 'app-123' });
  const result1 = await auth.authenticate(makeReq({ headers: { authorization: `Bearer ${token}` } }));
  assert.deepEqual(result1, { kind: 'canva', brandId: 'brand-ok' });
  assert.equal(fake.fetchCount, 1);

  // Second call uses cached JWKS without fetching again
  const result2 = await auth.authenticate(makeReq({ headers: { authorization: `Bearer ${token}` } }));
  assert.deepEqual(result2, { kind: 'canva', brandId: 'brand-ok' });
  assert.equal(fake.fetchCount, 1);
});

test('expired and not-yet-valid tokens return 401 UNAUTHORIZED without leaking reason', async () => {
  const nowMs = 1_700_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);
  const fake = createFakeCanva({ now: () => nowMs });
  const config = testConfig({
    SISSI_CANVA_APP_ID: 'app-123',
    SISSI_CANVA_ALLOWED_BRANDS: 'brand-ok',
  });
  const auth = createAuth(config, { fetch: fake.jwksFetch, now: () => nowMs });

  const expired = fake.signToken({ brandId: 'brand-ok', aud: 'app-123', exp: nowSec - 1 });
  const errExp = await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${expired}` } })),
    401,
    'UNAUTHORIZED',
  );
  assert.doesNotMatch(errExp.message, /expir/i);

  const futureNbf = fake.signToken({ brandId: 'brand-ok', aud: 'app-123', nbf: nowSec + 60 });
  const errNbf = await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${futureNbf}` } })),
    401,
    'UNAUTHORIZED',
  );
  assert.doesNotMatch(errNbf.message, /nbf|future|before/i);
});

test('wrong audience returns 401 UNAUTHORIZED', async () => {
  const nowMs = 1_700_000_000_000;
  const fake = createFakeCanva({ now: () => nowMs });
  const config = testConfig({
    SISSI_CANVA_APP_ID: 'app-123',
    SISSI_CANVA_ALLOWED_BRANDS: 'brand-ok',
  });
  const auth = createAuth(config, { fetch: fake.jwksFetch, now: () => nowMs });

  const token = fake.signToken({ brandId: 'brand-ok', aud: 'other-app' });
  const err = await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${token}` } })),
    401,
    'UNAUTHORIZED',
  );
  assert.doesNotMatch(err.message, /aud|audience/i);
});

test('valid token with disallowed brand returns 403 TEAM_NOT_ALLOWED', async () => {
  const nowMs = 1_700_000_000_000;
  const fake = createFakeCanva({ now: () => nowMs });
  const config = testConfig({
    SISSI_CANVA_APP_ID: 'app-123',
    SISSI_CANVA_ALLOWED_BRANDS: 'brand-ok',
  });
  const auth = createAuth(config, { fetch: fake.jwksFetch, now: () => nowMs });

  const token = fake.signToken({ brandId: 'brand-other', aud: 'app-123' });
  await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${token}` } })),
    403,
    'TEAM_NOT_ALLOWED',
    'Your Canva team is not allowed to publish to signage',
  );
});

test('bad signature returns 401 UNAUTHORIZED', async () => {
  const nowMs = 1_700_000_000_000;
  const fake = createFakeCanva({ now: () => nowMs });
  const other = createFakeCanva({ now: () => nowMs });
  const config = testConfig({
    SISSI_CANVA_APP_ID: 'app-123',
    SISSI_CANVA_ALLOWED_BRANDS: 'brand-ok',
  });
  const auth = createAuth(config, { fetch: fake.jwksFetch, now: () => nowMs });

  // Signed by a different private key with matching kid
  const wrongKeyToken = other.signToken({ brandId: 'brand-ok', aud: 'app-123', kid: fake.activeKid });
  await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${wrongKeyToken}` } })),
    401,
    'UNAUTHORIZED',
  );

  // Tampered payload
  const valid = fake.signToken({ brandId: 'brand-ok', aud: 'app-123' });
  const [h, , s] = valid.split('.');
  const tamperedPayload = Buffer.from(
    JSON.stringify({ brandId: 'brand-ok', aud: 'app-123', exp: Math.floor(nowMs / 1000) + 9999 }),
  ).toString('base64url');
  await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${h}.${tamperedPayload}.${s}` } })),
    401,
    'UNAUTHORIZED',
  );
});

test('algorithm confusion (alg none and HS256 with public key as secret) rejected with 401', async () => {
  const nowMs = 1_700_000_000_000;
  const fake = createFakeCanva({ now: () => nowMs });
  const config = testConfig({
    SISSI_CANVA_APP_ID: 'app-123',
    SISSI_CANVA_ALLOWED_BRANDS: 'brand-ok',
  });
  const auth = createAuth(config, { fetch: fake.jwksFetch, now: () => nowMs });

  const algNone = fake.signToken({ brandId: 'brand-ok', aud: 'app-123', alg: 'none' });
  await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${algNone}` } })),
    401,
    'UNAUTHORIZED',
  );

  const hs256 = fake.signToken({
    brandId: 'brand-ok',
    aud: 'app-123',
    alg: 'HS256',
    secret: fake.publicKeyPem,
  });
  await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${hs256}` } })),
    401,
    'UNAUTHORIZED',
  );
});

test('unknown kid triggers rate-limited refresh; key rotation succeeds', async () => {
  let nowMs = 1_700_000_000_000;
  const fake = createFakeCanva({ initialKid: 'kid-1', now: () => nowMs });
  const config = testConfig({
    SISSI_CANVA_APP_ID: 'app-123',
    SISSI_CANVA_ALLOWED_BRANDS: 'brand-ok',
  });
  const auth = createAuth(config, { fetch: fake.jwksFetch, now: () => nowMs });

  // Warm cache with kid-1
  const t1 = fake.signToken({ brandId: 'brand-ok', aud: 'app-123', kid: 'kid-1' });
  await auth.authenticate(makeReq({ headers: { authorization: `Bearer ${t1}` } }));
  assert.equal(fake.fetchCount, 1);

  // Unknown kid within cooldown -> does NOT refresh yet (rate-limited)
  const unknownToken = fake.signToken({ brandId: 'brand-ok', aud: 'app-123', kid: 'kid-unknown' });
  await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${unknownToken}` } })),
    401,
    'UNAUTHORIZED',
  );
  assert.equal(fake.fetchCount, 1);

  // Advance past cooldown (30s) -> unknown kid triggers exactly one refresh, still fails
  nowMs += 31_000;
  await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${unknownToken}` } })),
    401,
    'UNAUTHORIZED',
  );
  assert.equal(fake.fetchCount, 2);

  // Another unknown kid immediately after -> rate-limited, no fetch
  await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: `Bearer ${unknownToken}` } })),
    401,
    'UNAUTHORIZED',
  );
  assert.equal(fake.fetchCount, 2);

  // Rotate key and advance past cooldown -> new kid triggers refresh and succeeds
  fake.rotateKey('kid-2');
  nowMs += 31_000;
  const t2 = fake.signToken({ brandId: 'brand-ok', aud: 'app-123', kid: 'kid-2' });
  const res2 = await auth.authenticate(makeReq({ headers: { authorization: `Bearer ${t2}` } }));
  assert.deepEqual(res2, { kind: 'canva', brandId: 'brand-ok' });
  assert.equal(fake.fetchCount, 3);
});

test('push key good and bad', async () => {
  const config = testConfig({ SISSI_PUSH_KEY: 'super-secret-push-key' });
  const auth = createAuth(config);

  const ok = await auth.authenticate(
    makeReq({ headers: { authorization: 'Bearer super-secret-push-key' } }),
  );
  assert.deepEqual(ok, { kind: 'pushkey' });

  await expectHttpError(
    auth.authenticate(makeReq({ headers: { authorization: 'Bearer wrong-key' } })),
    401,
    'UNAUTHORIZED',
  );

  await expectHttpError(auth.authenticate(makeReq()), 401, 'UNAUTHORIZED');
});

test('nothing configured returns 503 AUTH_NOT_CONFIGURED', async () => {
  const authNone = createAuth(testConfig());
  await expectHttpError(
    authNone.authenticate(makeReq({ headers: { authorization: 'Bearer anything' } })),
    503,
    'AUTH_NOT_CONFIGURED',
  );

  // appId without allowedBrands is also not configured
  const authPartial = createAuth(testConfig({ SISSI_CANVA_APP_ID: 'app-123' }));
  await expectHttpError(
    authPartial.authenticate(makeReq({ headers: { authorization: 'Bearer anything' } })),
    503,
    'AUTH_NOT_CONFIGURED',
  );
});

test('CORS allowed, disallowed, and preflight handling over HTTP', async () => {
  const config = testConfig({
    SISSI_CORS_ORIGINS: 'https://app-123.canva-apps.com,https://admin.example.com',
  });
  const auth = createAuth(config);

  const server = http.createServer((req, res) => {
    if (auth.handleCors(req, res)) return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // Allowed origin GET
    const resAllowed = await fetch(`${base}/api/v1/screens`, {
      headers: { origin: 'https://app-123.canva-apps.com' },
    });
    assert.equal(resAllowed.status, 200);
    assert.equal(
      resAllowed.headers.get('access-control-allow-origin'),
      'https://app-123.canva-apps.com',
    );
    assert.equal(resAllowed.headers.get('vary'), 'Origin');
    assert.equal(
      resAllowed.headers.get('access-control-allow-headers'),
      'Authorization, Content-Type, X-Sissi-Admin',
    );
    assert.equal(
      resAllowed.headers.get('access-control-allow-methods'),
      'GET, POST, DELETE, PATCH, PUT',
    );
    assert.ok(resAllowed.headers.get('access-control-max-age'));

    // Disallowed origin GET -> no CORS headers
    const resDisallowed = await fetch(`${base}/api/v1/screens`, {
      headers: { origin: 'https://evil.example.com' },
    });
    assert.equal(resDisallowed.status, 200);
    assert.equal(resDisallowed.headers.get('access-control-allow-origin'), null);

    // Preflight from allowed origin -> 204 with CORS headers
    const preAllowed = await fetch(`${base}/api/v1/push`, {
      method: 'OPTIONS',
      headers: { origin: 'https://admin.example.com' },
    });
    assert.equal(preAllowed.status, 204);
    assert.equal(preAllowed.headers.get('access-control-allow-origin'), 'https://admin.example.com');
    assert.equal(preAllowed.headers.get('vary'), 'Origin');

    // Preflight from disallowed origin -> 403 JSON error, no allow-origin
    const preDisallowed = await fetch(`${base}/api/v1/push`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com' },
    });
    assert.equal(preDisallowed.status, 403);
    assert.equal(preDisallowed.headers.get('access-control-allow-origin'), null);
    const body = await preDisallowed.json();
    assert.ok(body.error && body.error.code && body.error.message);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
