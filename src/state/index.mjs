import crypto from 'node:crypto';
import { ERROR_STATUS } from '../router.mjs';

const SCREEN_ID_RE = /^[a-z0-9-]{1,40}$/;
const ORIENTATIONS = new Set(['landscape', 'vertical']);
const KINDS = new Set(['image', 'video']);
const MODES = new Set(['append', 'replace']);
const POWER_DRIVERS = new Set(['none', 'pull', 'samsung-lan', 'android-adb', 'wol-only', 'router-wol']);
const POWER_OVERRIDES = new Set(['auto', 'on', 'off']);
const POWER_DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const SCREEN_PREFIX = 'state/screens/';
const PUSH_PREFIX = 'state/pushes/';

/** Domain error thrown by state operations with an OpenAPI ErrorCode. */
export class StateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StateError';
    this.code = code;
    this.status = ERROR_STATUS[code] ?? 500;
  }
}

function screenKey(id) {
  return `${SCREEN_PREFIX}${id}.json`;
}

function pushKey(pushId) {
  return `${PUSH_PREFIX}${pushId}.json`;
}

function isStorageConflict(err) {
  return Boolean(err && (err.name === 'StorageConflictError' || err.code === 'STORAGE_CONFLICT'));
}

function toMs(val) {
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val;
  return Date.parse(val);
}

function toScreenView(doc) {
  return {
    id: doc.id,
    name: doc.name,
    orientation: doc.orientation,
    width: doc.width ?? null,
    height: doc.height ?? null,
    defaultImageSeconds: doc.defaultImageSeconds,
    maxVideoSeconds: doc.maxVideoSeconds ?? null,
    entryCount: doc.entries.length,
    playlistVersion: doc.version,
    entries: doc.entries,
    power: doc.power ?? null,
  };
}

function validateOptionalShortString(value, field, maxLen = 64) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > maxLen) {
    throw new StateError('INVALID_SCREEN', `${field} must be a non-empty string up to ${maxLen} chars or null`);
  }
  return value.trim();
}

function validateSchedule(schedule) {
  if (schedule === undefined || schedule === null) return null;
  if (typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw new StateError('INVALID_SCREEN', 'power.schedule must be an object or null');
  }
  const timezone = schedule.timezone ? String(schedule.timezone).trim() : 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new StateError('INVALID_SCREEN', `Invalid power.schedule.timezone: ${timezone}`);
  }
  const rawWindows = schedule.windows ?? [];
  if (!Array.isArray(rawWindows)) {
    throw new StateError('INVALID_SCREEN', 'power.schedule.windows must be an array');
  }
  const windows = rawWindows.map((win) => {
    if (!win || typeof win !== 'object' || Array.isArray(win)) {
      throw new StateError('INVALID_SCREEN', 'power.schedule.windows entry must be an object');
    }
    if (!Array.isArray(win.days) || win.days.length === 0) {
      throw new StateError('INVALID_SCREEN', 'power.schedule.windows[].days must be a non-empty array');
    }
    const days = win.days.map((d) => {
      const norm = String(d).trim().toLowerCase();
      if (!POWER_DAYS.has(norm)) {
        throw new StateError('INVALID_SCREEN', `Invalid schedule day: ${d}`);
      }
      return norm;
    });
    if (typeof win.start !== 'string' || !HM_RE.test(win.start)) {
      throw new StateError('INVALID_SCREEN', 'power.schedule.windows[].start must be HH:MM');
    }
    if (typeof win.end !== 'string' || !HM_RE.test(win.end)) {
      throw new StateError('INVALID_SCREEN', 'power.schedule.windows[].end must be HH:MM');
    }
    return { days, start: win.start, end: win.end };
  });
  return { timezone, windows };
}

function validatePower(power) {
  if (power === undefined || power === null) return null;
  if (typeof power !== 'object' || Array.isArray(power)) {
    throw new StateError('INVALID_SCREEN', 'power must be an object or null');
  }
  const driver = power.driver ?? 'none';
  if (!POWER_DRIVERS.has(driver)) {
    throw new StateError('INVALID_SCREEN', `Invalid power.driver: ${driver}`);
  }
  const override = power.override ?? 'auto';
  if (!POWER_OVERRIDES.has(override)) {
    throw new StateError('INVALID_SCREEN', `Invalid power.override: ${override}`);
  }
  const lanId = validateOptionalShortString(power.lanId, 'power.lanId');
  const routerId = validateOptionalShortString(power.routerId, 'power.routerId');
  const mac = validateOptionalShortString(power.mac, 'power.mac', 32);
  if (mac !== null && !MAC_RE.test(mac)) {
    throw new StateError('INVALID_SCREEN', 'power.mac must be a valid MAC address');
  }
  const ip = validateOptionalShortString(power.ip, 'power.ip', 128);
  if (ip !== null && /\s/.test(ip)) {
    throw new StateError('INVALID_SCREEN', 'power.ip must not contain whitespace');
  }
  const schedule = validateSchedule(power.schedule);
  return { lanId, routerId, driver, mac, ip, override, schedule };
}

