import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createMemoryStorage } from '../../src/storage/index.mjs';
import { createState } from '../../src/state/index.mjs';
import { createAuth, testing } from '../../src/auth/index.mjs';
import { registerViewRoutes } from '../../src/api/views.mjs';
import { registerReadRoutes } from '../../src/api/read.mjs';
import { generateVariants, getOrGenerateVariant } from '../../src/media/variants.mjs';
import { startTestServer, http, testConfig } from '../helpers/server.mjs';

async function createTestImage(width = 1200, height = 800) {
  return await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 50, g: 100, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

async function setup() {
  const storage = createMemoryStorage();
  const state = createState(storage);
  const fakeCanva = testing.createFakeCanva({});
  const auth = createAuth(testConfig({}), { fetch: fakeCanva.jwksFetch });
  const srv = await startTestServer({}, { storage, state, auth });
  registerViewRoutes(srv.ctx.router, srv.ctx);
  registerReadRoutes(srv.ctx.router, srv.ctx);
  return { ...srv, state, storage };
}

test('generateVariants generates downscaled WebP variants in storage', async () => {
  const storage = createMemoryStorage();
  const imgBuf = await createTestImage(1200, 800);
  const sha256 = crypto.createHash('sha256').update(imgBuf).digest('hex');

  const tmpPath = path.join(os.tmpdir(), `test-img-${sha256}.png`);
  await fs.writeFile(tmpPath, imgBuf);
  try {
    await storage.putMediaFromFile(sha256, 'png', tmpPath, 'image/png');
    const res = await generateVariants(imgBuf, sha256, storage);

    assert.equal(res.width, 1200);
    assert.equal(res.height, 800);
    // 1200px width should generate 480w, 720w, 1080w variants (all < 1200)
    assert.equal(res.variants.length, 3);
    assert.deepEqual(res.variants.map((v) => v.width), [480, 720, 1080]);
    assert.deepEqual(res.variants.map((v) => v.ext), ['webp', 'webp', 'webp']);

    // Check each variant exists in storage and has correct dimensions
    for (const v of res.variants) {
      const stored = await storage.getMedia(v.mediaId, 'webp');
      assert.ok(stored, `Variant ${v.mediaId} should be in storage`);
      const chunks = [];
      for await (const c of stored.stream) chunks.push(c);
      const vBuf = Buffer.concat(chunks);
      const vMeta = await sharp(vBuf).metadata();
      assert.equal(vMeta.format, 'webp');
      assert.equal(vMeta.width, v.width);
    }
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
});

test('HTTP GET /media/:file serves on-demand generated WebP variants', async () => {
  const s = await setup();
  try {
    const imgBuf = await createTestImage(1200, 800);
    const sha256 = crypto.createHash('sha256').update(imgBuf).digest('hex');
    const tmpPath = path.join(os.tmpdir(), `test-srv-${sha256}.png`);
    await fs.writeFile(tmpPath, imgBuf);
    try {
      await s.storage.putMediaFromFile(sha256, 'png', tmpPath, 'image/png');
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }

    // Request on-demand 480w variant that was not pre-generated
    const res480 = await fetch(`${s.base}/media/${sha256}-480w.webp`);
    assert.equal(res480.status, 200);
    assert.equal(res480.headers.get('content-type'), 'image/webp');
    assert.equal(res480.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    const meta480 = await sharp(Buffer.from(await res480.arrayBuffer())).metadata();
    assert.equal(meta480.format, 'webp');
    assert.equal(meta480.width, 480);
    assert.equal(meta480.height, 320); // 1200x800 aspect ratio 3:2 -> 480x320

    // Request on-demand 720w variant
    const res720 = await fetch(`${s.base}/media/${sha256}-720w.webp`);
    assert.equal(res720.status, 200);
    const meta720 = await sharp(Buffer.from(await res720.arrayBuffer())).metadata();
    assert.equal(meta720.width, 720);
    assert.equal(meta720.height, 480);
  } finally {
    await s.close();
  }
});

test('view playlist includes srcset, sizes, and variants for image entries', async () => {
  const s = await setup();
  try {
    await s.state.createScreen({ id: 'u1', name: 'Uutiset', kind: 'view', embed: { allowedOrigins: ['https://seurakunta.example'] } });
    const imgBuf = await createTestImage(1600, 900);
    const sha256 = crypto.createHash('sha256').update(imgBuf).digest('hex');

    const tmpPath = path.join(os.tmpdir(), `test-view-${sha256}.png`);
    await fs.writeFile(tmpPath, imgBuf);
    let varRes;
    try {
      await s.storage.putMediaFromFile(sha256, 'png', tmpPath, 'image/png');
      varRes = await generateVariants(imgBuf, sha256, s.storage);
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }

    await s.state.applyPush('u1', {
      pushId: 'p1',
      title: 'Tapahtuma',
      enabled: true,
      mode: 'replace',
      items: [
        {
          kind: 'image',
          mediaId: sha256,
          ext: 'png',
          width: varRes.width,
          height: varRes.height,
          variants: varRes.variants,
          seconds: 10,
        },
      ],
    });

    const res = await http(s.base, '/v/u1/playlist.json');
    assert.equal(res.status, 200);
    assert.equal(res.json.entries.length, 1);
    const entry = res.json.entries[0];

    assert.equal(entry.width, 1600);
    assert.equal(entry.height, 900);
    assert.ok(entry.srcset, 'entry should have srcset');
    assert.ok(entry.srcset.includes(`${sha256}-480w.webp 480w`));
    assert.ok(entry.srcset.includes(`${sha256}-720w.webp 720w`));
    assert.ok(entry.srcset.includes(`${sha256}-1080w.webp 1080w`));
    assert.ok(entry.srcset.includes(`${sha256}-1440w.webp 1440w`));
    assert.ok(entry.srcset.includes(`${entry.url} 1600w`));
    assert.ok(entry.sizes, 'entry should have sizes attribute');
    assert.equal(entry.variants.length, 4);
  } finally {
    await s.close();
  }
});

test('gcSweep protects variants of referenced parent images', async () => {
  const s = await setup();
  try {
    await s.state.createScreen({ id: 's1', name: 'Screen 1', kind: 'view' });
    const imgBuf = await createTestImage(1000, 600);
    const sha256 = crypto.createHash('sha256').update(imgBuf).digest('hex');

    const tmpPath = path.join(os.tmpdir(), `test-gc-${sha256}.png`);
    await fs.writeFile(tmpPath, imgBuf);
    try {
      await s.storage.putMediaFromFile(sha256, 'png', tmpPath, 'image/png');
      await generateVariants(imgBuf, sha256, s.storage);
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }

    await s.state.applyPush('s1', {
      pushId: 'p1',
      title: 'Post',
      enabled: true,
      items: [{ kind: 'image', mediaId: sha256, ext: 'png' }],
    });

    // Run gcSweep with now far in the future
    const sweep = await s.state.gcSweep({ graceMinutes: 0, now: () => Date.now() + 1000000 });
    assert.equal(sweep.deleted, 0, 'No media or variants should be deleted while parent is referenced');

    // Remove entry from screen
    const screen = await s.state.getScreen('s1');
    await s.state.removeEntry('s1', screen.entries[0].entryId);

    // Run gcSweep again
    const sweep2 = await s.state.gcSweep({ graceMinutes: 0, now: () => Date.now() + 1000000 });
    assert.ok(sweep2.deleted > 0, 'Unreferenced media and variants should be cleaned up');
  } finally {
    await s.close();
  }
});
