import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, StateError } from '../../src/state/index.mjs';
import { createMemoryStorage, StorageConflictError } from './memory-storage.mjs';

function makeClock(startIso = '2026-11-19T12:00:00.000Z') {
  let ms = Date.parse(startIso);
  const now = () => new Date(ms);
  now.advanceMs = (delta) => {
    ms += delta;
  };
  return now;
}

function makeSeqId() {
  let i = 0;
  return () => String(++i);
}

test('screens CRUD and validation', async () => {
  const storage = createMemoryStorage();
  const state = createState(storage, { now: makeClock(), idGen: makeSeqId() });

  const s1 = await state.createScreen({
    id: 'lobby',
    name: 'Lobby',
    orientation: 'landscape',
    width: 1920,
    height: 1080,
  });
  assert.equal(s1.id, 'lobby');
  assert.equal(s1.defaultImageSeconds, 10);
  assert.equal(s1.maxVideoSeconds, null);
  assert.equal(s1.entryCount, 0);
  assert.equal(s1.playlistVersion, 1);

  await assert.rejects(
    () => state.createScreen({ id: 'lobby', name: 'Dup' }),
    (err) => err instanceof StateError && err.code === 'SCREEN_EXISTS',
  );

  await assert.rejects(
    () => state.createScreen({ id: 'BAD_ID!', name: 'Bad' }),
    (err) => err instanceof StateError && err.code === 'INVALID_SCREEN',
  );
  await assert.rejects(
    () => state.createScreen({ id: 'hall', name: '   ' }),
    (err) => err instanceof StateError && err.code === 'INVALID_SCREEN',
  );
  await assert.rejects(
    () => state.createScreen({ id: 'hall', name: 'Hall', orientation: 'diagonal' }),
    (err) => err instanceof StateError && err.code === 'INVALID_SCREEN',
  );
  await assert.rejects(
    () => state.createScreen({ id: 'hall', name: 'Hall', defaultImageSeconds: 0 }),
    (err) => err instanceof StateError && err.code === 'INVALID_SECONDS',
  );
  await assert.rejects(
    () => state.createScreen({ id: 'hall', name: 'Hall', defaultImageSeconds: 3601 }),
    (err) => err instanceof StateError && err.code === 'INVALID_SECONDS',
  );

  await state.createScreen({ id: 'chapel', name: 'Chapel', orientation: 'vertical', defaultImageSeconds: 15 });
  const list = await state.listScreens();
  assert.deepEqual(
    list.map((s) => s.id),
    ['chapel', 'lobby'],
  );

  const updated = await state.updateScreen('lobby', { name: 'Main Lobby', maxVideoSeconds: 120 });
  assert.equal(updated.name, 'Main Lobby');
  assert.equal(updated.maxVideoSeconds, 120);
  assert.equal(updated.playlistVersion, 2);

  await assert.rejects(
    () => state.updateScreen('lobby', { id: 'other' }),
    (err) => err instanceof StateError && err.code === 'INVALID_SCREEN',
  );

  const fetched = await state.getScreen('lobby');
  assert.equal(fetched.name, 'Main Lobby');

  await state.deleteScreen('chapel');
  await assert.rejects(
    () => state.getScreen('chapel'),
    (err) => err instanceof StateError && err.code === 'SCREEN_NOT_FOUND',
  );
  await assert.rejects(
    () => state.deleteScreen('chapel'),
    (err) => err instanceof StateError && err.code === 'SCREEN_NOT_FOUND',
  );
});

test('concurrent mutations on one screen serialize', async () => {
  const storage = createMemoryStorage();
  const state = createState(storage, { now: makeClock(), idGen: makeSeqId() });
  await state.createScreen({ id: 'lobby', name: 'Lobby' });

  const count = 10;
  await Promise.all(
    Array.from({ length: count }, (_, idx) =>
      state.mutateScreen('lobby', async (doc) => {
        const before = doc.entries.length;
        await new Promise((r) => setTimeout(r, (count - idx) * 2));
        doc.entries.push({
          entryId: `e_${idx}`,
          mediaId: 'a'.repeat(64),
          ext: 'png',
          kind: 'image',
          seconds: 10,
          title: `Slide ${before}`,
          pushId: 'p1',
          addedAt: '2026-11-19T12:00:00.000Z',
        });
      }),
    ),
  );

  const screen = await state.getScreen('lobby');
  assert.equal(screen.entryCount, count);
  assert.equal(screen.playlistVersion, 1 + count);
  assert.deepEqual(
    screen.entries.map((e) => e.title),
    Array.from({ length: count }, (_, i) => `Slide ${i}`),
  );
});

