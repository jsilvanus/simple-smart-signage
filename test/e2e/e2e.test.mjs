import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

import { loadConfig } from '../../src/config.mjs';
import { createMetrics } from '../../src/metrics.mjs';
import { createServer } from '../../src/server.mjs';
import { createStorage } from '../../src/storage/index.mjs';
import { createState } from '../../src/state/index.mjs';
import { createAuth, testing as authTesting } from '../../src/auth/index.mjs';
import { createDownloader } from '../../src/download/index.mjs';
import { createPushRunner } from '../../src/push/index.mjs';
import { createAdminAuth } from '../../src/admin-auth/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_MP4 = path.join(HERE, '..', 'player', 'fixtures', 'sample.mp4');

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.from([0, r, g, b, r, g, b]);
  const raw = Buffer.concat([row, row]);
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function apiFetch(base, reqPath, { method = 'GET', headers = {}, body } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] ??= 'application/json';
  }
  const res = await fetch(base + reqPath, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

test('e2e: admin creates screen -> Canva push -> player loops online & offline after server stop', async (t) => {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    t.skip('No Chrome or Edge executable found');
    return;
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sissi-e2e-'));
  const img1 = makePng(255, 0, 0);
  const img2 = makePng(0, 128, 255);
  const mp4 = await readFile(SAMPLE_MP4);
  const shaImg1 = createHash('sha256').update(img1).digest('hex');
  const shaImg2 = createHash('sha256').update(img2).digest('hex');
  const shaVid = createHash('sha256').update(mp4).digest('hex');

  const dlServer = http.createServer((req, res) => {
    if (req.url === '/img1.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': img1.length });
      res.end(img1);
    } else if (req.url === '/img2.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': img2.length });
      res.end(img2);
    } else if (req.url === '/sample.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mp4.length });
      res.end(mp4);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => dlServer.listen(0, '127.0.0.1', resolve));
  const dlBase = `http://127.0.0.1:${dlServer.address().port}`;

  const config = loadConfig({
    NODE_ENV: 'test',
    SISSI_PUBLIC_PATH: '/signage',
    SISSI_STORAGE: 'local',
    SISSI_LOCAL_DIR: tmpDir,
    SISSI_CANVA_APP_ID: 'app-e2e',
    SISSI_CANVA_ALLOWED_BRANDS: 'brand-e2e',
    SISSI_ADMIN_PASSWORD: 'e2e-secret-password',
    SISSI_DOWNLOAD_HOSTS: '127.0.0.1,localhost',
    SISSI_ALLOW_PRIVATE_DOWNLOADS: '1',
    SISSI_SW_MAX_VIDEO_MB: '10',
    METRICS_BEARER_TOKEN: 'e2e-metrics',
  });

  const metrics = createMetrics();
  const storage = createStorage(config.storage);
  const state = createState(storage);
  const fakeCanva = authTesting.createFakeCanva();
  const auth = createAuth(config, { fetch: fakeCanva.jwksFetch });
  const download = createDownloader(config);
  const pushRunner = createPushRunner({ config, storage, state, download, metrics });
  const adminAuth = createAdminAuth(config);

  const server = createServer(config, {
    storage,
    state,
    auth,
    download,
    pushRunner,
    adminAuth,
    metrics,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let serverClosed = false;
  const closeAppServer = () =>
    new Promise((resolve) => {
      if (serverClosed) return resolve();
      serverClosed = true;
      server.close(() => resolve());
      server.closeAllConnections?.();
    });

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  try {
    // 1. Admin login -> create screen 'lobby'
    const loginRes = await apiFetch(base, '/signage/api/v1/admin/login', {
      method: 'POST',
      body: { password: 'e2e-secret-password' },
    });
    assert.equal(loginRes.status, 204);
    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('sissi_admin='), 'login sets sissi_admin cookie');
    const cookieHeader = setCookie.split(';')[0];

    const createRes = await apiFetch(base, '/signage/api/v1/admin/screens', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'x-sissi-admin': '1' },
      body: { id: 'lobby', name: 'Lobby', orientation: 'landscape', defaultImageSeconds: 1 },
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.json.id, 'lobby');

    // 2. Canva push (2 images + 1 MP4) -> poll until ready (playlistVersion === 1)
    const token = fakeCanva.signToken({ brandId: 'brand-e2e', aud: 'app-e2e' });
    const pushRes = await apiFetch(base, '/signage/api/v1/push', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        screenId: 'lobby',
        mode: 'replace',
        enabled: true,
        title: 'E2E Sunday Slides',
        pages: [
          { pageNumber: 1, kind: 'image', url: `${dlBase}/img1.png`, seconds: 1 },
          { pageNumber: 2, kind: 'image', url: `${dlBase}/img2.png`, seconds: 1 },
          { pageNumber: 3, kind: 'video', url: `${dlBase}/sample.mp4` },
        ],
      },
    });
    assert.equal(pushRes.status, 202);
    const { pushId } = pushRes.json;
    assert.ok(pushId);

    let pushStatus = null;
    for (let i = 0; i < 60; i += 1) {
      const poll = await apiFetch(base, `/signage/api/v1/push/${pushId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(poll.status, 200);
      pushStatus = poll.json;
      if (pushStatus.state === 'ready' || pushStatus.state === 'failed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(pushStatus?.state, 'ready', `push failed: ${JSON.stringify(pushStatus?.error)}`);
    assert.equal(pushStatus.playlistVersion, createRes.json.playlistVersion + 1);
    assert.equal(pushStatus.pages.done, 3);

    // 3. Open player in headless Chrome and verify images, video, and SW registration
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${base}/signage/s/lobby?pollMs=500`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    await page.waitForSelector(`.slide.is-visible img[src*="${shaImg1}"]`, { timeout: 15000 });
    await page.waitForSelector(`.slide.is-visible img[src*="${shaImg2}"]`, { timeout: 15000 });
    await page.waitForSelector(`.slide.is-visible video[src*="${shaVid}"]`, { timeout: 15000 });
    await page.waitForSelector(`.slide.is-visible img[src*="${shaImg1}"]`, { timeout: 15000 });

    // Allow SW background caching to settle before stopping the server
    await page.waitForTimeout(400);
    const cachedUrls = await page.evaluate(async () => {
      const cache = await caches.open('sissi-media-v1');
      const keys = await cache.keys();
      return keys.map((k) => k.url);
    });
    assert.ok(cachedUrls.some((u) => u.includes(shaImg1)), 'img1 cached in SW');
    assert.ok(cachedUrls.some((u) => u.includes(shaImg2)), 'img2 cached in SW');
    assert.ok(cachedUrls.some((u) => u.includes(shaVid)), 'sample.mp4 cached in SW');

    // 4. Stop HTTP server and verify player continues looping offline without errors
    await closeAppServer();
    await page.waitForTimeout(300);

    await page.waitForSelector(`.slide.is-visible img[src*="${shaImg2}"]`, { timeout: 15000 });
    await page.waitForSelector(`.slide.is-visible video[src*="${shaVid}"]`, { timeout: 15000 });
    await page.waitForSelector(`.slide.is-visible img[src*="${shaImg1}"]`, { timeout: 15000 });

    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    assert.equal(bodyText, '', 'no error text shown on player');
    assert.deepEqual(pageErrors, [], 'no uncaught page errors');
  } finally {
    await browser.close();
    dlServer.close();
    dlServer.closeAllConnections?.();
    await closeAppServer();
    await rm(tmpDir, { recursive: true, force: true });
  }
});
