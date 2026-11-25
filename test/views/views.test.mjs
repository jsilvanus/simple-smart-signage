import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../../src/storage/index.mjs';
import { createState, StateError } from '../../src/state/index.mjs';
import { createAuth, testing } from '../../src/auth/index.mjs';
import { registerViewRoutes } from '../../src/api/views.mjs';
import { registerReadRoutes } from '../../src/api/read.mjs';

import { startTestServer, http, testConfig } from '../helpers/server.mjs';

async function setup() {
  const storage = createMemoryStorage();
  const state = createState(storage);
  const fakeCanva = testing.createFakeCanva({});
  const auth = createAuth(testConfig({}), { fetch: fakeCanva.jwksFetch });
  const srv = await startTestServer({}, { storage, state, auth });
  registerViewRoutes(srv.ctx.router, srv.ctx);
  return { ...srv, state };
}

test('view CRUD: kind, embed and text fields are stored; aggregates refuse items', async () => {
  const s = await setup();
  try {
    const view = await s.state.createScreen({
      id: 'aikuistyo', name: 'Aikuistyö', kind: 'view',
      embed: { type: 'carousel', allowedOrigins: ['https://seurakunta.example'] },
    });
    assert.equal(view.kind, 'view');
    assert.deepEqual(view.embed.allowedOrigins, ['https://seurakunta.example']);

    await assert.rejects(
      () => s.state.createScreen({ id: 'x1', name: 'X', kind: 'view', power: { driver: 'none' } }),
      (e) => e instanceof StateError && e.code === 'INVALID_SCREEN',
    );
    await s.state.createScreen({ id: 'aggr', name: 'Kaikki', kind: 'aggregate', members: ['aikuistyo'] });
    await assert.rejects(
      () => s.state.applyPush('aggr', { pushId: 'p1', title: 'T', items: [{ kind: 'image', mediaId: 'm', ext: 'png' }] }),
      (e) => e.code === 'KIND_MISMATCH',
    );
    await assert.rejects(
      () => s.state.createScreen({ id: 'lobby', name: 'Lobby', embed: { type: 'single' } }),
      (e) => e.code === 'INVALID_SCREEN',
    );
  } finally {
    await s.close();
  }
});

test('the public playlist shows only enabled entries with their text, and an aggregate joins its members', async () => {
  const s = await setup();
  try {
    await s.state.createScreen({ id: 'a1', name: 'A', kind: 'view', embed: { allowedOrigins: ['https://site.example'] } });
    await s.state.createScreen({ id: 'b1', name: 'B', kind: 'view', embed: {} });
    await s.state.createScreen({ id: 'agg', name: 'Yhteinen', kind: 'aggregate', members: ['a1', 'b1'], embed: { type: 'gallery' } });
    const item = { kind: 'image', mediaId: 'aaa', ext: 'png', seconds: 5, alt: 'Kirkko', headline: 'Tervetuloa', caption: 'Ovet auki', link: 'https://seurakunta.example/x' };
    await s.state.applyPush('a1', { pushId: 'p1', title: 'T', mode: 'replace', enabled: true, items: [item] });
    await s.state.applyPush('b1', { pushId: 'p2', title: 'T', enabled: false, items: [{ ...item, mediaId: 'bbb', headline: null }] });

    const v = await http(s.base, '/v/a1/playlist.json', { headers: { origin: 'https://site.example' } });
    assert.equal(v.status, 200);
    assert.equal(v.headers.get('access-control-allow-origin'), 'https://site.example');
    const body = v.json;
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0].headline, 'Tervetuloa');
    assert.equal(body.entries[0].alt, 'Kirkko');
    assert.equal(body.entries[0].link, 'https://seurakunta.example/x');

    const other = await http(s.base, '/v/a1/playlist.json', { headers: { origin: 'https://evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);

    const agg = await http(s.base, '/v/agg/playlist.json');
    assert.deepEqual(agg.json.entries.map((e) => e.sourceView), ['a1'], 'disabled entries of b1 stay out');
  } finally {
    await s.close();
  }
});

test('the frame page carries CSP frame-ancestors from the view and no inline data from entries', async () => {
  const s = await setup();
  try {
    await s.state.createScreen({ id: 'a1', name: 'Aikuistyö', kind: 'view', embed: { type: 'single', allowedOrigins: ['https://site.example'] } });
    const r = await http(s.base, '/v/a1/frame');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors https:\/\/site\.example/);
    const html = r.text;
    assert.match(html, /SissiViews\.mount/);
    assert.match(html, /<title>Aikuistyö<\/title>/);
    const emb = await http(s.base, '/v/a1/embed.js');
    assert.equal(emb.status, 200);
    assert.match(emb.text, /data-sissi-embed/);
  } finally {
    await s.close();
  }
});

test('screens are not views: view routes answer 404 for them', async () => {
  const s = await setup();
  try {
    await s.state.createScreen({ id: 'lobby', name: 'Lobby' });
    assert.equal((await http(s.base, '/v/lobby/playlist.json')).status, 404);
    assert.equal((await http(s.base, '/v/Bad_Id/frame')).status, 404);
  } finally {
    await s.close();
  }
});

