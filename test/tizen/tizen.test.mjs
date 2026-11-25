import test from 'node:test';
import assert from 'node:assert/strict';
import httpNode from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { deflateSync, crc32 } from 'node:zlib';
import { chromium } from 'playwright-core';

import { buildWgt, parseZipEntries, validateConfigXml } from '../../clients/tizen/scripts/build-wgt.mjs';
import { startTestServer } from '../helpers/server.mjs';
import { createMemoryStorage } from '../../src/storage/index.mjs';
import { createState } from '../../src/state/index.mjs';
import { createAuth, testing as authTesting } from '../../src/auth/index.mjs';
import { registerReadRoutes } from '../../src/api/read.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const TIZEN_DIR = path.join(REPO_ROOT, 'clients', 'tizen');
const SAMPLE_MP4 = path.join(REPO_ROOT, 'test', 'player', 'fixtures', 'sample.mp4');

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

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
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
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
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

async function loadBrowserScript(relPath) {
  const code = await readFile(path.join(TIZEN_DIR, relPath), 'utf8');
  const sandbox = { globalThis: {}, URL, RegExp, Object, Array, Boolean, String, Number, JSON };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: relPath });
  return sandbox;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.xml': 'application/xml; charset=utf-8',
};

async function startStaticTizenServer() {
  const server = httpNode.createServer(async (req, res) => {
    const reqPath = (req.url || '/').split('?')[0];
    const rel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
    const abs = path.resolve(TIZEN_DIR, rel);
    if (!abs.startsWith(TIZEN_DIR)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const data = await readFile(abs);
      const ext = path.extname(abs);
      res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test('build-wgt produces a valid .wgt ZIP containing config.xml, index.html, icon.png, and src/*', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sissi-wgt-'));
  try {
    const outFile = path.join(tmpDir, 'sissi-tizen.wgt');
    const result = await buildWgt({ outFile });
    assert.ok(result.bytes > 0);

    const buf = await readFile(outFile);
    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'starts with ZIP local file header PK\\x03\\x04');

    const entries = parseZipEntries(buf);
    const names = new Set(entries.map((e) => e.name));
    for (const required of [
      'config.xml',
      'icon.png',
      'index.html',
      'app.css',
      'src/config.js',
      'src/orientation.js',
      'src/storage.js',
      'src/remote.js',
      'src/player.js',
      'src/main.js',
    ]) {
      assert.ok(names.has(required), `ZIP should contain ${required}`);
    }

    assert.throws(() => validateConfigXml('<widget></widget>'), /tv-samsung/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('config.js: URL normalization, screenId validation, and root-relative entry.url resolution', async () => {
  const { SiSSiConfig } = await loadBrowserScript('src/config.js');

  assert.equal(SiSSiConfig.normalizeServerUrl('  https://example.com/signage///  '), 'https://example.com/signage');
  assert.equal(SiSSiConfig.normalizeServerUrl('ftp://example.com'), '');
  assert.equal(SiSSiConfig.isValidScreenId('lobby-1'), true);
  assert.equal(SiSSiConfig.isValidScreenId('INVALID_ID'), false);

  assert.equal(
    SiSSiConfig.resolveMediaUrl('/signage/media/abc.png', 'https://example.com/signage'),
    'https://example.com/signage/media/abc.png',
  );
  assert.equal(
    SiSSiConfig.resolveMediaUrl('https://cdn.example.com/x.png', 'https://example.com/signage'),
    'https://cdn.example.com/x.png',
  );
  assert.equal(
    SiSSiConfig.buildPlaylistUrl({ serverUrl: 'https://example.com/signage/', screenId: 'lobby' }),
    'https://example.com/signage/s/lobby/playlist.json',
  );
});

test('orientation.js: computeRotationClass handles auto, native, cw90, ccw90', async () => {
  const { SiSSiOrientation } = await loadBrowserScript('src/orientation.js');

  assert.equal(SiSSiOrientation.computeRotationClass('auto', 'vertical', 1920, 1080), 'rotate-cw90');
  assert.equal(SiSSiOrientation.computeRotationClass('auto', 'vertical', 1080, 1920), '');
  assert.equal(SiSSiOrientation.computeRotationClass('auto', 'landscape', 1920, 1080), '');
  assert.equal(SiSSiOrientation.computeRotationClass('native', 'vertical', 1920, 1080), '');
  assert.equal(SiSSiOrientation.computeRotationClass('cw90', 'landscape', 1920, 1080), 'rotate-cw90');
  assert.equal(SiSSiOrientation.computeRotationClass('ccw90', 'landscape', 1920, 1080), 'rotate-ccw90');
});

test('Playwright Tizen receiver: keep-awake, D-pad setup, playback, version switch, offline IDB loop, and vertical rotation', async (t) => {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    t.skip('No Chrome/Edge executable found for Playwright');
    return;
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sissi-tizen-pw-'));
  const storage = createMemoryStorage();
  const state = createState(storage);
  const fakeCanva = authTesting.createFakeCanva();
  const auth = createAuth(
    { canva: { appId: 'app-test', allowedBrands: ['brand-1'] }, pushKey: '', corsOrigins: [] },
    { fetch: fakeCanva.jwksFetch },
  );
  const apiSrv = await startTestServer({ SISSI_PUBLIC_PATH: '/signage' }, { storage, state, auth });
  registerReadRoutes(apiSrv.ctx.router, apiSrv.ctx);
  const staticSrv = await startStaticTizenServer();

  let browser;
  try {
    await state.createScreen({ id: 'lobby', name: 'Lobby', orientation: 'landscape' });
    const img1Sha = await storeBuffer(storage, tmpDir, 'img1.png', makePng(220, 40, 40), 'png', 'image/png');
    const mp4Buf = await readFile(SAMPLE_MP4);
    const vidSha = await storeBuffer(storage, tmpDir, 'vid.mp4', mp4Buf, 'mp4', 'video/mp4');
    const img2Sha = await storeBuffer(storage, tmpDir, 'img2.png', makePng(40, 200, 80), 'png', 'image/png');

    await state.applyPush('lobby', {
      pushId: 'p1',
      title: 'Push 1',
      mode: 'replace',
      enabled: true,
      items: [
        { kind: 'image', mediaId: img1Sha, ext: 'png', seconds: 1 },
        { kind: 'video', mediaId: vidSha, ext: 'mp4', seconds: 1 },
      ],
    });

    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    await page.addInitScript(() => {
      window.__tizenCalls = { screenSaver: [], power: [], registeredKeys: [] };
      window.webapis = {
        appcommon: {
          AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 0, SCREEN_SAVER_ON: 1 },
          setScreenSaver: (val, ok) => {
            window.__tizenCalls.screenSaver.push(val);
            if (ok) ok();
          },
        },
      };
      window.tizen = {
        power: {
          request: (resource, stateVal) => {
            window.__tizenCalls.power.push([resource, stateVal]);
          },
        },
        tvinputdevice: {
          registerKeyBatch: (keys) => {
            window.__tizenCalls.registeredKeys.push(...keys);
          },
          getKey: (name) => {
            const map = { Return: 10009, Exit: 10182, Info: 457, Menu: 10133, ColorF0Red: 403, ColorF3Blue: 406 };
            return map[name] ? { name, code: map[name] } : null;
          },
        },
        application: {
          getCurrentApplication: () => ({ exit: () => {} }),
        },
      };
    });

    await page.goto(`${staticSrv.base}/?pollMs=120`);

    // Verify keep-awake & key registration
    const tizenCalls = await page.evaluate(() => window.__tizenCalls);
    assert.deepEqual(tizenCalls.screenSaver, [0]);
    assert.deepEqual(tizenCalls.power, [['SCREEN', 'SCREEN_NORMAL']]);
    assert.ok(tizenCalls.registeredKeys.includes('Info'));

    // First boot: setup overlay is visible
    await page.waitForSelector('#setup-overlay:not(.is-hidden)');
    await page.fill('#cfg-server-url', `${apiSrv.base}/signage`);
    await page.fill('#cfg-screen-id', 'lobby');
    await page.click('#cfg-save');

    // Overlay closes and config is persisted in localStorage
    await page.waitForSelector('#setup-overlay.is-hidden', { state: 'hidden' });
    const savedCfg = await page.evaluate(() => JSON.parse(localStorage.getItem('sissi:tizen:config')));
    assert.equal(savedCfg.serverUrl, `${apiSrv.base}/signage`);
    assert.equal(savedCfg.screenId, 'lobby');

    // First image appears and video plays
    await page.waitForSelector('#stage .slide.is-visible img');
    await page.waitForSelector('#stage .slide.is-visible video');

    // Wait for IndexedDB cache to populate both media entries
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('sissi-tizen', 1);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('media')) return resolve(false);
            const tx = db.transaction('media', 'readonly');
            const countReq = tx.objectStore('media').count();
            countReq.onsuccess = () => resolve(countReq.result >= 2);
            countReq.onerror = () => resolve(false);
          };
          req.onerror = () => resolve(false);
        }),
      null,
      { timeout: 5000 },
    );

    // Push version 2 with vertical orientation & img2
    await state.updateScreen('lobby', { orientation: 'vertical' });
    await state.applyPush('lobby', {
      pushId: 'p2',
      title: 'Push 2',
      mode: 'replace',
      enabled: true,
      items: [{ kind: 'image', mediaId: img2Sha, ext: 'png', seconds: 1 }],
    });

    // At boundary, #stage gets rotate-cw90 class and shows img2
    await page.waitForFunction(
      (sha) => {
        const stage = document.getElementById('stage');
        const img = stage?.querySelector('.slide.is-visible img');
        return stage?.classList.contains('rotate-cw90') && img && img.complete;
      },
      img2Sha,
      { timeout: 5000 },
    );

    // Wait for img2 to be cached in IDB, then stop the API server to test offline loop
    await page.waitForFunction(
      (key) =>
        new Promise((resolve) => {
          const req = indexedDB.open('sissi-tizen', 1);
          req.onsuccess = () => {
            const tx = req.result.transaction('media', 'readonly');
            const getReq = tx.objectStore('media').get(key);
            getReq.onsuccess = () => resolve(Boolean(getReq.result && getReq.result.blob));
            getReq.onerror = () => resolve(false);
          };
        }),
      `${img2Sha}.png`,
      { timeout: 5000 },
    );

    await apiSrv.close();

    // Verify slide continues rendering from IndexedDB (blob: URL) while offline
    await page.waitForFunction(
      () => {
        const img = document.querySelector('#stage .slide.is-visible img');
        return img && img.src.startsWith('blob:') && img.naturalWidth > 0;
      },
      null,
      { timeout: 4000 },
    );

    // Verify D-pad Info key (457) opens overlay and Return key (10009) closes it
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 457, which: 457, bubbles: true }));
    });
    await page.waitForSelector('#setup-overlay:not(.is-hidden)');
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 10009, which: 10009, bubbles: true }));
    });
    await page.waitForSelector('#setup-overlay.is-hidden', { state: 'hidden' });
  } finally {
    if (browser) await browser.close();
    await staticSrv.close();
    await apiSrv.close().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  }
});