test('CAS conflict retries once then throws BUSY', async () => {
  const baseStorage = createMemoryStorage();
  let failPutCount = 0;
  const storage = {
    ...baseStorage,
    async putJson(key, value, opts) {
      if (failPutCount > 0 && opts?.ifMatch !== undefined && opts?.ifMatch !== null) {
        failPutCount--;
        throw new StorageConflictError('Simulated external CAS conflict');
      }
      return baseStorage.putJson(key, value, opts);
    },
  };

  const state = createState(storage, { now: makeClock(), idGen: makeSeqId() });
  await state.createScreen({ id: 'lobby', name: 'Lobby' });

  // 1 conflict -> retry succeeds
  failPutCount = 1;
  const ok = await state.updateScreen('lobby', { name: 'Retried' });
  assert.equal(ok.name, 'Retried');
  assert.equal(ok.playlistVersion, 2);

  // 2 consecutive conflicts -> throws BUSY
  failPutCount = 2;
  await assert.rejects(
    () => state.updateScreen('lobby', { name: 'ShouldFail' }),
    (err) => err instanceof StateError && err.code === 'BUSY',
  );
  const after = await state.getScreen('lobby');
  assert.equal(after.name, 'Retried');
  assert.equal(after.playlistVersion, 2);
});

test('applyPush append and replace, entry ids unique, replace keeps nothing of old playlist', async () => {
  const storage = createMemoryStorage();
  const state = createState(storage, { now: makeClock(), idGen: makeSeqId() });
  await state.createScreen({ id: 'lobby', name: 'Lobby', defaultImageSeconds: 12 });

  const r1 = await state.applyPush('lobby', {
    pushId: 'push_1',
    mode: 'append',
    title: 'First',
    items: [
      { mediaId: '1'.repeat(64), ext: 'png', kind: 'image' },
      { mediaId: '2'.repeat(64), ext: 'mp4', kind: 'video', seconds: 25.4 },
    ],
  });
  assert.equal(r1.playlistVersion, 2);

  const p1 = await state.getPlaylist('lobby');
  assert.equal(p1.version, 2);
  assert.equal(p1.entries.length, 2);
  assert.equal(p1.entries[0].seconds, 12); // screen defaultImageSeconds
  assert.equal(p1.entries[1].seconds, 25);
  assert.notEqual(p1.entries[0].entryId, p1.entries[1].entryId);

  const r2 = await state.applyPush('lobby', {
    pushId: 'push_2',
    mode: 'append',
    title: 'Second',
    items: [{ mediaId: '3'.repeat(64), ext: 'jpg', kind: 'image', seconds: 5 }],
  });
  assert.equal(r2.playlistVersion, 3);
  assert.equal((await state.getPlaylist('lobby')).entries.length, 3);

  const r3 = await state.applyPush('lobby', {
    pushId: 'push_3',
    mode: 'replace',
    title: 'Replacement',
    items: [{ mediaId: '4'.repeat(64), ext: 'webp', kind: 'image', seconds: 8 }],
  });
  assert.equal(r3.playlistVersion, 4);
  const p3 = await state.getPlaylist('lobby');
  assert.equal(p3.entries.length, 1);
  assert.equal(p3.entries[0].pushId, 'push_3');
  assert.equal(p3.entries[0].mediaId, '4'.repeat(64));

  await assert.rejects(
    () => state.applyPush('lobby', { pushId: 'p', mode: 'bogus', title: 'X', items: [{ mediaId: 'a', ext: 'png', kind: 'image' }] }),
    (err) => err instanceof StateError && err.code === 'INVALID_MODE',
  );
  await assert.rejects(
    () => state.applyPush('lobby', { pushId: 'p', mode: 'append', title: '', items: [{ mediaId: 'a', ext: 'png', kind: 'image' }] }),
    (err) => err instanceof StateError && err.code === 'INVALID_TITLE',
  );
  await assert.rejects(
    () => state.applyPush('lobby', { pushId: 'p', mode: 'append', title: 'Ok', items: [] }),
    (err) => err instanceof StateError && err.code === 'INVALID_PAGES',
  );
});

