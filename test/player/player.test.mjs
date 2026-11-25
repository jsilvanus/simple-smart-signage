import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

import { startTestServer, http } from '../helpers/server.mjs';
import { createMemoryStorage } from '../../src/storage/index.mjs';
import { createState } from '../../src/state/index.mjs';
import { createAuth, testing as authTesting } from '../../src/auth/index.mjs';
import { registerReadRoutes } from '../../src/api/read.mjs';
import { registerPlayerRoutes } from '../../src/api/player.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_MP4 = path.join(HERE, 'fixtures', 'sample.mp4');

function findBrowserExecutable() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
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

async function storeBuffer(storage, tmpDir, name, buf, ext, contentType) {
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const filePath = path.join(tmpDir, name);
  await writeFile(filePath, buf);
  await storage.putMediaFromFile(sha256, ext, filePath, contentType);
  return sha256;
}

async function setupPlayerServer(env = {}) {
  const storage = createMemoryStorage();
  const state = createState(storage);
  const fakeCanva = authTesting.createFakeCanva();
  const auth = createAuth(
    { canva: { appId: 'app-test', allowedBrands: ['brand-1'] }, pushKey: '', corsOrigins: [] },
    { fetch: fakeCanva.jwksFetch },
  );
  const srv = await startTestServer(env, { storage, state, auth });
  registerReadRoutes(srv.ctx.router, srv.ctx);
  registerPlayerRoutes(srv.ctx.router, srv.ctx);
  return { ...srv, storage, state };
}

test('player routes serve sw.js (with swMaxVideoMb), assets, and neutral 200/404 HTML', async () => {
  const srv = await setupPlayerServer({
    SISSI_PUBLIC_PATH: '/signage',
    SISSI_SW_MAX_VIDEO_MB: '42',
  });

  try {
    await srv.state.createScreen({ id: 'lobby', name: 'Lobby', orientation: 'landscape' });

    const sw = await http(srv.base, '/signage/s/sw.js');
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get('content-type') || '', /^application\/javascript/);
    assert.equal(sw.headers.get('cache-control'), 'no-cache');
    assert.match(sw.text, /const SW_MAX_VIDEO_MB = 42;/);

    const js = await http(srv.base, '/signage/s/player.js');
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') || '', /^application\/javascript/);
    assert.equal(js.headers.get('cache-control'), 'no-cache');

    const css = await http(srv.base, '/signage/s/player.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') || '', /^text\/css/);
    assert.equal(css.headers.get('cache-control'), 'no-cache');

    const okPage = await http(srv.base, '/signage/s/lobby');
    assert.equal(okPage.status, 200);
    assert.match(okPage.headers.get('content-type') || '', /^text\/html/);
    assert.equal(okPage.headers.get('cache-control'), 'no-cache');
    assert.match(okPage.text, /href="\.\/player\.css"/);
    assert.match(okPage.text, /src="\.\/player\.js"/);

    const unknownPage = await http(srv.base, '/signage/s/unknown-screen');
    assert.equal(unknownPage.status, 404);
    assert.match(unknownPage.headers.get('content-type') || '', /^text\/html/);
    assert.equal(unknownPage.headers.get('cache-control'), 'no-cache');
    assert.equal(unknownPage.text, okPage.text);

    const invalidPage = await http(srv.base, '/signage/s/BAD_ID!');
    assert.equal(invalidPage.status, 404);
    assert.equal(invalidPage.text, okPage.text);
  } finally {
    await srv.close();
  }
});

