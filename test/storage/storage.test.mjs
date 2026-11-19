import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { StorageConflictError, createMemoryStorage, createStorage } from '../../src/storage/index.mjs';
import { startFakeS3 } from './fake-s3.mjs';

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runContractSuite(name, makeStorage) {
  test(`storage contract [${name}]: media put/stat/get/range/list/delete`, async (t) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sissi-storage-test-'));
    const { storage, cleanup } = await makeStorage(tmpDir);
    t.after(async () => {
      if (cleanup) await cleanup();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    const data1 = Buffer.from('0123456789abcdef', 'utf8');
    const hash1 = sha256(data1);
    const file1 = path.join(tmpDir, 'sample1.png');
    await fs.writeFile(file1, data1);

    assert.equal(await storage.statMedia(hash1, 'png'), null);
    assert.equal(await storage.getMedia(hash1, 'png'), null);

    const put1 = await storage.putMediaFromFile(hash1, 'png', file1, 'image/png');
    assert.deepEqual(put1, { key: `media/${hash1}.png`, size: data1.length });

    // Idempotent second put
    const put1Again = await storage.putMediaFromFile(hash1, 'png', file1, 'image/png');
    assert.deepEqual(put1Again, { key: `media/${hash1}.png`, size: data1.length });

    const stat1 = await storage.statMedia(hash1, 'png');
    assert.equal(stat1.size, data1.length);
    assert.equal(stat1.contentType, 'image/png');
    assert.ok(stat1.lastModified instanceof Date);

    // Full get
    const full = await storage.getMedia(hash1, 'png');
    assert.equal(full.size, data1.length);
    assert.equal(full.contentType, 'image/png');
    assert.equal(full.start, 0);
    assert.equal(full.end, data1.length - 1);
    assert.deepEqual(await readStream(full.stream), data1);

    // Range: start + end
    const r1 = await storage.getMedia(hash1, 'png', { start: 2, end: 5 });
    assert.equal(r1.size, data1.length);
    assert.equal(r1.start, 2);
    assert.equal(r1.end, 5);
    assert.deepEqual(await readStream(r1.stream), data1.subarray(2, 6));

    // Range: start only
    const r2 = await storage.getMedia(hash1, 'png', { start: 10 });
    assert.equal(r2.start, 10);
    assert.equal(r2.end, 15);
    assert.deepEqual(await readStream(r2.stream), data1.subarray(10));

    // Range: end only, and clamped end beyond EOF
    const r3 = await storage.getMedia(hash1, 'png', { end: 3 });
    assert.equal(r3.start, 0);
    assert.equal(r3.end, 3);
    assert.deepEqual(await readStream(r3.stream), data1.subarray(0, 4));

    const r4 = await storage.getMedia(hash1, 'png', { start: 12, end: 999 });
    assert.equal(r4.start, 12);
    assert.equal(r4.end, 15);
    assert.deepEqual(await readStream(r4.stream), data1.subarray(12));

    await assert.rejects(() => storage.getMedia(hash1, 'png', { start: -1 }), RangeError);
    await assert.rejects(() => storage.getMedia(hash1, 'png', { start: 5, end: 2 }), RangeError);

    // Put 2 more media items to exercise pagination (>2 items with fake-s3 maxKeys=2)
    const data2 = Buffer.from('video-bytes', 'utf8');
    const hash2 = sha256(data2);
    const file2 = path.join(tmpDir, 'sample2.mp4');
    await fs.writeFile(file2, data2);
    await storage.putMediaFromFile(hash2, 'mp4', file2, 'video/mp4');

    const data3 = Buffer.from('third-image', 'utf8');
    const hash3 = sha256(data3);
    const file3 = path.join(tmpDir, 'sample3.jpg');
    await fs.writeFile(file3, data3);
    await storage.putMediaFromFile(hash3, 'jpg', file3, 'image/jpeg');

    const listed = [];
    for await (const item of storage.listMedia()) {
      listed.push(item);
    }
    assert.equal(listed.length, 3);
    const byKey = new Map(listed.map((i) => [`${i.sha256}.${i.ext}`, i]));
    assert.equal(byKey.get(`${hash1}.png`).size, data1.length);
    assert.equal(byKey.get(`${hash2}.mp4`).size, data2.length);
    assert.equal(byKey.get(`${hash3}.jpg`).size, data3.length);
    assert.ok(byKey.get(`${hash1}.png`).lastModified instanceof Date);

    await storage.deleteMedia(hash1, 'png');
    assert.equal(await storage.statMedia(hash1, 'png'), null);
    assert.equal(await storage.getMedia(hash1, 'png'), null);
    // Idempotent delete
    await storage.deleteMedia(hash1, 'png');
  });

  test(`storage contract [${name}]: json get/put/ifMatch/list/delete & path traversal`, async (t) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sissi-storage-json-'));
    const { storage, cleanup } = await makeStorage(tmpDir);
    t.after(async () => {
      if (cleanup) await cleanup();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    assert.equal(await storage.getJson('state/screens/lobby.json'), null);

    // ifMatch with string on missing key must conflict
    await assert.rejects(
      () => storage.putJson('state/screens/lobby.json', { a: 1 }, { ifMatch: 'nope' }),
      StorageConflictError,
    );

    // ifMatch: null creates when missing
    const { etag: e1 } = await storage.putJson('state/screens/lobby.json', { version: 1 }, { ifMatch: null });
    assert.ok(typeof e1 === 'string' && e1.length > 0);

    // ifMatch: null conflicts when already exists
    await assert.rejects(
      () => storage.putJson('state/screens/lobby.json', { version: 2 }, { ifMatch: null }),
      StorageConflictError,
    );

    // getJson returns value and matching etag
    const got1 = await storage.getJson('state/screens/lobby.json');
    assert.deepEqual(got1.value, { version: 1 });
    assert.equal(got1.etag, e1);

    // Wrong etag conflicts
    await assert.rejects(
      () => storage.putJson('state/screens/lobby.json', { version: 2 }, { ifMatch: 'wrong-etag' }),
      StorageConflictError,
    );

    // Matching etag succeeds and advances etag
    const { etag: e2 } = await storage.putJson('state/screens/lobby.json', { version: 2 }, { ifMatch: e1 });
    assert.notEqual(e2, e1);

    // Stale etag conflicts
    await assert.rejects(
      () => storage.putJson('state/screens/lobby.json', { version: 3 }, { ifMatch: e1 }),
      StorageConflictError,
    );

    // Unconditional overwrite
    const { etag: e3 } = await storage.putJson('state/screens/lobby.json', { version: 3 });
    assert.notEqual(e3, e2);

    // Multiple keys for listJson (tests pagination on S3 with maxKeys=2)
    await storage.putJson('state/screens/cafe.json', { id: 'cafe' });
    await storage.putJson('state/screens/hall.json', { id: 'hall' });
    await storage.putJson('state/pushes/p1.json', { id: 'p1' });

    assert.deepEqual(await storage.listJson('state/screens/'), [
      'state/screens/cafe.json',
      'state/screens/hall.json',
      'state/screens/lobby.json',
    ]);
    assert.deepEqual(await storage.listJson('state/pushes/'), ['state/pushes/p1.json']);
    assert.deepEqual(await storage.listJson(''), [
      'state/pushes/p1.json',
      'state/screens/cafe.json',
      'state/screens/hall.json',
      'state/screens/lobby.json',
    ]);

    await storage.deleteJson('state/screens/lobby.json');
    assert.equal(await storage.getJson('state/screens/lobby.json'), null);
    await storage.deleteJson('state/screens/lobby.json');

    // Path traversal & invalid keys rejected
    for (const bad of ['../secret.json', 'state/../../secret.json', '/abs.json', 'a\\b.json', 'a//b.json', '']) {
      await assert.rejects(() => storage.getJson(bad));
      await assert.rejects(() => storage.putJson(bad, {}));
      await assert.rejects(() => storage.deleteJson(bad));
    }
    for (const badPrefix of ['../', 'state/../', '/abs', 'a\\b']) {
      await assert.rejects(() => storage.listJson(badPrefix));
    }
    await assert.rejects(() => storage.getMedia('../x', 'png'));
    await assert.rejects(() => storage.getMedia('abc', 'png/../../x'));
  });
}

runContractSuite('memory', async () => ({
  storage: createMemoryStorage(),
}));

runContractSuite('local', async (tmpDir) => ({
  storage: createStorage({ kind: 'local', localDir: path.join(tmpDir, 'store') }),
}));

runContractSuite('s3', async () => {
  const s3 = await startFakeS3({ maxKeys: 2 });
  const storage = createStorage({
    kind: 's3',
    s3: {
      endpoint: s3.url,
      region: 'us-east-1',
      bucket: 'test-bucket',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      forcePathStyle: true,
      prefix: 'sissi-prefix/',
    },
  });
  return { storage, cleanup: s3.close };
});

test('local storage: sha256 ETag, no leftover tmp files, concurrent CAS', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sissi-local-cas-'));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const storage = createStorage({ kind: 'local', localDir: tmpDir });
  const { etag } = await storage.putJson('state/screens/s1.json', { count: 0 }, { ifMatch: null });
  const expectedEtag = sha256(Buffer.from(JSON.stringify({ count: 0 }), 'utf8'));
  assert.equal(etag, expectedEtag);

  // Concurrent CAS updates: exactly one wins, the rest throw StorageConflictError
  const results = await Promise.allSettled(
    [1, 2, 3, 4].map((n) => storage.putJson('state/screens/s1.json', { count: n }, { ifMatch: etag })),
  );
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 3);
  for (const r of rejected) assert.ok(r.reason instanceof StorageConflictError);

  const files = await fs.readdir(path.join(tmpDir, 'state/screens'));
  assert.deepEqual(files, ['s1.json']);
});

test('createStorage rejects unknown kind', () => {
  assert.throws(() => createStorage({ kind: 'gcs' }), /Unknown storage kind/);
});
