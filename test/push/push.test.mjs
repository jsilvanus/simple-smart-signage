import test from 'node:test';
import assert from 'node:assert/strict';
import httpNode from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMemoryStorage } from '../../src/storage/index.mjs';
import { createState } from '../../src/state/index.mjs';
import { createAuth, testing as authTesting } from '../../src/auth/index.mjs';
import { createDownloader } from '../../src/download/index.mjs';
import { registerPushRoutes } from '../../src/api/push.mjs';
import { startTestServer, http } from '../helpers/server.mjs';

// ------------------------------------------------------------------ binary fixtures

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452', 'hex'),
  Buffer.alloc(32, 0xaa),
]);

function box(type, ...parts) {
  const payload = Buffer.concat(parts);
  const hdr = Buffer.alloc(8);
  hdr.writeUInt32BE(8 + payload.length, 0);
  hdr.write(type, 4, 4, 'latin1');
  return Buffer.concat([hdr, payload]);
}

function ftypBox(brand = 'isom') {
  const body = Buffer.alloc(12);
  body.write(brand, 0, 4, 'latin1');
  body.writeUInt32BE(0x200, 4);
  body.write('isom', 8, 4, 'latin1');
  return box('ftyp', body);
}

function mvhdV0(timescale, duration) {
  const b = Buffer.alloc(100);
  b[0] = 0;
  b.writeUInt32BE(timescale, 12);
  b.writeUInt32BE(duration, 16);
  return box('mvhd', b);
}

function makeMp4(durationSeconds) {
  return Buffer.concat([ftypBox(), box('moov', mvhdV0(1000, durationSeconds * 1000))]);
}

// ------------------------------------------------------------------ test harness

async function startFixtureServer(routes) {
  const srv = httpNode.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const handler = routes[u.pathname];
    if (!handler) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    await handler(req, res, u);
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        srv.close(() => resolve());
        srv.closeAllConnections?.();
      }),
  };
}

