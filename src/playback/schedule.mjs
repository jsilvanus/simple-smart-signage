// Shared playback schedule. Every screen of a playlist plays the same position at the same
// server time: the cycle is the sum of the enabled entries' seconds, and position = serverNow mod cycle.
// The player uses the same arithmetic (public/player/player.js), so keep the two in step.

/** entries -> total cycle length in milliseconds (0 when nothing plays). */
export function cycleMs(entries) {
  let total = 0;
  for (const e of entries) total += Math.max(0, Number(e.seconds) || 0) * 1000;
  return total;
}

/**
 * entries + serverNowMs -> { index, entryId, offsetMs, remainingMs } for the entry playing at that instant,
 * or null when the cycle is empty.
 */
export function nowPlaying(entries, serverNowMs) {
  const total = cycleMs(entries);
  if (total <= 0) return null;
  const pos = ((serverNowMs % total) + total) % total;
  let start = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const len = Math.max(0, Number(entries[index].seconds) || 0) * 1000;
    if (len <= 0) continue;
    if (pos < start + len) {
      return { index, entryId: entries[index].entryId, offsetMs: pos - start, remainingMs: start + len - pos };
    }
    start += len;
  }
  return null;
}