test('GET /api/v1/screens?kind= filters the list (Canva lists views and screens separately)', async () => {
  const storage = createMemoryStorage();
  const state = createState(storage);
  const fakeCanva = testing.createFakeCanva({});
  const env = { SISSI_CANVA_APP_ID: 'app-test', SISSI_CANVA_ALLOWED_BRANDS: 'brand-ok', SISSI_CORS_ORIGINS: 'https://canva.example' };
  const auth = createAuth(testConfig(env), { fetch: fakeCanva.jwksFetch });
  const s = await startTestServer(env, { storage, state, auth });
  registerReadRoutes(s.ctx.router, s.ctx);
  try {
    await state.createScreen({ id: 'lobby', name: 'Lobby' });
    await state.createScreen({ id: 'a1', name: 'A', kind: 'view', embed: {} });
    await state.createScreen({ id: 'agg', name: 'G', kind: 'aggregate', members: ['a1'] });
    const token = fakeCanva.signToken({ brandId: 'brand-ok', aud: 'app-test' });
    const get = (q) => http(s.base, `/api/v1/screens${q}`, { headers: { authorization: `Bearer ${token}` } });
    const ids = async (q) => (await get(q)).json.screens.map((x) => x.id);
    assert.deepEqual(await ids('?kind=view'), ['a1']);
    assert.deepEqual(await ids('?kind=screen'), ['lobby']);
    assert.equal((await get('?kind=marquee')).status, 422);
  } finally {
    await s.close();
  }
});

test('ETag 304, aggregate combined version, OPTIONS preflight, and KIND_MISMATCH guards', async () => {
  const s = await setup();
  try {
    await s.state.createScreen({ id: 'm1', name: 'M1', kind: 'view', embed: { allowedOrigins: ['https://site.example'] } });
    await s.state.createScreen({ id: 'agg1', name: 'Agg', kind: 'aggregate', members: ['m1'], embed: { allowedOrigins: ['https://site.example'] } });
    await s.state.applyPush('m1', { pushId: 'p1', title: 'T', enabled: true, items: [{ kind: 'image', mediaId: 'aaa', ext: 'png', seconds: 5 }] });

    const first = await http(s.base, '/v/m1/playlist.json', { headers: { origin: 'https://site.example' } });
    assert.equal(first.status, 200);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const notMod = await http(s.base, '/v/m1/playlist.json', { headers: { origin: 'https://site.example', 'if-none-match': etag } });
    assert.equal(notMod.status, 304);

    const agg = await http(s.base, '/v/agg1/playlist.json');
    assert.match(String(agg.json.version), /m1@/);

    const opt = await http(s.base, '/v/m1/playlist.json', { method: 'OPTIONS', headers: { origin: 'https://site.example' } });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get('access-control-allow-origin'), 'https://site.example');
    assert.match(opt.headers.get('access-control-allow-methods'), /GET/);

    const optEmbed = await http(s.base, '/v/m1/embed.js', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    assert.equal(optEmbed.status, 204);
    assert.equal(optEmbed.headers.get('access-control-allow-origin'), null);

    // /s/:viewId/playlist.json rejects views and aggregates with 422 KIND_MISMATCH
    assert.equal((await http(s.base, '/s/m1/playlist.json')).status, 422);

    // Aggregate creation rejects unknown/non-view members, and deleting a member cascades cleanup
    await assert.rejects(() => s.state.createScreen({ id: 'badagg', name: 'Bad', kind: 'aggregate', members: ['missing'] }), (e) => e.code === 'INVALID_SCREEN');
    await s.state.deleteScreen('m1');
    const aggAfter = await s.state.getScreen('agg1');
    assert.deepEqual(aggAfter.members, []);
  } finally {
    await s.close();
  }
});

test('runtime.js mounts carousel with --sv-aspect/--sv-fit CSS vars and .sv-dot sizing in browser', async () => {
  const { chromium } = await import('playwright-core');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const chromePath = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
  if (!chromePath) return;
  const s = await setup();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const tmpFile = path.join(os.tmpdir(), `sissi-dom-${Date.now()}.png`);
  try {
    await s.state.createScreen({
      id: 'domview',
      name: 'DOM View',
      kind: 'view',
      embed: { type: 'carousel', options: { aspect: '4:5', fit: 'cover', dots: true }, allowedOrigins: ['http://127.0.0.1'] },
    });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    fs.writeFileSync(tmpFile, png);
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(png).digest('hex');
    await s.ctx.storage.putMediaFromFile(sha, 'png', tmpFile, 'image/png');
    await s.state.applyPush('domview', {
      pushId: 'p1',
      title: 'T',
      enabled: true,
      items: [
        { kind: 'image', mediaId: sha, ext: 'png', seconds: 5, headline: 'One' },
        { kind: 'image', mediaId: sha, ext: 'png', seconds: 5, headline: 'Two' },
      ],
    });
    const page = await browser.newPage();
    await page.goto(`${s.base}/v/domview/frame`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root .sv-dot', { timeout: 5000 });
    const check = await page.evaluate(() => {
      const wrap = document.querySelector('#root .sissi-view');
      const dot = document.querySelector('#root .sv-dot');
      return {
        aspect: wrap?.style.getPropertyValue('--sv-aspect'),
        fit: wrap?.style.getPropertyValue('--sv-fit'),
        dotWidth: dot ? parseFloat(getComputedStyle(dot).width) : null,
      };
    });
    assert.equal(check.aspect, '4 / 5');
    assert.equal(check.fit, 'cover');
    assert.ok(check.dotWidth !== null && check.dotWidth < 25, `dot width should be small, got ${check.dotWidth}`);
  } finally {
    fs.rmSync(tmpFile, { force: true });
    await browser.close();
    await s.close();
  }
});