async function setupEnv(t, { envOverrides = {}, routes = {} } = {}) {
  const fakeCanva = authTesting.createFakeCanva();
  const dlServer = await startFixtureServer(routes);
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sissi-push-test-'));

  const env = {
    SISSI_PUBLIC_PATH: '/signage',
    SISSI_CANVA_APP_ID: 'app-1',
    SISSI_CANVA_ALLOWED_BRANDS: 'brand-allowed',
    SISSI_PUSH_KEY: 'secret-push-key',
    SISSI_CORS_ORIGINS: 'https://app.canva.com',
    SISSI_DOWNLOAD_HOSTS: '127.0.0.1,canva.com',
    SISSI_ALLOW_PRIVATE_DOWNLOADS: '1',
    ...envOverrides,
  };

  const storage = createMemoryStorage();
  const state = createState(storage);
  await state.createScreen({
    id: 'lobby',
    name: 'Lobby',
    orientation: 'landscape',
    defaultImageSeconds: 10,
    maxVideoSeconds: 15,
  });

  let srv;
  const authConfig = {
    canva: { appId: env.SISSI_CANVA_APP_ID, allowedBrands: env.SISSI_CANVA_ALLOWED_BRANDS.split(',') },
    pushKey: env.SISSI_PUSH_KEY,
    corsOrigins: env.SISSI_CORS_ORIGINS.split(','),
  };
  const auth = createAuth(authConfig, { fetch: fakeCanva.jwksFetch });

  srv = await startTestServer(env, {
    storage,
    state,
    auth,
    download: null, // replaced below with config-aware downloader
  });
  srv.ctx.download = createDownloader(srv.config, { tmpDir });
  registerPushRoutes(srv.ctx.router, srv.ctx);

  t.after(async () => {
    await srv.ctx.push.waitForIdle();
    await srv.close();
    await dlServer.close();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  const token = fakeCanva.signToken({ brandId: 'brand-allowed', aud: 'app-1' });
  return { srv, storage, state, fakeCanva, dlServer, tmpDir, token };
}

// ------------------------------------------------------------------ tests

test('happy path: image + video (including kind omitted) and replace mode', async (t) => {
  const mp4 = makeMp4(7);
  const { srv, state, storage, dlServer, token, tmpDir } = await setupEnv(t, {
    routes: {
      '/img.png': (req, res) => {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG_BYTES.length });
        res.end(PNG_BYTES);
      },
      '/vid.mp4': (req, res) => {
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mp4.length });
        res.end(mp4);
      },
    },
  });

  const postRes = await http(srv.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin: 'https://app.canva.com' },
    body: {
      screenId: 'lobby',
      mode: 'append',
      enabled: true,
      title: 'Morning Deck',
      pages: [
        { pageNumber: 1, url: `${dlServer.base}/img.png?sig=secret123`, alt: 'Welcome image', headline: 'Welcome', caption: 'Sunday service', link: 'https://example.org/service' },
        { pageNumber: 2, kind: 'video', url: `${dlServer.base}/vid.mp4`, seconds: 999 },
      ],
    },
  });

  assert.equal(postRes.status, 202);
  assert.equal(postRes.headers.get('access-control-allow-origin'), 'https://app.canva.com');
  assert.equal(postRes.json.state, 'queued');
  assert.equal(postRes.json.screenId, 'lobby');
  assert.equal(postRes.json.taskId, postRes.json.pushId);
  assert.equal(postRes.headers.get('location'), `/signage/api/v1/push/${postRes.json.pushId}`);

  await srv.ctx.push.waitForIdle();

  const statusRes = await http(srv.base, postRes.headers.get('location'), {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(statusRes.status, 200);
  assert.deepEqual(statusRes.json, {
    pushId: postRes.json.pushId,
    screenId: 'lobby',
    state: 'ready',
    progress: 1,
    pages: { done: 2, total: 2 },
    error: null,
    playlistVersion: 2,
  });

  const playlist = await state.getPlaylist('lobby');
  assert.equal(playlist.version, 2);
  assert.equal(playlist.entries.length, 2);
  assert.equal(playlist.entries[0].kind, 'image');
  assert.equal(playlist.entries[0].seconds, 10); // defaultImageSeconds
  assert.equal(playlist.entries[0].alt, 'Welcome image');
  assert.equal(playlist.entries[0].headline, 'Welcome');
  assert.equal(playlist.entries[0].caption, 'Sunday service');
  assert.equal(playlist.entries[0].link, 'https://example.org/service');
  assert.equal(playlist.entries[1].kind, 'video');
  assert.equal(playlist.entries[1].seconds, 7); // durationSeconds, ignoring 999
  assert.ok(await storage.statMedia(playlist.entries[0].mediaId, 'png'));
  assert.ok(await storage.statMedia(playlist.entries[1].mediaId, 'mp4'));

  const leftoverTmp = await fs.promises.readdir(tmpDir);
  assert.deepEqual(leftoverTmp, []);

  // Replace mode replaces existing entries
  const replaceRes = await http(srv.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: 'Bearer secret-push-key' },
    body: {
      screenId: 'lobby',
      mode: 'replace',
      enabled: true,
      title: 'Replacement',
      pages: [{ pageNumber: 1, kind: 'image', url: `${dlServer.base}/img.png`, seconds: 25 }],
    },
  });
  assert.equal(replaceRes.status, 202);
  await srv.ctx.push.waitForIdle();

  const playlistAfter = await state.getPlaylist('lobby');
  assert.equal(playlistAfter.version, 3);
  assert.equal(playlistAfter.entries.length, 1);
  assert.equal(playlistAfter.entries[0].seconds, 25);
});

