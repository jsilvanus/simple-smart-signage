import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAuth } from '../../src/admin-auth/index.mjs';
import { registerAdminRoutes } from '../../src/api/admin.mjs';
import { testing as authTesting } from '../../src/auth/index.mjs';
import { createState } from '../../src/state/index.mjs';
import { createMemoryStorage } from '../../src/storage/index.mjs';
import { http, startTestServer } from '../helpers/server.mjs';

const ADMIN_PASSWORD = 'correct-horse-battery-staple';
const PNG_SHA = 'a'.repeat(64);
const MP4_SHA = 'b'.repeat(64);

async function setupAdminServer({ env = {}, now } = {}) {
  const storage = createMemoryStorage();
  const state = createState(storage);
  const srv = await startTestServer(
    {
      SISSI_ADMIN_PASSWORD: ADMIN_PASSWORD,
      SISSI_PUSH_KEY: 'push-secret-key',
      SISSI_GC_GRACE_MINUTES: '0',
      ...env,
    },
    { storage, state },
  );
  const adminAuth = now ? createAdminAuth(srv.config, { now }) : createAdminAuth(srv.config);
  srv.ctx.adminAuth = adminAuth;
  registerAdminRoutes(srv.ctx.router, srv.ctx);
  return { ...srv, storage, state, adminAuth };
}

function extractCookiePair(setCookieHeader) {
  assert.ok(setCookieHeader, 'expected set-cookie header');
  return setCookieHeader.split(';')[0];
}

async function loginCookie(base, prefix = '/signage', password = ADMIN_PASSWORD) {
  const res = await http(base, `${prefix}/api/v1/admin/login`, {
    method: 'POST',
    body: { password },
  });
  assert.equal(res.status, 204);
  return { cookie: extractCookiePair(res.headers.get('set-cookie')), setCookie: res.headers.get('set-cookie') };
}

test('unconfigured admin password returns 503 AUTH_NOT_CONFIGURED on login and admin routes', async (t) => {
  const srv = await setupAdminServer({ env: { SISSI_ADMIN_PASSWORD: '' } });
  t.after(srv.close);

  const loginRes = await http(srv.base, '/signage/api/v1/admin/login', {
    method: 'POST',
    body: { password: 'any' },
  });
  assert.equal(loginRes.status, 503);
  assert.equal(loginRes.json.error.code, 'AUTH_NOT_CONFIGURED');

  const listRes = await http(srv.base, '/signage/api/v1/admin/screens');
  assert.equal(listRes.status, 503);
  assert.equal(listRes.json.error.code, 'AUTH_NOT_CONFIGURED');
});