function validateNullablePositiveInt(value, field, errorCode) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw new StateError(errorCode, `${field} must be a positive integer or null`);
  }
  return value;
}

function validateImageSeconds(value, field = 'seconds') {
  if (!Number.isInteger(value) || value < 1 || value > 3600) {
    throw new StateError('INVALID_SECONDS', `${field} must be an integer between 1 and 3600`);
  }
  return value;
}

function validateScreenCreate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new StateError('INVALID_SCREEN', 'Screen input must be an object');
  }
  if (typeof input.id !== 'string' || !SCREEN_ID_RE.test(input.id)) {
    throw new StateError('INVALID_SCREEN', 'Screen id must match ^[a-z0-9-]{1,40}$');
  }
  if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 100) {
    throw new StateError('INVALID_SCREEN', 'Screen name must be 1-100 characters');
  }
  const orientation = input.orientation ?? 'landscape';
  if (!ORIENTATIONS.has(orientation)) {
    throw new StateError('INVALID_SCREEN', 'Screen orientation must be landscape or vertical');
  }
  const width = validateNullablePositiveInt(input.width, 'width', 'INVALID_SCREEN');
  const height = validateNullablePositiveInt(input.height, 'height', 'INVALID_SCREEN');
  const defaultImageSeconds =
    input.defaultImageSeconds === undefined
      ? 10
      : validateImageSeconds(input.defaultImageSeconds, 'defaultImageSeconds');
  const maxVideoSeconds = validateNullablePositiveInt(input.maxVideoSeconds, 'maxVideoSeconds', 'INVALID_SECONDS');
  const power = input.power === undefined ? null : validatePower(input.power);

  return {
    id: input.id,
    name: input.name,
    orientation,
    width,
    height,
    defaultImageSeconds,
    maxVideoSeconds,
    power,
    version: 1,
    entries: [],
  };
}

function applyScreenPatch(doc, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new StateError('INVALID_SCREEN', 'Screen patch must be an object');
  }
  if (patch.id !== undefined && patch.id !== doc.id) {
    throw new StateError('INVALID_SCREEN', 'Screen id cannot be changed');
  }
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string' || patch.name.trim().length < 1 || patch.name.length > 100) {
      throw new StateError('INVALID_SCREEN', 'Screen name must be 1-100 characters');
    }
    doc.name = patch.name;
  }
  if (patch.orientation !== undefined) {
    if (!ORIENTATIONS.has(patch.orientation)) {
      throw new StateError('INVALID_SCREEN', 'Screen orientation must be landscape or vertical');
    }
    doc.orientation = patch.orientation;
  }
  if (patch.width !== undefined) {
    doc.width = validateNullablePositiveInt(patch.width, 'width', 'INVALID_SCREEN');
  }
  if (patch.height !== undefined) {
    doc.height = validateNullablePositiveInt(patch.height, 'height', 'INVALID_SCREEN');
  }
  if (patch.defaultImageSeconds !== undefined) {
    doc.defaultImageSeconds = validateImageSeconds(patch.defaultImageSeconds, 'defaultImageSeconds');
  }
  if (patch.maxVideoSeconds !== undefined) {
    doc.maxVideoSeconds = validateNullablePositiveInt(patch.maxVideoSeconds, 'maxVideoSeconds', 'INVALID_SECONDS');
  }
  if (patch.power !== undefined) {
    doc.power = validatePower(patch.power);
  }
}

/**
 * Create the state store backed by `storage`.
 * Manages screens, playlists, push records, and media garbage collection.
 */
