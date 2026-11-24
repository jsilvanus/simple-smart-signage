import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMemoryStorage } from '../../src/storage/index.mjs';
import { createState } from '../../src/state/index.mjs';
import { createAuth, testing } from '../../src/auth/index.mjs';
import { registerReadRoutes } from '../../src/api/read.mjs';
import { startTestServer, http, testConfig } from '../helpers/server.mjs';

async function setupServer({ env = {}, storage = createMemoryStorage(), now } = {}) {
  const fakeCanva = testing.createFakeCanva({ now });
  const mergedEnv = {
    SISSI_CANVA_APP_ID: 'app-test',
    SISSI_CANVA_ALLOWED_BRANDS: 'brand-ok',
    SISSI_CORS_ORIGINS: 'https://canva.example',
    ...env,
  };
  const config = testConfig(mergedEnv);
  const auth = createAuth(config, { fetch: fakeCanva.jwksFetch, now });
  const state = createState(storage);
  const srv = await startTestServer(mergedEnv, { storage, state, auth });
  registerReadRoutes(srv.ctx.router, srv.ctx);
  return { ...srv, storage, state, auth, fakeCanva };
}

async function putTempMedia(storage, bytes, ext, contentType) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sissi-read-test-'));
  const filePath = path.join(dir, `${sha256}.${ext}`);
  try {
    await fs.writeFile(filePath, buf);
    await storage.putMediaFromFile(sha256, ext, filePath, contentType);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return { sha256, ext, size: buf.length, buf };
}