test('login validates password, sets cookie attributes, and supports publicPath root', async (t) => {
  const srv = await setupAdminServer();
  t.after(srv.close);

  const bad = await http(srv.base, '/signage/api/v1/admin/login', {
    method: 'POST',
    body: { password: 'wrong-password' },
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.json.error.code, 'UNAUTHORIZED');
  assert.equal(bad.headers.get('set-cookie'), null);

  const { setCookie } = await loginCookie(srv.base);
  assert.match(setCookie, /^sissi_admin=[^;]+\.[^;]+/);
  assert.match(setCookie, /;\s*Path=\/signage(?:;|$)/);
  assert.match(setCookie, /;\s*HttpOnly(?:;|$)/);
  assert.match(setCookie, /;\s*SameSite=Strict(?:;|$)/);
  assert.doesNotMatch(setCookie, /;\s*Secure(?:;|$)/);

  const rootSrv = await setupAdminServer({ env: { SISSI_PUBLIC_PATH: '' } });
  t.after(rootSrv.close);
  const rootLogin = await loginCookie(rootSrv.base, '');
  assert.match(rootLogin.setCookie, /;\s*Path=\/(?:;|$)/);

  // Production config adds Secure attribute
  const prodAuth = createAdminAuth({
    adminPassword: ADMIN_PASSWORD,
    publicPath: '/signage',
    production: true,
  });
  let capturedHeaders;
  const fakeRes = {
    writeHead(status, headers) {
      assert.equal(status, 204);
      capturedHeaders = headers;
    },
    end() {},
  };
  await prodAuth.login({ socket: { remoteAddress: '10.0.0.1' } }, fakeRes, { password: ADMIN_PASSWORD });
  assert.match(capturedHeaders['set-cookie'], /;\s*Secure(?:;|$)/);
});

test('login rate-limits after 5 failures per IP per 10 minutes and resets on success or window expiry', async (t) => {
  let currentMs = 1_700_000_000_000;
  const srv = await setupAdminServer({ now: () => currentMs });
  t.after(srv.close);

  // 4 failures followed by 1 success should reset counter
  for (let i = 0; i < 4; i++) {
    const res = await http(srv.base, '/signage/api/v1/admin/login', {
      method: 'POST',
      body: { password: 'nope' },
    });
    assert.equal(res.status, 401);
  }
  const ok = await http(srv.base, '/signage/api/v1/admin/login', {
    method: 'POST',
    body: { password: ADMIN_PASSWORD },
  });
  assert.equal(ok.status, 204);

  // Now 5 failures trigger 429 on the 6th attempt (even with valid password)
  for (let i = 0; i < 5; i++) {
    const res = await http(srv.base, '/signage/api/v1/admin/login', {
      method: 'POST',
      body: { password: 'nope' },
    });
    assert.equal(res.status, 401);
  }
  const limited = await http(srv.base, '/signage/api/v1/admin/login', {
    method: 'POST',
    body: { password: ADMIN_PASSWORD },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error.code, 'RATE_LIMITED');

  // After 10 minutes, login works again
  currentMs += 10 * 60 * 1000 + 1;
  const recovered = await http(srv.base, '/signage/api/v1/admin/login', {
    method: 'POST',
    body: { password: ADMIN_PASSWORD },
  });
  assert.equal(recovered.status, 204);
});

test('admin routes require valid non-expired cookie, CSRF header on writes, and reject Canva/push Bearer tokens', async (t) => {
  let currentMs = 1_700_000_000_000;
  const srv = await setupAdminServer({ now: () => currentMs });
  t.after(srv.close);

  const canva = authTesting.createFakeCanva();
  const canvaToken = canva.signToken({ brandId: 'brand1', aud: 'app1' });

  // No cookie
  const unauthGet = await http(srv.base, '/signage/api/v1/admin/screens');
  assert.equal(unauthGet.status, 401);
  assert.equal(unauthGet.json.error.code, 'UNAUTHORIZED');

  // Canva Bearer token rejected on GET and POST
  const canvaGet = await http(srv.base, '/signage/api/v1/admin/screens', {
    headers: { authorization: `Bearer ${canvaToken}` },
  });
  assert.equal(canvaGet.status, 401);
  assert.equal(canvaGet.json.error.code, 'UNAUTHORIZED');

  const pushKeyPost = await http(srv.base, '/signage/api/v1/admin/screens', {
    method: 'POST',
    headers: { authorization: 'Bearer push-secret-key', 'x-sissi-admin': '1' },
    body: { id: 'lobby', name: 'Lobby' },
  });
  assert.equal(pushKeyPost.status, 401);
  assert.equal(pushKeyPost.json.error.code, 'UNAUTHORIZED');

  // Valid cookie
  const { cookie } = await loginCookie(srv.base);

  // Tampered cookie
  const tampered = await http(srv.base, '/signage/api/v1/admin/screens', {
    headers: { cookie: `${cookie}tamper` },
  });
  assert.equal(tampered.status, 401);

  // GET succeeds without X-Sissi-Admin
  const authedGet = await http(srv.base, '/signage/api/v1/admin/screens', {
    headers: { cookie },
  });
  assert.equal(authedGet.status, 200);
  assert.deepEqual(authedGet.json.screens, []);

  // Write without X-Sissi-Admin: 1 fails
  const missingCsrf = await http(srv.base, '/signage/api/v1/admin/screens', {
    method: 'POST',
    headers: { cookie },
    body: { id: 'lobby', name: 'Lobby' },
  });
  assert.equal(missingCsrf.status, 401);
  assert.equal(missingCsrf.json.error.code, 'UNAUTHORIZED');

  // Logout without X-Sissi-Admin: 1 fails, with header succeeds and clears cookie
  const logoutNoCsrf = await http(srv.base, '/signage/api/v1/admin/logout', {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(logoutNoCsrf.status, 401);

  const logoutOk = await http(srv.base, '/signage/api/v1/admin/logout', {
    method: 'POST',
    headers: { cookie, 'x-sissi-admin': '1' },
  });
  assert.equal(logoutOk.status, 204);
  assert.match(logoutOk.headers.get('set-cookie'), /Max-Age=0/);

  // Session expires after 12h
  currentMs += 12 * 60 * 60 * 1000;
  const expired = await http(srv.base, '/signage/api/v1/admin/screens', {
    headers: { cookie },
  });
  assert.equal(expired.status, 401);
  assert.equal(expired.json.error.code, 'UNAUTHORIZED');
});

test('screen CRUD endpoints, param validation, and error codes', async (t) => {
  const srv = await setupAdminServer();
  t.after(srv.close);

  const { cookie } = await loginCookie(srv.base);
  const writeHeaders = { cookie, 'x-sissi-admin': '1' };

  // Create
  const created = await http(srv.base, '/signage/api/v1/admin/screens', {
    method: 'POST',
    headers: writeHeaders,
    body: { id: 'lobby-1', name: 'Main Lobby', orientation: 'vertical', defaultImageSeconds: 15 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.id, 'lobby-1');
  assert.equal(created.json.orientation, 'vertical');
  assert.equal(created.json.defaultImageSeconds, 15);
  assert.deepEqual(created.json.entries, []);

  // Duplicate -> 409 SCREEN_EXISTS
  const dup = await http(srv.base, '/signage/api/v1/admin/screens', {
    method: 'POST',
    headers: writeHeaders,
    body: { id: 'lobby-1', name: 'Other' },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, 'SCREEN_EXISTS');

  // Invalid screen -> 422 INVALID_SCREEN / INVALID_SECONDS
  const invalidScreen = await http(srv.base, '/signage/api/v1/admin/screens', {
    method: 'POST',
    headers: writeHeaders,
    body: { id: 'INVALID_ID', name: 'Bad' },
  });
  assert.equal(invalidScreen.status, 422);
  assert.equal(invalidScreen.json.error.code, 'INVALID_SCREEN');

  const invalidSec = await http(srv.base, '/signage/api/v1/admin/screens', {
    method: 'POST',
    headers: writeHeaders,
    body: { id: 'lobby-2', name: 'Lobby 2', defaultImageSeconds: 5000 },
  });
  assert.equal(invalidSec.status, 422);
  assert.equal(invalidSec.json.error.code, 'INVALID_SECONDS');

  // List
  const listed = await http(srv.base, '/signage/api/v1/admin/screens', { headers: { cookie } });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.screens.length, 1);
  assert.equal(listed.json.screens[0].id, 'lobby-1');

  // Patch
  const patched = await http(srv.base, '/signage/api/v1/admin/screens/lobby-1', {
    method: 'PATCH',
    headers: writeHeaders,
    body: { name: 'Renamed Lobby', maxVideoSeconds: 30 },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.name, 'Renamed Lobby');
  assert.equal(patched.json.maxVideoSeconds, 30);

  // Patch unknown / invalid param -> 404 SCREEN_NOT_FOUND
  const patchMissing = await http(srv.base, '/signage/api/v1/admin/screens/missing-screen', {
    method: 'PATCH',
    headers: writeHeaders,
    body: { name: 'Nope' },
  });
  assert.equal(patchMissing.status, 404);
  assert.equal(patchMissing.json.error.code, 'SCREEN_NOT_FOUND');

  const patchInvalidParam = await http(srv.base, '/signage/api/v1/admin/screens/a..b', {
    method: 'PATCH',
    headers: writeHeaders,
    body: { name: 'Nope' },
  });
  assert.equal(patchInvalidParam.status, 404);
  assert.equal(patchInvalidParam.json.error.code, 'SCREEN_NOT_FOUND');

  const patchBadChars = await http(srv.base, '/signage/api/v1/admin/screens/BAD_ID', {
    method: 'PATCH',
    headers: writeHeaders,
    body: { name: 'Nope' },
  });
  assert.equal(patchBadChars.status, 404);
  assert.equal(patchBadChars.json.error.code, 'SCREEN_NOT_FOUND');

  // Delete unknown -> 404 SCREEN_NOT_FOUND
  const delMissing = await http(srv.base, '/signage/api/v1/admin/screens/nope', {
    method: 'DELETE',
    headers: writeHeaders,
  });
  assert.equal(delMissing.status, 404);
  assert.equal(delMissing.json.error.code, 'SCREEN_NOT_FOUND');

  // Delete existing -> 204
  const delOk = await http(srv.base, '/signage/api/v1/admin/screens/lobby-1', {
    method: 'DELETE',
    headers: writeHeaders,
  });
  assert.equal(delOk.status, 204);
});

test('entries reorder, seconds update, delete entry, delete push, and GC sweep', async (t) => {
  const srv = await setupAdminServer();
  t.after(srv.close);

  const { cookie } = await loginCookie(srv.base);
  const writeHeaders = { cookie, 'x-sissi-admin': '1' };

  await srv.state.createScreen({ id: 'hall', name: 'Hall' });
  await srv.storage.putMediaFromFile(PNG_SHA, 'png', new URL(import.meta.url), 'image/png');
  await srv.storage.putMediaFromFile(MP4_SHA, 'mp4', new URL(import.meta.url), 'video/mp4');

  await srv.state.applyPush('hall', {
    pushId: 'push-1',
    mode: 'append',
    title: 'First',
    items: [
      { mediaId: PNG_SHA, ext: 'png', kind: 'image', seconds: 10 },
      { mediaId: MP4_SHA, ext: 'mp4', kind: 'video', seconds: 20 },
    ],
  });
  await srv.state.applyPush('hall', {
    pushId: 'push-2',
    mode: 'append',
    title: 'Second',
    items: [{ mediaId: PNG_SHA, ext: 'png', kind: 'image', seconds: 8 }],
  });

  const screen = await srv.state.getScreen('hall');
  const [e1, e2, e3] = screen.entries;

  // Reorder: invalid permutation -> 422 INVALID_PAGES
  const badReorder = await http(srv.base, '/signage/api/v1/admin/screens/hall/entries', {
    method: 'PUT',
    headers: writeHeaders,
    body: { entryIds: [e1.entryId, e2.entryId] },
  });
  assert.equal(badReorder.status, 422);
  assert.equal(badReorder.json.error.code, 'INVALID_PAGES');

  // Reorder: valid permutation -> 200 { screenId, version, entries }
  const reordered = await http(srv.base, '/signage/api/v1/admin/screens/hall/entries', {
    method: 'PUT',
    headers: writeHeaders,
    body: { entryIds: [e3.entryId, e2.entryId, e1.entryId] },
  });
  assert.equal(reordered.status, 200);
  assert.equal(reordered.json.screenId, 'hall');
  assert.equal(reordered.json.version, screen.playlistVersion + 1);
  assert.deepEqual(
    reordered.json.entries.map((e) => e.entryId),
    [e3.entryId, e2.entryId, e1.entryId],
  );

  // Patch entry seconds: invalid -> 422 INVALID_SECONDS; video -> 422 INVALID_KIND; missing -> 404
  const badSec = await http(srv.base, `/signage/api/v1/admin/screens/hall/entries/${e1.entryId}`, {
    method: 'PATCH',
    headers: writeHeaders,
    body: { seconds: 0 },
  });
  assert.equal(badSec.status, 422);
  assert.equal(badSec.json.error.code, 'INVALID_SECONDS');

  const videoSec = await http(srv.base, `/signage/api/v1/admin/screens/hall/entries/${e2.entryId}`, {
    method: 'PATCH',
    headers: writeHeaders,
    body: { seconds: 12 },
  });
  assert.equal(videoSec.status, 422);
  assert.equal(videoSec.json.error.code, 'INVALID_KIND');

  const missingEntry = await http(srv.base, '/signage/api/v1/admin/screens/hall/entries/nope', {
    method: 'PATCH',
    headers: writeHeaders,
    body: { seconds: 12 },
  });
  assert.equal(missingEntry.status, 404);
  assert.equal(missingEntry.json.error.code, 'ENTRY_NOT_FOUND');

  const okSec = await http(srv.base, `/signage/api/v1/admin/screens/hall/entries/${e1.entryId}`, {
    method: 'PATCH',
    headers: writeHeaders,
    body: { seconds: 25 },
  });
  assert.equal(okSec.status, 200);
  assert.equal(okSec.json.seconds, 25);

  // Delete entry -> 204 (png still referenced by e3 so png remains)
  const delEntry = await http(srv.base, `/signage/api/v1/admin/screens/hall/entries/${e1.entryId}`, {
    method: 'DELETE',
    headers: writeHeaders,
  });
  assert.equal(delEntry.status, 204);
  assert.ok(await srv.storage.statMedia(PNG_SHA, 'png'));

  const delMissingEntry = await http(srv.base, `/signage/api/v1/admin/screens/hall/entries/${e1.entryId}`, {
    method: 'DELETE',
    headers: writeHeaders,
  });
  assert.equal(delMissingEntry.status, 404);
  assert.equal(delMissingEntry.json.error.code, 'ENTRY_NOT_FOUND');

  // Delete push-1 (removes e2 mp4) -> 204 + GC deletes unreferenced mp4
  const delPush = await http(srv.base, '/signage/api/v1/admin/screens/hall/pushes/push-1', {
    method: 'DELETE',
    headers: writeHeaders,
  });
  assert.equal(delPush.status, 204);
  assert.equal(await srv.storage.statMedia(MP4_SHA, 'mp4'), null);
  assert.ok(await srv.storage.statMedia(PNG_SHA, 'png'));

  // Delete missing push -> 404 PUSH_NOT_FOUND
  const delMissingPush = await http(srv.base, '/signage/api/v1/admin/screens/hall/pushes/push-1', {
    method: 'DELETE',
    headers: writeHeaders,
  });
  assert.equal(delMissingPush.status, 404);
  assert.equal(delMissingPush.json.error.code, 'PUSH_NOT_FOUND');

  // Delete screen -> 204 + GC deletes remaining png
  const delScreen = await http(srv.base, '/signage/api/v1/admin/screens/hall', {
    method: 'DELETE',
    headers: writeHeaders,
  });
  assert.equal(delScreen.status, 204);
  assert.equal(await srv.storage.statMedia(PNG_SHA, 'png'), null);
});

test('entries and pushes can be enabled and disabled; playlist.json follows', async (t) => {
  const srv = await setupAdminServer();
  t.after(srv.close);
  const { cookie } = await loginCookie(srv.base);
  const writeHeaders = { cookie, 'x-sissi-admin': '1' };

  await srv.state.createScreen({ id: 'hall', name: 'Hall' });
  await srv.state.applyPush('hall', {
    pushId: 'push-1',
    title: 'First',
    items: [
      { mediaId: PNG_SHA, ext: 'png', kind: 'image', seconds: 10 },
      { mediaId: PNG_SHA, ext: 'png', kind: 'image', seconds: 12 },
    ],
  });
  const [e1] = (await srv.state.getScreen('hall')).entries;
  const playlist = async () => (await srv.state.getPlaylist('hall')).entries.length;
  assert.equal(await playlist(), 0);

  const empty = await http(srv.base, `/signage/api/v1/admin/screens/hall/entries/${e1.entryId}`, {
    method: 'PATCH',
    headers: writeHeaders,
    body: {},
  });
  assert.equal(empty.status, 422);

  const bad = await http(srv.base, `/signage/api/v1/admin/screens/hall/entries/${e1.entryId}`, {
    method: 'PATCH',
    headers: writeHeaders,
    body: { enabled: 'yes' },
  });
  assert.equal(bad.json.error.code, 'INVALID_ENABLED');

  const on = await http(srv.base, `/signage/api/v1/admin/screens/hall/entries/${e1.entryId}`, {
    method: 'PATCH',
    headers: writeHeaders,
    body: { enabled: true, seconds: 15 },
  });
  assert.equal(on.status, 200);
  assert.equal(on.json.enabled, true);
  assert.equal(on.json.seconds, 15);
  assert.equal(await playlist(), 1);

  const all = await http(srv.base, '/signage/api/v1/admin/screens/hall/pushes/push-1', {
    method: 'PATCH',
    headers: writeHeaders,
    body: { enabled: true },
  });
  assert.equal(all.status, 200);
  assert.equal(all.json.entries.length, 2);
  assert.equal(await playlist(), 2);

  const off = await http(srv.base, '/signage/api/v1/admin/screens/hall/pushes/push-1', {
    method: 'PATCH',
    headers: writeHeaders,
    body: { enabled: false },
  });
  assert.equal(off.status, 200);
  assert.equal(await playlist(), 0);

  const missing = await http(srv.base, '/signage/api/v1/admin/screens/hall/pushes/nope', {
    method: 'PATCH',
    headers: writeHeaders,
    body: { enabled: true },
  });
  assert.equal(missing.status, 404);
});

test('PNG upload adds a disabled entry to the playlist and rejects non-PNG bodies', async (t) => {
  const srv = await setupAdminServer();
  t.after(srv.close);
  await srv.state.createScreen({ id: 'lobby', name: 'Lobby', orientation: 'landscape' });
  const { cookie } = await loginCookie(srv.base);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 7),
  ]);

  const ok = await fetch(`${srv.base}/signage/api/v1/admin/screens/lobby/uploads`, {
    method: 'POST',
    headers: { cookie, 'x-sissi-admin': '1', 'content-type': 'image/png', 'x-upload-title': 'Notice' },
    body: png,
  });
  assert.equal(ok.status, 201);
  const body = await ok.json();
  assert.equal(body.entry.kind, 'image');
  assert.equal(body.entry.enabled, false);
  assert.equal(body.entry.title, 'Notice');

  const bad = await fetch(`${srv.base}/signage/api/v1/admin/screens/lobby/uploads`, {
    method: 'POST',
    headers: { cookie, 'x-sissi-admin': '1', 'content-type': 'image/jpeg' },
    body: Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  });
  assert.equal(bad.status, 415);
});

/** Minimal MP4: ftyp + moov/mvhd (timescale 1000, duration 3000 => 3 s). */
function minimalMp4() {
  const box = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
  };
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isom')]));
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(3000, 16);
  return Buffer.concat([ftyp, box('moov', box('mvhd', mvhd))]);
}

test('MP4 upload stores a video entry with its duration, and a first-frame thumbnail can be attached', async (t) => {
  const srv = await setupAdminServer();
  t.after(srv.close);
  await srv.state.createScreen({ id: 'lobby', name: 'Lobby', orientation: 'landscape' });
  const { cookie } = await loginCookie(srv.base);
  const mp4 = minimalMp4();

  const up = await fetch(`${srv.base}/signage/api/v1/admin/screens/lobby/uploads`, {
    method: 'POST',
    headers: { cookie, 'x-sissi-admin': '1', 'content-type': 'video/mp4', 'x-upload-title': 'Intro' },
    body: mp4,
  });
  assert.equal(up.status, 201);
  const { entry } = await up.json();
  assert.equal(entry.kind, 'video');
  assert.equal(entry.ext, 'mp4');
  assert.equal(entry.seconds, 3);
  assert.equal(entry.enabled, false);

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 9)]);
  const thumbUrl = `${srv.base}/signage/api/v1/admin/screens/lobby/entries/${entry.entryId}/thumbnail`;
  const thumb = await fetch(thumbUrl, {
    method: 'PUT',
    headers: { cookie, 'x-sissi-admin': '1', 'content-type': 'image/png' },
    body: png,
  });
  assert.equal(thumb.status, 200);
  const thumbEntry = await thumb.json();
  assert.equal(thumbEntry.thumbExt, 'png');
  assert.ok(thumbEntry.thumbMediaId);

  const refs = await srv.state.referencedMedia();
  assert.ok(refs.has(`${entry.mediaId}.mp4`));
  assert.ok(refs.has(`${thumbEntry.thumbMediaId}.png`), 'thumbnail must count as referenced for GC');

  const notPng = await fetch(thumbUrl, {
    method: 'PUT',
    headers: { cookie, 'x-sissi-admin': '1', 'content-type': 'image/png' },
    body: Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  });
  assert.equal(notPng.status, 415);

  // Thumbnails are for video entries only.
  await srv.state.applyPush('lobby', {
    pushId: 'img1', title: 'Still', items: [{ mediaId: 'c'.repeat(64), ext: 'png', kind: 'image' }],
  });
  const imgId = (await srv.state.getScreen('lobby')).entries.find((e) => e.kind === 'image').entryId;
  const onImage = await fetch(`${srv.base}/signage/api/v1/admin/screens/lobby/entries/${imgId}/thumbnail`, {
    method: 'PUT',
    headers: { cookie, 'x-sissi-admin': '1', 'content-type': 'image/png' },
    body: png,
  });
  assert.equal(onImage.status, 422);
});
