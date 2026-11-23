import assert from 'node:assert/strict';
import test from 'node:test';
import { cycleMs, nowPlaying } from '../../src/playback/schedule.mjs';

const entries = [
  { entryId: 'a', seconds: 10 },
  { entryId: 'b', seconds: 5 },
  { entryId: 'c', seconds: 20 },
];

test('cycle is the sum of slot lengths', () => {
  assert.equal(cycleMs(entries), 35000);
  assert.equal(cycleMs([]), 0);
});

test('two screens asking at the same server time see the same entry', () => {
  const t = 1_700_000_123_456;
  assert.deepEqual(nowPlaying(entries, t), nowPlaying(entries, t));
});

test('position wraps and reports time remaining in the slot', () => {
  assert.deepEqual(nowPlaying(entries, 0), { index: 0, entryId: 'a', offsetMs: 0, remainingMs: 10000 });
  assert.deepEqual(nowPlaying(entries, 12000), { index: 1, entryId: 'b', offsetMs: 2000, remainingMs: 3000 });
  assert.deepEqual(nowPlaying(entries, 35000), { index: 0, entryId: 'a', offsetMs: 0, remainingMs: 10000 });
  assert.equal(nowPlaying([], 1000), null);
});