test('removeEntry, reorderEntries, setEntrySeconds, removePush', async () => {
  const storage = createMemoryStorage();
  const state = createState(storage, { now: makeClock(), idGen: makeSeqId() });
  await state.createScreen({ id: 'lobby', name: 'Lobby' });

  await state.applyPush('lobby', {
    pushId: 'push_a',
    mode: 'append',
    title: 'A',
    items: [
      { mediaId: '1'.repeat(64), ext: 'png', kind: 'image', seconds: 5 },
      { mediaId: '2'.repeat(64), ext: 'mp4', kind: 'video', seconds: 30 },
    ],
  });
  await state.applyPush('lobby', {
    pushId: 'push_b',
    mode: 'append',
    title: 'B',
    items: [{ mediaId: '3'.repeat(64), ext: 'png', kind: 'image', seconds: 7 }],
  });

  const pl = await state.getPlaylist('lobby');
  const [e1, e2, e3] = pl.entries.map((e) => e.entryId);

  // reorderEntries requires permutation
  await assert.rejects(
    () => state.reorderEntries('lobby', [e1, e2]),
    (err) => err instanceof StateError && err.code === 'INVALID_PAGES',
  );
  await assert.rejects(
    () => state.reorderEntries('lobby', [e1, e1, e3]),
    (err) => err instanceof StateError && err.code === 'INVALID_PAGES',
  );
  await assert.rejects(
    () => state.reorderEntries('lobby', [e1, e2, 'missing']),
    (err) => err instanceof StateError && err.code === 'INVALID_PAGES',
  );

  const reordered = await state.reorderEntries('lobby', [e3, e1, e2]);
  assert.deepEqual(
    reordered.entries.map((e) => e.entryId),
    [e3, e1, e2],
  );

  // setEntrySeconds: images only, 1-3600
  await state.setEntrySeconds('lobby', e1, 20);
  assert.equal((await state.getPlaylist('lobby')).entries.find((e) => e.entryId === e1).seconds, 20);

  await assert.rejects(
    () => state.setEntrySeconds('lobby', e2, 10),
    (err) => err instanceof StateError && err.code === 'INVALID_KIND',
  );
  await assert.rejects(
    () => state.setEntrySeconds('lobby', e1, 0),
    (err) => err instanceof StateError && err.code === 'INVALID_SECONDS',
  );
  await assert.rejects(
    () => state.setEntrySeconds('lobby', e1, 3601),
    (err) => err instanceof StateError && err.code === 'INVALID_SECONDS',
  );
  await assert.rejects(
    () => state.setEntrySeconds('lobby', 'nope', 10),
    (err) => err instanceof StateError && err.code === 'ENTRY_NOT_FOUND',
  );

  // removeEntry
  await state.removeEntry('lobby', e3);
  assert.equal((await state.getPlaylist('lobby')).entries.length, 2);
  await assert.rejects(
    () => state.removeEntry('lobby', e3),
    (err) => err instanceof StateError && err.code === 'ENTRY_NOT_FOUND',
  );

  // removePush
  await state.removePush('lobby', 'push_a');
  assert.equal((await state.getPlaylist('lobby')).entries.length, 0);
  await assert.rejects(
    () => state.removePush('lobby', 'push_a'),
    (err) => err instanceof StateError && err.code === 'PUSH_NOT_FOUND',
  );
});