export function createState(storage, { now = () => new Date(), idGen } = {}) {
  const screenLocks = new Map();
  const powerStatus = new Map();

  function nowDate() {
    const val = now();
    return val instanceof Date ? val : new Date(val);
  }

  function nextId(prefix = '') {
    const raw = idGen ? idGen() : crypto.randomUUID();
    return prefix ? `${prefix}${raw}` : String(raw);
  }

  async function withScreenLock(id, task) {
    const prev = screenLocks.get(id) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => gate);
    screenLocks.set(id, tail);
    await prev;
    try {
      return await task();
    } finally {
      release();
      if (screenLocks.get(id) === tail) {
        screenLocks.delete(id);
      }
    }
  }

  /**
   * Load screen `id`, run `fn(doc)` under a per-screen lock, increment `version`,
   * and write with CAS (`ifMatch`). Retries once on conflict, then throws `StateError('BUSY')`.
   */
  async function mutateScreen(id, fn) {
    return withScreenLock(id, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await storage.getJson(screenKey(id));
        if (!res) {
          throw new StateError('SCREEN_NOT_FOUND', `Unknown screen: ${id}`);
        }
        const doc = structuredClone(res.value);
        const maybeDoc = await fn(doc);
        const updated =
          maybeDoc && typeof maybeDoc === 'object' && maybeDoc.id === doc.id && Array.isArray(maybeDoc.entries)
            ? maybeDoc
            : doc;
        updated.version = (updated.version ?? 0) + 1;
        try {
          await storage.putJson(screenKey(id), updated, { ifMatch: res.etag });
          return toScreenView(updated);
        } catch (err) {
          if (isStorageConflict(err)) {
            if (attempt === 0) continue;
            throw new StateError('BUSY', `Screen ${id} is busy due to concurrent modification`);
          }
          throw err;
        }
      }
    });
  }

  async function createScreen(input) {
    const doc = validateScreenCreate(input);
    return withScreenLock(doc.id, async () => {
      try {
        await storage.putJson(screenKey(doc.id), doc, { ifMatch: null });
      } catch (err) {
        if (isStorageConflict(err)) {
          throw new StateError('SCREEN_EXISTS', `Screen already exists: ${doc.id}`);
        }
        throw err;
      }
      return toScreenView(doc);
    });
  }

  async function updateScreen(id, patch) {
    return mutateScreen(id, (doc) => {
      applyScreenPatch(doc, patch);
    });
  }

  async function deleteScreen(id) {
    return withScreenLock(id, async () => {
      const res = await storage.getJson(screenKey(id));
      if (!res) {
        throw new StateError('SCREEN_NOT_FOUND', `Unknown screen: ${id}`);
      }
      await storage.deleteJson(screenKey(id));
    });
  }

  async function getScreen(id) {
    const res = await storage.getJson(screenKey(id));
    if (!res) {
      throw new StateError('SCREEN_NOT_FOUND', `Unknown screen: ${id}`);
    }
    return toScreenView(res.value);
  }

  async function listScreens() {
    const keys = await storage.listJson(SCREEN_PREFIX);
    const docs = await Promise.all(keys.map((k) => storage.getJson(k)));
    return docs
      .filter(Boolean)
      .map((r) => toScreenView(r.value))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async function applyPush(screenId, { pushId, mode = 'append', title, items } = {}) {
    if (!MODES.has(mode)) {
      throw new StateError('INVALID_MODE', `Invalid push mode: ${mode}`);
    }
    if (typeof title !== 'string' || title.trim().length < 1 || title.length > 200) {
      throw new StateError('INVALID_TITLE', 'Push title must be 1-200 characters');
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
      throw new StateError('INVALID_PAGES', 'Push items must contain 1-100 entries');
    }
    if (typeof pushId !== 'string' || pushId.length < 1) {
      throw new StateError('INVALID_PAGES', 'pushId is required');
    }

    for (const item of items) {
      if (!item || typeof item !== 'object') {
        throw new StateError('INVALID_PAGES', 'Invalid push item');
      }
      if (!KINDS.has(item.kind)) {
        throw new StateError('INVALID_KIND', `Invalid item kind: ${item.kind}`);
      }
      if (typeof item.mediaId !== 'string' || !item.mediaId || typeof item.ext !== 'string' || !item.ext) {
        throw new StateError('INVALID_PAGES', 'Push item must include mediaId and ext');
      }
      if (item.kind === 'image' && item.seconds !== undefined && item.seconds !== null) {
        validateImageSeconds(item.seconds);
      }
      if (item.kind === 'video' && item.seconds !== undefined && item.seconds !== null) {
        if (typeof item.seconds !== 'number' || !Number.isFinite(item.seconds) || item.seconds <= 0) {
          throw new StateError('INVALID_SECONDS', 'Video seconds must be a positive number');
        }
      }
    }

    const screen = await mutateScreen(screenId, (doc) => {
      const addedAt = nowDate().toISOString();
      const newEntries = items.map((item) => ({
        entryId: nextId('entry_'),
        mediaId: item.mediaId,
        ext: item.ext,
        kind: item.kind,
        seconds:
          item.kind === 'image'
            ? (item.seconds ?? doc.defaultImageSeconds)
            : Math.max(1, Math.round(item.seconds ?? 1)),
        title,
        pushId,
        addedAt,
      }));
      doc.entries = mode === 'replace' ? newEntries : [...doc.entries, ...newEntries];
    });

    return { playlistVersion: screen.playlistVersion };
  }

  async function removeEntry(screenId, entryId) {
    return mutateScreen(screenId, (doc) => {
      const idx = doc.entries.findIndex((e) => e.entryId === entryId);
      if (idx === -1) {
        throw new StateError('ENTRY_NOT_FOUND', `Unknown entry: ${entryId}`);
      }
      doc.entries.splice(idx, 1);
    });
  }

  async function reorderEntries(screenId, entryIds) {
    return mutateScreen(screenId, (doc) => {
      if (!Array.isArray(entryIds) || entryIds.length !== doc.entries.length) {
        throw new StateError('INVALID_PAGES', 'entryIds must be a permutation of current entries');
      }
      const byId = new Map(doc.entries.map((e) => [e.entryId, e]));
      const seen = new Set();
      const reordered = [];
      for (const id of entryIds) {
        if (typeof id !== 'string' || seen.has(id) || !byId.has(id)) {
          throw new StateError('INVALID_PAGES', 'entryIds must be a permutation of current entries');
        }
        seen.add(id);
        reordered.push(byId.get(id));
      }
      doc.entries = reordered;
    });
  }

  async function setEntrySeconds(screenId, entryId, seconds) {
    validateImageSeconds(seconds);
    return mutateScreen(screenId, (doc) => {
      const entry = doc.entries.find((e) => e.entryId === entryId);
      if (!entry) {
        throw new StateError('ENTRY_NOT_FOUND', `Unknown entry: ${entryId}`);
      }
      if (entry.kind !== 'image') {
        throw new StateError('INVALID_KIND', 'seconds can only be set on image entries');
      }
      entry.seconds = seconds;
    });
  }

  async function removePush(screenId, pushId) {
    return mutateScreen(screenId, (doc) => {
      const next = doc.entries.filter((e) => e.pushId !== pushId);
      if (next.length === doc.entries.length) {
        throw new StateError('PUSH_NOT_FOUND', `No entries for push ${pushId} on screen ${screenId}`);
      }
      doc.entries = next;
    });
  }

  async function getPlaylist(screenId) {
    const res = await storage.getJson(screenKey(screenId));
    if (!res) {
      throw new StateError('SCREEN_NOT_FOUND', `Unknown screen: ${screenId}`);
    }
    const doc = res.value;
    return {
      screenId: doc.id,
      version: doc.version,
      orientation: doc.orientation,
      entries: doc.entries,
    };
  }

  async function createPush({ pushId, screenId, pagesTotal = 0 } = {}) {
    const id = pushId ?? nextId('push_');
    const ts = nowDate().toISOString();
    const doc = {
      pushId: id,
      screenId,
      state: 'queued',
      progress: 0,
      pages: { done: 0, total: pagesTotal },
      error: null,
      playlistVersion: null,
      createdAt: ts,
      updatedAt: ts,
    };
    await storage.putJson(pushKey(id), doc, { ifMatch: null });
    return doc;
  }

  async function updatePush(pushId, patch) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await storage.getJson(pushKey(pushId));
      if (!res) {
        throw new StateError('PUSH_NOT_FOUND', `Unknown push: ${pushId}`);
      }
      const doc = {
        ...res.value,
        ...patch,
        pushId: res.value.pushId,
        updatedAt: nowDate().toISOString(),
      };
      try {
        await storage.putJson(pushKey(pushId), doc, { ifMatch: res.etag });
        return doc;
      } catch (err) {
        if (isStorageConflict(err) && attempt === 0) continue;
        throw err;
      }
    }
  }

  async function getPush(pushId) {
    const res = await storage.getJson(pushKey(pushId));
    if (!res) {
      throw new StateError('PUSH_NOT_FOUND', `Unknown push: ${pushId}`);
    }
    return res.value;
  }

  async function sweepPushes({ retentionHours = 24, now: overrideNow } = {}) {
    const currentMs = toMs(overrideNow ? (typeof overrideNow === 'function' ? overrideNow() : overrideNow) : nowDate());
    const cutoffMs = currentMs - retentionHours * 3600 * 1000;
    const keys = await storage.listJson(PUSH_PREFIX);
    let deleted = 0;
    for (const key of keys) {
      const res = await storage.getJson(key);
      if (!res) continue;
      const ts = toMs(res.value.updatedAt ?? res.value.createdAt);
      if (ts <= cutoffMs) {
        await storage.deleteJson(key);
        deleted++;
      }
    }
    return { deleted };
  }

  async function markInterruptedOnStart() {
    const keys = await storage.listJson(PUSH_PREFIX);
    let marked = 0;
    for (const key of keys) {
      const res = await storage.getJson(key);
      if (!res) continue;
      const doc = res.value;
      if (doc.state === 'queued' || doc.state === 'downloading') {
        const updated = {
          ...doc,
          state: 'failed',
          error: { code: 'INTERRUPTED', message: 'Service restarted before push completed' },
          updatedAt: nowDate().toISOString(),
        };
        await storage.putJson(key, updated, { ifMatch: res.etag });
        marked++;
      }
    }
    return { marked };
  }

  async function referencedMedia() {
    const keys = await storage.listJson(SCREEN_PREFIX);
    const docs = await Promise.all(keys.map((k) => storage.getJson(k)));
    const refs = new Set();
    for (const res of docs) {
      if (!res) continue;
      for (const entry of res.value.entries ?? []) {
        if (entry.mediaId && entry.ext) {
          refs.add(`${entry.mediaId}.${entry.ext}`);
        }
      }
    }
    return refs;
  }

  async function gcSweep(storageOrOpts, maybeOpts) {
    let targetStorage = storage;
    let opts = {};
    if (storageOrOpts && typeof storageOrOpts.listMedia === 'function') {
      targetStorage = storageOrOpts;
      opts = maybeOpts ?? {};
    } else {
      opts = storageOrOpts ?? {};
    }

    const graceMinutes = opts.graceMinutes ?? 60;
    const currentMs = toMs(
      opts.now ? (typeof opts.now === 'function' ? opts.now() : opts.now) : nowDate(),
    );
    const cutoffMs = currentMs - graceMinutes * 60 * 1000;
    const referenced = await referencedMedia();

    let deleted = 0;
    for await (const obj of targetStorage.listMedia()) {
      const refKey = `${obj.sha256}.${obj.ext}`;
      if (referenced.has(refKey)) continue;
      const modifiedMs = toMs(obj.lastModified);
      if (modifiedMs > cutoffMs) continue;
      await targetStorage.deleteMedia(obj.sha256, obj.ext);
      deleted++;
    }
    return { deleted };
  }

  async function setPowerOverride(screenId, override) {
    if (!POWER_OVERRIDES.has(override)) {
      throw new StateError('INVALID_SCREEN', `Invalid power override: ${override}`);
    }
    return mutateScreen(screenId, (doc) => {
      doc.power = {
        lanId: null,
        routerId: null,
        driver: 'none',
        mac: null,
        ip: null,
        schedule: null,
        ...(doc.power && typeof doc.power === 'object' ? doc.power : {}),
        override,
      };
    });
  }

  function recordPowerReport(lanId, devices = []) {
    const updatedAt = nowDate().toISOString();
    const recorded = [];
    for (const dev of devices) {
      if (!dev || typeof dev.screenId !== 'string' || !dev.screenId) continue;
      const entry = {
        screenId: dev.screenId,
        lanId: lanId ?? null,
        reachable: Boolean(dev.reachable),
        lastAction: dev.lastAction ?? null,
        error: dev.error ?? null,
        updatedAt,
      };
      powerStatus.set(dev.screenId, entry);
      recorded.push(entry);
    }
    return recorded;
  }

  function getPowerStatus(screenId) {
    if (screenId !== undefined) {
      return powerStatus.get(screenId) ?? null;
    }
    return Object.fromEntries(powerStatus);
  }

  return {
    mutateScreen,
    createScreen,
    updateScreen,
    deleteScreen,
    getScreen,
    listScreens,
    applyPush,
    removeEntry,
    reorderEntries,
    setEntrySeconds,
    removePush,
    getPlaylist,
    createPush,
    updatePush,
    getPush,
    sweepPushes,
    markInterruptedOnStart,
    referencedMedia,
    gcSweep,
    setPowerOverride,
    recordPowerReport,
    getPowerStatus,
  };
}