test('GET /api/v1/screens requires auth and returns OpenAPI Screen shape with CORS', async () => {
  const srv = await setupServer();
  try {
    const media = await putTempMedia(srv.storage, 'fake-png-bytes', 'png', 'image/png');
    await srv.state.createScreen({
      id: 'lobby',
      name: 'Lobby',
      orientation: 'landscape',
      width: 1920,
      height: 1080,
      defaultImageSeconds: 10,
      maxVideoSeconds: null,
    });
    await srv.state.applyPush('lobby', {
      pushId: 'push_1',
      mode: 'replace',
      enabled: true,
      title: 'Welcome',
      items: [{ mediaId: media.sha256, ext: 'png', kind: 'image', seconds: 8 }],
    });

    // Missing auth -> 401
    const unauth = await http(srv.base, '/api/v1/screens', {
      headers: { origin: 'https://canva.example' },
    });
    assert.equal(unauth.status, 401);
    assert.equal(unauth.json.error.code, 'UNAUTHORIZED');
    assert.equal(unauth.headers.get('access-control-allow-origin'), 'https://canva.example');

    // Disallowed brand -> 403
    const badToken = srv.fakeCanva.signToken({ brandId: 'brand-other', aud: 'app-test' });
    const forbidden = await http(srv.base, '/api/v1/screens', {
      headers: { authorization: `Bearer ${badToken}` },
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.json.error.code, 'TEAM_NOT_ALLOWED');

    // Valid Canva token -> 200
    const goodToken = srv.fakeCanva.signToken({ brandId: 'brand-ok', aud: 'app-test' });
    const res = await http(srv.base, '/api/v1/screens', {
      headers: {
        authorization: `Bearer ${goodToken}`,
        origin: 'https://canva.example',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://canva.example');
    assert.deepEqual(res.json, {
      screens: [
        {
          id: 'lobby',
          kind: 'screen',
          name: 'Lobby',
          orientation: 'landscape',
          width: 1920,
          height: 1080,
          defaultImageSeconds: 10,
          maxVideoSeconds: null,
          entryCount: 1,
          enabledEntryCount: 1,
          playlistVersion: 2,
        },
      ],
    });
    assert.equal('entries' in res.json.screens[0], false);
  } finally {
    await srv.close();
  }
});

test('GET /s/:screenId/playlist.json returns prefixed media urls, sha256, no-cache, and 404 on unknown/invalid', async () => {
  const srv = await setupServer({ env: { SISSI_PUBLIC_PATH: '/signage' } });
  try {
    const img = await putTempMedia(srv.storage, 'image-data', 'png', 'image/png');
    const vid = await putTempMedia(srv.storage, 'video-data', 'mp4', 'video/mp4');

    await srv.state.createScreen({
      id: 'hall-1',
      name: 'Hall',
      orientation: 'vertical',
    });
    await srv.state.applyPush('hall-1', {
      pushId: 'push_2',
      mode: 'append',
      enabled: true,
      title: 'Slides',
      items: [
        { mediaId: img.sha256, ext: 'png', kind: 'image', seconds: 12 },
        { mediaId: vid.sha256, ext: 'mp4', kind: 'video', seconds: 30 },
      ],
    });

    const ok = await http(srv.base, '/s/hall-1/playlist.json');
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-cache');
    assert.equal(ok.json.screenId, 'hall-1');
    assert.equal(ok.json.version, 2);
    assert.equal(ok.json.orientation, 'vertical');
    assert.equal(ok.json.entries.length, 2);
    assert.deepEqual(
      ok.json.entries.map(({ kind, url, sha256, seconds }) => ({ kind, url, sha256, seconds })),
      [
        {
          kind: 'image',
          url: `/signage/media/${img.sha256}.png`,
          sha256: img.sha256,
          seconds: 12,
        },
        {
          kind: 'video',
          url: `/signage/media/${vid.sha256}.mp4`,
          sha256: vid.sha256,
          seconds: 30,
        },
      ],
    );
    assert.ok(ok.json.entries[0].entryId);

    // Unknown screen -> 404 SCREEN_NOT_FOUND
    const missing = await http(srv.base, '/s/does-not-exist/playlist.json');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'SCREEN_NOT_FOUND');

    // Invalid screenId characters -> 404 SCREEN_NOT_FOUND (not 500)
    const invalid = await http(srv.base, '/s/BAD_ID!/playlist.json');
    assert.equal(invalid.status, 404);
    assert.equal(invalid.json.error.code, 'SCREEN_NOT_FOUND');
  } finally {
    await srv.close();
  }
});

test('GET /media/:file serves full body, Range 206 variants, 416 out-of-bounds, and 404 missing/invalid', async () => {
  const srv = await setupServer();
  try {
    const payload = '0123456789'; // 10 bytes
    const media = await putTempMedia(srv.storage, payload, 'mp4', 'video/mp4');
    const mediaPath = `/media/${media.sha256}.mp4`;

    // 200 full body + immutable header
    const full = await http(srv.base, mediaPath);
    assert.equal(full.status, 200);
    assert.equal(full.text, payload);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal(full.headers.get('content-length'), '10');
    assert.equal(full.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    // 206 bytes=0-3
    const r1 = await http(srv.base, mediaPath, { headers: { range: 'bytes=0-3' } });
    assert.equal(r1.status, 206);
    assert.equal(r1.text, '0123');
    assert.equal(r1.headers.get('content-range'), 'bytes 0-3/10');
    assert.equal(r1.headers.get('content-length'), '4');
    assert.equal(r1.headers.get('accept-ranges'), 'bytes');
    assert.equal(r1.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    // 206 bytes=4-
    const r2 = await http(srv.base, mediaPath, { headers: { range: 'bytes=4-' } });
    assert.equal(r2.status, 206);
    assert.equal(r2.text, '456789');
    assert.equal(r2.headers.get('content-range'), 'bytes 4-9/10');
    assert.equal(r2.headers.get('content-length'), '6');

    // 206 bytes=-2 (suffix)
    const r3 = await http(srv.base, mediaPath, { headers: { range: 'bytes=-2' } });
    assert.equal(r3.status, 206);
    assert.equal(r3.text, '89');
    assert.equal(r3.headers.get('content-range'), 'bytes 8-9/10');
    assert.equal(r3.headers.get('content-length'), '2');

    // 416 out-of-bounds
    for (const badRange of ['bytes=10-', 'bytes=10-15', 'bytes=5-2', 'bytes=-0', 'bytes=invalid']) {
      const oob = await http(srv.base, mediaPath, { headers: { range: badRange } });
      assert.equal(oob.status, 416, `Expected 416 for ${badRange}`);
      assert.equal(oob.headers.get('content-range'), 'bytes */10');
    }

    // 404 missing file (valid sha256 format)
    const missingSha = 'a'.repeat(64);
    const notFound = await http(srv.base, `/media/${missingSha}.png`);
    assert.equal(notFound.status, 404);
    assert.equal(notFound.json.error.code, 'NOT_FOUND');

    // 404 invalid :file format
    for (const badFile of ['not-a-sha.png', `${'a'.repeat(63)}.png`, `${'g'.repeat(64)}.png`, missingSha]) {
      const bad = await http(srv.base, `/media/${badFile}`);
      assert.equal(bad.status, 404, `Expected 404 for ${badFile}`);
      assert.equal(bad.json.error.code, 'NOT_FOUND');
    }
  } finally {
    await srv.close();
  }
});

test('GET /media/:file maps S3 InvalidRange error from storage.getMedia to 416', async () => {
  const storage = createMemoryStorage();
  const media = await putTempMedia(storage, '0123456789', 'mp4', 'video/mp4');
  const origGetMedia = storage.getMedia.bind(storage);
  storage.getMedia = async (sha256, ext, range) => {
    if (range && (range.start !== undefined || range.end !== undefined)) {
      const err = new Error('RequestedRangeNotSatisfiable');
      err.name = 'InvalidRange';
      err.$metadata = { httpStatusCode: 416 };
      throw err;
    }
    return origGetMedia(sha256, ext, range);
  };

  const srv = await setupServer({ storage });
  try {
    const res = await http(srv.base, `/media/${media.sha256}.mp4`, {
      headers: { range: 'bytes=0-3' },
    });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */10');
  } finally {
    await srv.close();
  }
});