test('push records: create, update, get, sweepPushes, markInterruptedOnStart', async () => {
  const storage = createMemoryStorage();
  const clock = makeClock('2026-11-19T00:00:00.000Z');
  const state = createState(storage, { now: clock, idGen: makeSeqId() });

  const p1 = await state.createPush({ pushId: 'p_queued', screenId: 'lobby', pagesTotal: 3 });
  const p2 = await state.createPush({ pushId: 'p_dl', screenId: 'lobby', pagesTotal: 2 });
  await state.updatePush('p_dl', { state: 'downloading', progress: 0.5, pages: { done: 1, total: 2 } });

  const p3 = await state.createPush({ pushId: 'p_ready', screenId: 'lobby', pagesTotal: 1 });
  await state.updatePush('p_ready', { state: 'ready', progress: 1, pages: { done: 1, total: 1 }, playlistVersion: 4 });

  assert.equal(p1.state, 'queued');
  assert.equal((await state.getPush('p_dl')).progress, 0.5);
  await assert.rejects(
    () => state.getPush('missing'),
    (err) => err instanceof StateError && err.code === 'PUSH_NOT_FOUND',
  );

  // markInterruptedOnStart marks queued and downloading as failed INTERRUPTED, leaves ready untouched
  const { marked } = await state.markInterruptedOnStart();
  assert.equal(marked, 2);

  const p1After = await state.getPush('p_queued');
  assert.equal(p1After.state, 'failed');
  assert.equal(p1After.error.code, 'INTERRUPTED');

  const p2After = await state.getPush('p_dl');
  assert.equal(p2After.state, 'failed');
  assert.equal(p2After.error.code, 'INTERRUPTED');

  const p3After = await state.getPush('p_ready');
  assert.equal(p3After.state, 'ready');
  assert.equal(p3After.playlistVersion, 4);

  // Advance 23 hours: nothing swept for 24h retention
  clock.advanceMs(23 * 3600 * 1000);
  const p4 = await state.createPush({ pushId: 'p_fresh', screenId: 'lobby', pagesTotal: 1 });
  assert.equal(p4.pushId, 'p_fresh');
  assert.equal((await state.sweepPushes({ retentionHours: 24 })).deleted, 0);

  // Advance 2 more hours (total 25h for p1..p3, 2h for p4)
  clock.advanceMs(2 * 3600 * 1000);
  const { deleted } = await state.sweepPushes({ retentionHours: 24 });
  assert.equal(deleted, 3);
  assert.equal((await state.getPush('p_fresh')).pushId, 'p_fresh');
  await assert.rejects(
    () => state.getPush('p_ready'),
    (err) => err instanceof StateError && err.code === 'PUSH_NOT_FOUND',
  );
});

test('referencedMedia and gcSweep respect references and grace period', async () => {
  const storage = createMemoryStorage();
  const clock = makeClock('2026-11-19T12:00:00.000Z');
  const state = createState(storage, { now: clock, idGen: makeSeqId() });

  await state.createScreen({ id: 'lobby', name: 'Lobby' });
  const refSha = 'a'.repeat(64);
  const oldUnrefSha = 'b'.repeat(64);
  const youngUnrefSha = 'c'.repeat(64);

  await state.applyPush('lobby', {
    pushId: 'p1',
    mode: 'append',
    title: 'Active',
    items: [{ mediaId: refSha, ext: 'png', kind: 'image' }],
  });

  // Seed media:
  // 1) referenced, very old (120 min ago) -> MUST NOT be deleted
  // 2) unreferenced, old (90 min ago) -> MUST be deleted (grace 60 min)
  // 3) unreferenced, young (30 min ago) -> MUST NOT be deleted (grace 60 min)
  const nowMs = clock().getTime();
  storage.seedMedia(refSha, 'png', { lastModified: new Date(nowMs - 120 * 60 * 1000) });
  storage.seedMedia(oldUnrefSha, 'png', { lastModified: new Date(nowMs - 90 * 60 * 1000) });
  storage.seedMedia(youngUnrefSha, 'mp4', { lastModified: new Date(nowMs - 30 * 60 * 1000) });

  const refs = await state.referencedMedia();
  assert.deepEqual([...refs], [`${refSha}.png`]);

  const res = await state.gcSweep(storage, { graceMinutes: 60, now: clock });
  assert.equal(res.deleted, 1);

  assert.ok(await storage.statMedia(refSha, 'png'));
  assert.equal(await storage.statMedia(oldUnrefSha, 'png'), null);
  assert.ok(await storage.statMedia(youngUnrefSha, 'mp4'));
});