test('KIND_MISMATCH and VIDEO_TOO_LONG fail push and leave screen untouched', async (t) => {
  const longMp4 = makeMp4(30); // screen maxVideoSeconds is 15
  const { srv, state, dlServer, token } = await setupEnv(t, {
    routes: {
      '/img.png': (req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG_BYTES);
      },
      '/long.mp4': (req, res) => {
        res.writeHead(200, { 'content-type': 'video/mp4' });
        res.end(longMp4);
      },
      '/fail': (req, res) => {
        res.writeHead(500);
        res.end('boom');
      },
    },
  });

  // Seed initial entry
  const seed = await http(srv.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      screenId: 'lobby',
      title: 'Initial',
      enabled: true,
      pages: [{ pageNumber: 1, url: `${dlServer.base}/img.png` }],
    },
  });
  assert.equal(seed.status, 202);
  await srv.ctx.push.waitForIdle();

  // KIND_MISMATCH
  const mismatch = await http(srv.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      screenId: 'lobby',
      mode: 'replace',
      enabled: true,
      title: 'Mismatch',
      pages: [{ pageNumber: 1, kind: 'video', url: `${dlServer.base}/img.png?token=secret_sig` }],
    },
  });
  await srv.ctx.push.waitForIdle();
  const mismatchStatus = await http(srv.base, `/signage/api/v1/push/${mismatch.json.pushId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(mismatchStatus.json.state, 'failed');
  assert.equal(mismatchStatus.json.error.code, 'KIND_MISMATCH');

  // VIDEO_TOO_LONG
  const tooLong = await http(srv.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      screenId: 'lobby',
      mode: 'replace',
      enabled: true,
      title: 'Too Long',
      pages: [{ pageNumber: 1, kind: 'video', url: `${dlServer.base}/long.mp4` }],
    },
  });
  await srv.ctx.push.waitForIdle();
  const tooLongStatus = await http(srv.base, `/signage/api/v1/push/${tooLong.json.pushId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(tooLongStatus.json.state, 'failed');
  assert.equal(tooLongStatus.json.error.code, 'VIDEO_TOO_LONG');

  // Partial failure (page 1 ok, page 2 HTTP 500 with signed query string) leaves screen untouched
  const partial = await http(srv.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      screenId: 'lobby',
      mode: 'replace',
      enabled: true,
      title: 'Partial',
      pages: [
        { pageNumber: 1, url: `${dlServer.base}/img.png` },
        { pageNumber: 2, url: `${dlServer.base}/fail?X-Amz-Signature=supersecretvalue` },
      ],
    },
  });
  await srv.ctx.push.waitForIdle();
  const partialStatus = await http(srv.base, `/signage/api/v1/push/${partial.json.pushId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(partialStatus.json.state, 'failed');
  assert.equal(partialStatus.json.error.code, 'DOWNLOAD_FAILED');
  assert.ok(!partialStatus.json.error.message.includes('supersecretvalue'));
  assert.ok(!partialStatus.json.error.message.includes('X-Amz-Signature'));

  const playlist = await state.getPlaylist('lobby');
  assert.equal(playlist.version, 2);
  assert.equal(playlist.entries.length, 1);
  assert.equal(playlist.entries[0].title, 'Initial');
});

test('TOO_LARGE: per-page image limit (with kind omitted) and total push limit', async (t) => {
  const bigPng = Buffer.concat([PNG_BYTES, Buffer.alloc(1500, 0xbb)]);
  const smallPng = PNG_BYTES;
  // Set small limits via config override after startTestServer? No, env uses MB (min 1).
  // So we override srv.config.limits directly in test, or create runner with small limits.
  const { srv, dlServer, token } = await setupEnv(t, {
    routes: {
      '/big.png': (req, res) => {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': bigPng.length });
        res.end(bigPng);
      },
      '/small.png': (req, res) => {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': smallPng.length });
        res.end(smallPng);
      },
    },
  });

  // Re-register with tight byte limits on a fresh router or mutate config?
  // Note: runner captures limits at createPushRunner() time, so let's test via a dedicated server with tight limits.
  const fakeCanva = authTesting.createFakeCanva();
  const storage = createMemoryStorage();
  const state = createState(storage);
  await state.createScreen({ id: 'lobby', name: 'Lobby', orientation: 'landscape' });

  const srv2 = await startTestServer(
    {
      SISSI_PUSH_KEY: 'secret-push-key',
      SISSI_DOWNLOAD_HOSTS: '127.0.0.1',
      SISSI_ALLOW_PRIVATE_DOWNLOADS: '1',
    },
    {
      storage,
      state,
      auth: createAuth({ pushKey: 'secret-push-key' }, { fetch: fakeCanva.jwksFetch }),
    },
  );
  srv2.config.limits.imageBytes = 1000;
  srv2.config.limits.videoBytes = 5000;
  srv2.config.limits.pushBytes = 120;
  srv2.ctx.download = createDownloader(srv2.config);
  registerPushRoutes(srv2.ctx.router, srv2.ctx);
  t.after(async () => {
    await srv2.ctx.push.waitForIdle();
    await srv2.close();
  });

  // Per-page image limit (kind omitted -> sniffed as image, > 1000 bytes)
  srv2.config.limits.pushBytes = 10000;
  const r1 = await http(srv2.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: 'Bearer secret-push-key' },
    body: {
      screenId: 'lobby',
      title: 'Big Image',
      pages: [{ pageNumber: 1, url: `${dlServer.base}/big.png` }],
    },
  });
  assert.equal(r1.status, 202);
  await srv2.ctx.push.waitForIdle();
  const s1 = await http(srv2.base, `/signage/api/v1/push/${r1.json.pushId}`, {
    headers: { authorization: 'Bearer secret-push-key' },
  });
  assert.equal(s1.json.state, 'failed');
  assert.equal(s1.json.error.code, 'TOO_LARGE');

  // Total push limit across 3 small pages (each 48 bytes, 3 * 48 = 144 > 120)
  srv2.config.limits.pushBytes = 120;
  // Wait: pushBytes was captured at createPushRunner time; let's test total push limit with a 2nd runner where pushBytes=120:
  const srv3 = await startTestServer(
    {
      SISSI_PUSH_KEY: 'secret-push-key',
      SISSI_DOWNLOAD_HOSTS: '127.0.0.1',
      SISSI_ALLOW_PRIVATE_DOWNLOADS: '1',
    },
    {
      storage,
      state,
      auth: createAuth({ pushKey: 'secret-push-key' }, { fetch: fakeCanva.jwksFetch }),
    },
  );
  srv3.config.limits.imageBytes = 1000;
  srv3.config.limits.videoBytes = 5000;
  srv3.config.limits.pushBytes = 120;
  srv3.ctx.download = createDownloader(srv3.config);
  registerPushRoutes(srv3.ctx.router, srv3.ctx);
  t.after(async () => {
    await srv3.ctx.push.waitForIdle();
    await srv3.close();
  });

  const r2 = await http(srv3.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: 'Bearer secret-push-key' },
    body: {
      screenId: 'lobby',
      title: 'Exceeds Push Bytes',
      pages: [
        { pageNumber: 1, kind: 'image', url: `${dlServer.base}/small.png` },
        { pageNumber: 2, kind: 'image', url: `${dlServer.base}/small.png` },
        { pageNumber: 3, kind: 'image', url: `${dlServer.base}/small.png` },
      ],
    },
  });
  assert.equal(r2.status, 202);
  await srv3.ctx.push.waitForIdle();
  const s2 = await http(srv3.base, `/signage/api/v1/push/${r2.json.pushId}`, {
    headers: { authorization: 'Bearer secret-push-key' },
  });
  assert.equal(s2.json.state, 'failed');
  assert.equal(s2.json.error.code, 'TOO_LARGE');
});

test('concurrent pushes: finish-order per screen and 429 BUSY when >3 active', async (t) => {
  let releaseSlow;
  const slowGate = new Promise((resolve) => {
    releaseSlow = resolve;
  });

  const { srv, state, dlServer, token } = await setupEnv(t, {
    routes: {
      '/slow.png': async (req, res) => {
        await slowGate;
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG_BYTES);
      },
      '/fast.png': (req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG_BYTES);
      },
    },
  });

  // Start 3 slow pushes (maxConcurrentPushes = 3)
  const slowPushes = [];
  for (let i = 0; i < 3; i++) {
    const r = await http(srv.base, '/signage/api/v1/push', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        screenId: 'lobby',
        mode: i === 0 ? 'replace' : 'append',
        enabled: true,
        title: `Slow ${i}`,
        pages: [{ pageNumber: 1, url: `${dlServer.base}/slow.png` }],
      },
    });
    assert.equal(r.status, 202);
    slowPushes.push(r.json.pushId);
  }

  // 4th concurrent push -> 429 BUSY
  const busyRes = await http(srv.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      screenId: 'lobby',
      title: 'Fourth',
      pages: [{ pageNumber: 1, url: `${dlServer.base}/fast.png` }],
    },
  });
  assert.equal(busyRes.status, 429);
  assert.equal(busyRes.json.error.code, 'BUSY');

  // Release slow pushes and wait
  releaseSlow();
  await srv.ctx.push.waitForIdle();

  // Now verify finish-order: start slow (replace) then fast (append)
  let releaseSlow2;
  const slowGate2 = new Promise((resolve) => {
    releaseSlow2 = resolve;
  });
  // Reuse setupEnv with custom gate for finish-order test
  const env2 = await setupEnv(t, {
    routes: {
      '/slow2.png': async (req, res) => {
        await slowGate2;
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG_BYTES);
      },
      '/fast2.png': (req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG_BYTES);
      },
    },
  });

  const pSlow = await http(env2.srv.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${env2.token}` },
    body: {
      screenId: 'lobby',
      mode: 'replace',
      enabled: true,
      title: 'Slow Replace',
      pages: [{ pageNumber: 1, url: `${env2.dlServer.base}/slow2.png` }],
    },
  });
  assert.equal(pSlow.status, 202);

  const pFast = await http(env2.srv.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${env2.token}` },
    body: {
      screenId: 'lobby',
      mode: 'append',
      enabled: true,
      title: 'Fast Append',
      pages: [{ pageNumber: 1, url: `${env2.dlServer.base}/fast2.png` }],
    },
  });
  assert.equal(pFast.status, 202);

  // Wait briefly so pFast finishes before pSlow
  for (let i = 0; i < 40; i++) {
    const st = await http(env2.srv.base, `/signage/api/v1/push/${pFast.json.pushId}`, {
      headers: { authorization: `Bearer ${env2.token}` },
    });
    if (st.json.state === 'ready') break;
    await new Promise((r) => setTimeout(r, 15));
  }

  releaseSlow2();
  await env2.srv.ctx.push.waitForIdle();

  // Because pSlow finished AFTER pFast and used mode='replace', only 'Slow Replace' remains!
  const pl = await env2.state.getPlaylist('lobby');
  assert.equal(pl.entries.length, 1);
  assert.equal(pl.entries[0].title, 'Slow Replace');
});

test('validation errors (404, 422) and auth (401, 403)', async (t) => {
  const { srv, fakeCanva, dlServer, token } = await setupEnv(t);
  const baseUrl = dlServer.base;

  // 401 UNAUTHORIZED
  const noAuth = await http(srv.base, '/signage/api/v1/push', {
    method: 'POST',
    body: { screenId: 'lobby', title: 'T', pages: [{ url: `${baseUrl}/a.png` }] },
  });
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.json.error.code, 'UNAUTHORIZED');

  // 403 TEAM_NOT_ALLOWED
  const badBrandToken = fakeCanva.signToken({ brandId: 'brand-other', aud: 'app-1' });
  const badBrand = await http(srv.base, '/signage/api/v1/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${badBrandToken}` },
    body: { screenId: 'lobby', title: 'T', pages: [{ url: `${baseUrl}/a.png` }] },
  });
  assert.equal(badBrand.status, 403);
  assert.equal(badBrand.json.error.code, 'TEAM_NOT_ALLOWED');

  // 404 SCREEN_NOT_FOUND (unknown and invalid characters)
  for (const screenId of ['unknown', '../bad', 'UPPER']) {
    const r = await http(srv.base, '/signage/api/v1/push', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { screenId, title: 'T', pages: [{ url: `${baseUrl}/a.png` }] },
    });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'SCREEN_NOT_FOUND');
  }

  // 404 PUSH_NOT_FOUND
  for (const pid of ['push_does_not_exist', 'bad.push']) {
    const r = await http(srv.base, `/signage/api/v1/push/${pid}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'PUSH_NOT_FOUND');
  }

  const cases = [
    [{ screenId: 'lobby', mode: 'overwrite', title: 'T', pages: [{ url: `${baseUrl}/a.png` }] }, 'INVALID_MODE'],
    [{ screenId: 'lobby', title: '   ', pages: [{ url: `${baseUrl}/a.png` }] }, 'INVALID_TITLE'],
    [{ screenId: 'lobby', title: 'x'.repeat(201), pages: [{ url: `${baseUrl}/a.png` }] }, 'INVALID_TITLE'],
    [{ screenId: 'lobby', title: 'T', pages: [] }, 'INVALID_PAGES'],
    [
      {
        screenId: 'lobby',
        title: 'T',
        pages: Array.from({ length: 101 }, () => ({ url: `${baseUrl}/a.png` })),
      },
      'TOO_MANY_PAGES',
    ],
    [{ screenId: 'lobby', title: 'T', pages: [{ kind: 'audio', url: `${baseUrl}/a.png` }] }, 'INVALID_KIND'],
    [{ screenId: 'lobby', title: 'T', pages: [{ seconds: 0, url: `${baseUrl}/a.png` }] }, 'INVALID_SECONDS'],
    [{ screenId: 'lobby', title: 'T', pages: [{ seconds: 3601, url: `${baseUrl}/a.png` }] }, 'INVALID_SECONDS'],
    [{ screenId: 'lobby', title: 'T', pages: [{ url: 'https://evil.example.com/a.png' }] }, 'PAGE_URL_NOT_ALLOWED'],
    [{ screenId: 'lobby', title: 'T', pages: [{ url: 'https://user:pass@canva.com/a.png' }] }, 'PAGE_URL_NOT_ALLOWED'],
  ];

  for (const [body, expectedCode] of cases) {
    const r = await http(srv.base, '/signage/api/v1/push', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body,
    });
    assert.equal(r.status, 422, `Expected 422 for ${expectedCode}, got ${r.status}`);
    assert.equal(r.json.error.code, expectedCode);
  }
});

test('push adds entries disabled by default; enabled true makes them live; replace needs enabled', async (t) => {
  const { srv, dlServer, token } = await setupEnv(t, {
    routes: {
      '/img.png': (req, res) => {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG_BYTES.length });
        res.end(PNG_BYTES);
      },
    },
  });
  const post = (body) =>
    http(srv.base, '/signage/api/v1/push', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { screenId: 'lobby', title: 'T', pages: [{ url: `${dlServer.base}/img.png` }], ...body },
    });

  assert.equal((await post({ mode: 'replace' })).json.error.code, 'INVALID_MODE');
  assert.equal((await post({ enabled: 'yes' })).json.error.code, 'INVALID_ENABLED');

  assert.equal((await post({})).status, 202);
  await srv.ctx.push.waitForIdle();
  let list = await http(srv.base, '/signage/s/lobby/playlist.json');
  assert.equal(list.json.entries.length, 0);
  let screen = await srv.ctx.state.getScreen('lobby');
  assert.equal(screen.entryCount, 1);
  assert.equal(screen.entries[0].enabled, false);

  assert.equal((await post({ enabled: true })).status, 202);
  await srv.ctx.push.waitForIdle();
  list = await http(srv.base, '/signage/s/lobby/playlist.json');
  assert.equal(list.json.entries.length, 1);

  assert.equal((await post({ mode: 'replace', enabled: true })).status, 202);
  await srv.ctx.push.waitForIdle();
  screen = await srv.ctx.state.getScreen('lobby');
  assert.equal(screen.entryCount, 1);
  assert.equal(screen.enabledEntryCount, 1);
});
