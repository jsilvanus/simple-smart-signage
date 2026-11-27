import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../../src/storage/index.mjs';
import { createState } from '../../src/state/index.mjs';
import { createAuth, testing } from '../../src/auth/index.mjs';
import { registerViewRoutes } from '../../src/api/views.mjs';
import { registerReadRoutes } from '../../src/api/read.mjs';
import { startTestServer, http, testConfig } from '../helpers/server.mjs';

const T0 = Date.parse('2026-06-01T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const H = 3600 * 1000;

function item(mediaId, extra = {}) {
  return { kind: 'image', mediaId, ext: 'png', seconds: 5, ...extra };
}

function makeState(clock) {
  return createState(createMemoryStorage(), { now: () => new Date(clock.t) });
}

test('an entry is live only inside its start/end window; null limits are open', async () => {
  const clock = { t: T0 };
  const state = makeState(clock);
  await state.createScreen({ id: 's1', name: 'S1' });
  await state.applyPush('s1', {
    pushId: 'p1', title: 'T', mode: 'replace', enabled: true,
    items: [
      item('open'),
      item('future', { startDatetime: iso(T0 + H) }),
      item('past', { endDatetime: iso(T0 - H) }),
      item('now', { startDatetime: iso(T0 - H), endDatetime: iso(T0 + 2 * H) }),
    ],
  });

  let pl = await state.getPlaylist('s1');
  assert.deepEqual(pl.entries.map((e) => e.mediaId), ['open', 'now']);
  assert.equal(pl.nextChangeAt, iso(T0 + H), 'the next boundary is the future entry going live');

  clock.t = T0 + H; // start is inclusive
  pl = await state.getPlaylist('s1');
  assert.deepEqual(pl.entries.map((e) => e.mediaId), ['open', 'future', 'now']);
  assert.equal(pl.nextChangeAt, iso(T0 + 2 * H));

  clock.t = T0 + 2 * H; // end is exclusive
  pl = await state.getPlaylist('s1');
  assert.deepEqual(pl.entries.map((e) => e.mediaId), ['open', 'future']);
  assert.equal(pl.nextChangeAt, null);
});

test('the playlist version moves when time changes the live set, and is plain when nothing is scheduled', async () => {
  const clock = { t: T0 };
  const state = makeState(clock);
  await state.createScreen({ id: 's1', name: 'S1' });
  await state.createScreen({ id: 's2', name: 'S2' });
  await state.applyPush('s1', { pushId: 'p', title: 'T', enabled: true, items: [item('a', { endDatetime: iso(T0 + H) })] });
  await state.applyPush('s2', { pushId: 'p', title: 'T', enabled: true, items: [item('a')] });

  const before = (await state.getPlaylist('s1')).version;
  clock.t = T0 + 2 * H;
  const after = (await state.getPlaylist('s1')).version;
  assert.notEqual(before, after);
  assert.equal((await state.getPlaylist('s2')).version, (await state.getScreen('s2')).playlistVersion);
});

test('disabled entries stay out of the playlist even inside their window', async () => {
  const clock = { t: T0 };
  const state = makeState(clock);
  await state.createScreen({ id: 's1', name: 'S1' });
  await state.applyPush('s1', { pushId: 'p', title: 'T', enabled: false, items: [item('a', { startDatetime: iso(T0 - H) })] });
  const pl = await state.getPlaylist('s1');
  assert.equal(pl.entries.length, 0);
  assert.equal(pl.nextChangeAt, null);
});

test('setEntrySchedule validates, patches single keys and clears with null', async () => {
  const clock = { t: T0 };
  const state = makeState(clock);
  await state.createScreen({ id: 's1', name: 'S1' });
  await state.applyPush('s1', { pushId: 'p', title: 'T', enabled: true, items: [item('a')] });
  const { entries } = await state.getScreen('s1');
  const id = entries[0].entryId;

  await assert.rejects(() => state.setEntrySchedule('s1', id, { startDatetime: 'tomorrow' }), (e) => e.code === 'INVALID_SCHEDULE');
  await assert.rejects(() => state.setEntrySchedule('s1', id, { startDatetime: '2026-06-01T12:00:00' }), (e) => e.code === 'INVALID_SCHEDULE', 'an offset is required');
  await assert.rejects(
    () => state.setEntrySchedule('s1', id, { startDatetime: iso(T0 + H), endDatetime: iso(T0) }),
    (e) => e.code === 'INVALID_SCHEDULE',
  );

  await state.setEntrySchedule('s1', id, { startDatetime: '2026-06-01T15:00:00+03:00' });
  let e = (await state.getScreen('s1')).entries[0];
  assert.equal(e.startDatetime, '2026-06-01T12:00:00.000Z', 'normalised to UTC');
  assert.equal(e.endDatetime, null);

  await assert.rejects(() => state.setEntrySchedule('s1', id, { endDatetime: iso(T0 - H) }), (err) => err.code === 'INVALID_SCHEDULE', 'end must be after the stored start');

  await state.setEntrySchedule('s1', id, { startDatetime: null });
  e = (await state.getScreen('s1')).entries[0];
  assert.equal(e.startDatetime, null);
});

test('removeExpiredEntries removes ended entries, enabled or not, and keeps the rest', async () => {
  const clock = { t: T0 };
  const state = makeState(clock);
  await state.createScreen({ id: 's1', name: 'S1' });
  await state.applyPush('s1', { pushId: 'p1', title: 'T', enabled: true, items: [item('ended-on', { endDatetime: iso(T0 - H) }), item('keep'), item('later', { endDatetime: iso(T0 + H) })] });
  await state.applyPush('s1', { pushId: 'p2', title: 'T', enabled: false, items: [item('ended-off', { endDatetime: iso(T0) })] });

  const { screen, removed } = await state.removeExpiredEntries('s1');
  assert.equal(removed, 2, 'an end time equal to now has passed');
  assert.deepEqual(screen.entries.map((e) => e.mediaId), ['keep', 'later']);

  const again = await state.removeExpiredEntries('s1');
  assert.equal(again.removed, 0);

  await state.createScreen({ id: 'agg', name: 'A', kind: 'aggregate', members: [] });
  await assert.rejects(() => state.removeExpiredEntries('agg'), (e) => e.code === 'KIND_MISMATCH');
});

test('public screen and view playlists hide entries outside their window; aggregates follow their members', async () => {
  const clock = { t: T0 };
  const storage = createMemoryStorage();
  const state = createState(storage, { now: () => new Date(clock.t) });
  const auth = createAuth(testConfig({}), { fetch: testing.createFakeCanva({}).jwksFetch });
  const srv = await startTestServer({}, { storage, state, auth });
  registerViewRoutes(srv.ctx.router, srv.ctx);
  registerReadRoutes(srv.ctx.router, srv.ctx);
  try {
    await state.createScreen({ id: 'tv', name: 'TV' });
    await state.createScreen({ id: 'v1', name: 'V1', kind: 'view', embed: {} });
    await state.createScreen({ id: 'agg', name: 'Agg', kind: 'aggregate', members: ['v1'], embed: {} });
    const items = [item('aaa', { startDatetime: iso(T0 + H) }), item('bbb')];
    await state.applyPush('tv', { pushId: 'p', title: 'T', enabled: true, items });
    await state.applyPush('v1', { pushId: 'p', title: 'T', enabled: true, items });

    for (const path of ['/s/tv/playlist.json', '/v/v1/playlist.json', '/v/agg/playlist.json']) {
      const r = await http(srv.base, path);
      assert.equal(r.status, 200, path);
      assert.equal(r.json.entries.length, 1, `${path} hides the scheduled entry`);
      assert.equal(r.json.nextChangeAt, iso(T0 + H), `${path} reports the next change`);
    }

    clock.t = T0 + H;
    for (const path of ['/s/tv/playlist.json', '/v/v1/playlist.json', '/v/agg/playlist.json']) {
      const r = await http(srv.base, path);
      assert.equal(r.json.entries.length, 2, `${path} shows it once it starts`);
      assert.equal(r.json.nextChangeAt, null);
    }
  } finally {
    await srv.close();
  }
});

test('the embed runtime renders nothing and hides its host when the playlist is empty', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../src/views/runtime.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('Ei sisältöä'), 'no placeholder text for an empty view');
  assert.match(src, /host\.style\.display = 'none'/);
  assert.match(src, /nextChangeAt/);
});