test('Playwright player: images, video ended, boundary version switch, unknown screen recovery, and offline SW loop', async (t) => {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    t.skip('No Chrome or Edge executable found');
    return;
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sissi-player-test-'));
  const srv = await setupPlayerServer({
    SISSI_PUBLIC_PATH: '/signage',
    SISSI_SW_MAX_VIDEO_MB: '10',
  });
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  try {
    await srv.state.createScreen({ id: 'lobby', name: 'Lobby', orientation: 'landscape' });

    const shaImg1 = await storeBuffer(srv.storage, tmpDir, 'img1.png', makePng(255, 0, 0), 'png', 'image/png');
    const shaImg2 = await storeBuffer(srv.storage, tmpDir, 'img2.png', makePng(0, 0, 255), 'png', 'image/png');
    const shaImg3 = await storeBuffer(srv.storage, tmpDir, 'img3.png', makePng(255, 255, 0), 'png', 'image/png');

    const { readFile } = await import('node:fs/promises');
    const mp4Buf = await readFile(SAMPLE_MP4);
    const shaVid = createHash('sha256').update(mp4Buf).digest('hex');
    await srv.storage.putMediaFromFile(shaVid, 'mp4', SAMPLE_MP4, 'video/mp4');

    await srv.state.applyPush('lobby', {
      pushId: 'push-1',
      mode: 'replace',
      enabled: true,
      title: 'v1',
      items: [
        { mediaId: shaImg1, ext: 'png', kind: 'image', seconds: 1 },
        { mediaId: shaImg2, ext: 'png', kind: 'image', seconds: 1 },
        { mediaId: shaVid, ext: 'mp4', kind: 'video', seconds: 4 },
      ],
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Unknown screen shows neutral black screen, zero text, and recovers once screen + playlist exist
    await page.goto(`${srv.base}/signage/s/late-screen?pollMs=150`, { waitUntil: 'domcontentloaded' });
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const text = await page.evaluate(() => document.body.innerText.trim());
    assert.equal(bg, 'rgb(0, 0, 0)');
    assert.equal(text, '');

    await srv.state.createScreen({ id: 'late-screen', name: 'Late', orientation: 'landscape' });
    await srv.state.applyPush('late-screen', {
      pushId: 'push-late',
      mode: 'replace',
      enabled: true,
      title: 'late',
      items: [{ mediaId: shaImg3, ext: 'png', kind: 'image', seconds: 2 }],
    });
    await page.waitForSelector(`.slide.is-visible img[src*="${shaImg3}"]`, { timeout: 5000 });

    // 2. Main screen: 2 images + 1 video, SW registration, cross-fade, video ended advance
    const page2 = await context.newPage();
    await page2.goto(`${srv.base}/signage/s/lobby?pollMs=150`, { waitUntil: 'domcontentloaded' });

    // Wait for SW to be active and controlling
    await page2.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    await page2.waitForSelector(`.slide.is-visible img[src*="${shaImg1}"]`, { timeout: 5000 });
    const styleCheck = await page2.evaluate(() => {
      const slide = document.querySelector('.slide.is-visible');
      const img = slide?.querySelector('img');
      return {
        objectFit: img ? getComputedStyle(img).objectFit : null,
        transitionDuration: slide ? getComputedStyle(slide).transitionDuration : null,
        stored: window.localStorage.getItem('sissi:playlist:lobby'),
      };
    });
    assert.equal(styleCheck.objectFit, 'contain');
    assert.equal(styleCheck.transitionDuration, '0.5s');
    const storedJson = styleCheck.stored ? JSON.parse(styleCheck.stored) : null;
    assert.ok(storedJson && storedJson.version >= 1 && storedJson.entries.length === 3);

    // Advances to img2 after ~1s
    await page2.waitForSelector(`.slide.is-visible img[src*="${shaImg2}"]`, { timeout: 5000 });
    // Advances to vid after ~1s
    await page2.waitForSelector(`.slide.is-visible video[src*="${shaVid}"]`, { timeout: 5000 });
    // Video ended advances back to img1 (sample.mp4 is 0.6s, safety net is 4+5=9s, so <3s proves ended fired)
    await page2.waitForSelector(`.slide.is-visible img[src*="${shaImg1}"]`, { timeout: 5500 });

    // 3. Version switch at entry boundary (push v2 while img1 is active)
    await srv.state.applyPush('lobby', {
      pushId: 'push-2',
      mode: 'replace',
      enabled: true,
      title: 'v2',
      items: [
        { mediaId: shaImg3, ext: 'png', kind: 'image', seconds: 1 },
        { mediaId: shaVid, ext: 'mp4', kind: 'video', seconds: 4 },
      ],
    });

    // img1 should NOT vanish immediately; wait for poll + boundary transition to img3
    await page2.waitForSelector(`.slide.is-visible img[src*="${shaImg3}"]`, { timeout: 5000 });
    // Ensure SW has cached v2 media (playlist.json + img3 + vid) and pruned v1-only media
    await page2.waitForSelector(`.slide.is-visible video[src*="${shaVid}"]`, { timeout: 5000 });
    await page2.waitForTimeout(300);

    const cachedMediaUrls = await page2.evaluate(async () => {
      const cache = await caches.open('sissi-media-v1');
      const keys = await cache.keys();
      return keys.map((k) => k.url);
    });
    assert.ok(cachedMediaUrls.some((u) => u.includes(shaImg3)), 'v2 image should be cached');
    assert.ok(cachedMediaUrls.some((u) => u.includes(shaVid)), 'small video should be cached');
    assert.ok(!cachedMediaUrls.some((u) => u.includes(shaImg1)), 'old v1 img1 should be pruned');
    assert.ok(!cachedMediaUrls.some((u) => u.includes(shaImg2)), 'old v1 img2 should be pruned');

    // 4. Offline loop after closing server!
    await srv.close();

    // Must still loop between img3 and vid offline via Service Worker (including 206 Range for video!)
    await page2.waitForSelector(`.slide.is-visible img[src*="${shaImg3}"]`, { timeout: 5000 });
    await page2.waitForSelector(`.slide.is-visible video[src*="${shaVid}"]`, { timeout: 5000 });
    const offlineText = await page2.evaluate(() => document.body.innerText.trim());
    assert.equal(offlineText, '');

    await context.close();
  } finally {
    await browser.close();
    await srv.close().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Playwright player: skips uncached video when offline (SISSI_SW_MAX_VIDEO_MB=0)', async (t) => {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    t.skip('No Chrome or Edge executable found');
    return;
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sissi-player-uncached-'));
  const srv = await setupPlayerServer({
    SISSI_PUBLIC_PATH: '/signage',
    SISSI_SW_MAX_VIDEO_MB: '0',
  });
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  try {
    await srv.state.createScreen({ id: 'skip-test', name: 'Skip', orientation: 'landscape' });
    const shaImg = await storeBuffer(srv.storage, tmpDir, 'img.png', makePng(0, 200, 0), 'png', 'image/png');
    const { readFile } = await import('node:fs/promises');
    const mp4Buf = await readFile(SAMPLE_MP4);
    const shaVid = createHash('sha256').update(mp4Buf).digest('hex');
    await srv.storage.putMediaFromFile(shaVid, 'mp4', SAMPLE_MP4, 'video/mp4');

    await srv.state.applyPush('skip-test', {
      pushId: 'push-skip',
      mode: 'replace',
      enabled: true,
      title: 'skip',
      items: [
        { mediaId: shaImg, ext: 'png', kind: 'image', seconds: 1 },
        { mediaId: shaVid, ext: 'mp4', kind: 'video', seconds: 4 },
      ],
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${srv.base}/signage/s/skip-test?pollMs=150`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForSelector(`.slide.is-visible img[src*="${shaImg}"]`, { timeout: 5000 });
    await page.waitForTimeout(300);

    // Close server -> video is NOT cached (max=0), so player must skip it and return to shaImg
    await srv.close();
    await page.waitForSelector(`.slide.is-visible img[src*="${shaImg}"]`, { timeout: 5000 });
    await context.close();
  } finally {
    await browser.close();
    await srv.close().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  }
});
