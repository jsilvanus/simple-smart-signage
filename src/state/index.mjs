import crypto from 'node:crypto';
import { ERROR_STATUS } from '../router.mjs';
import { validateEmbed, validateItemText, validateMembers } from '../views/embed.mjs';

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

/** Entries stored before the enabled flag existed are live (true). */
function isEnabled(entry) {
  return entry.enabled !== false;
}

function withEnabled(entry) {
  return {
    ...entry,
    background: entry.background ?? null,
    width: entry.width ?? null,
    height: entry.height ?? null,
    variants: Array.isArray(entry.variants) ? entry.variants : [],
    playbackRate: entry.playbackRate ?? 1.0,
    clipStart: entry.clipStart ?? null,
    clipEnd: entry.clipEnd ?? null,
    playCount: entry.playCount ?? (entry.playForSeconds ? null : 1),
    playForSeconds: entry.playForSeconds ?? null,
    rawSeconds: entry.rawSeconds ?? (entry.kind === 'video' ? entry.seconds : null),
    enabled: isEnabled(entry),
  };
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Normalises one optional ISO 8601 datetime (with offset) to a UTC ISO string; null/''/undefined mean "no limit". */
function validateDatetime(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATETIME_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new StateError('INVALID_SCHEDULE', `${field} must be an ISO 8601 datetime with a UTC offset, or null`);
  }
  return new Date(value).toISOString();
}

/** Validates a { startDatetime, endDatetime } pair; end must be after start. */
function validateEntryWindow({ startDatetime, endDatetime } = {}) {
  const start = validateDatetime(startDatetime, 'startDatetime');
  const end = validateDatetime(endDatetime, 'endDatetime');
  if (start && end && Date.parse(end) <= Date.parse(start)) {
    throw new StateError('INVALID_SCHEDULE', 'endDatetime must be after startDatetime');
  }
  return { startDatetime: start, endDatetime: end };
}

function boundaryMs(value) {
  if (value === undefined || value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** True when `nowMs` is inside the entry's start/end window (missing limits are open). Entries without a window always are. */
function inWindow(entry, nowMs) {
  const start = boundaryMs(entry.startDatetime);
  const end = boundaryMs(entry.endDatetime);
  return (start === null || start <= nowMs) && (end === null || nowMs < end);
}

/** An entry is shown only when it is enabled and inside its window. */
function isLive(entry, nowMs) {
  return isEnabled(entry) && inWindow(entry, nowMs);
}

/**
 * The entries that are live at `nowMs`, plus what a player needs to follow time-driven changes:
 * - `crossed`: how many start/end boundaries of enabled entries have passed (changes whenever the live set does).
 * - `nextChangeAt`: ISO time of the next boundary, or null.
 */
function liveSnapshot(entries, nowMs) {
  let crossed = 0;
  let next = null;
  for (const entry of entries) {
    if (!isEnabled(entry)) continue;
    for (const b of [boundaryMs(entry.startDatetime), boundaryMs(entry.endDatetime)]) {
      if (b === null) continue;
      if (b <= nowMs) crossed++;
      else if (next === null || b < next) next = b;
    }
  }
  return {
    entries: entries.filter((e) => isLive(e, nowMs)),
    crossed,
    nextChangeAt: next === null ? null : new Date(next).toISOString(),
  };
}

/** Playlist version that also moves when scheduled entries go live or expire. Unscheduled playlists keep `version` as is. */
function effectiveVersion(version, crossed) {
  return crossed === 0 ? version : version * 1000 + Math.min(crossed, 999);
}

function isTransparentColor(c) {
  if (!c) return false;
  const s = String(c).trim().toLowerCase();
  if (s === 'transparent') return true;
  if (s === '#00000000' || s === '#0000') return true;
  if (/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0+(\.0+)?\s*\)$/.test(s)) return true;
  if (/^hsla\([^,]+,[^,]+,[^,]+,\s*0+(\.0+)?\s*\)$/.test(s)) return true;
  return false;
}

function validateColor(val) {
  if (typeof val !== 'string') throw new StateError('INVALID_SCREEN', 'Background color must be a string');
  const s = val.trim();
  if (!s || s.length > 64) throw new StateError('INVALID_SCREEN', 'Background color must be 1-64 characters');
  const isHex = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
  const isRgb = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0(\.\d+)?|1(\.0+)?|\.\d+)\s*)?\)$/i.test(s);
  const isHsl = /^hsla?\(\s*\d{1,3}(\.\d+)?(deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0(\.\d+)?|1(\.0+)?|\.\d+)\s*)?\)$/i.test(s);
  const isNamed = /^[a-zA-Z]{3,25}$/.test(s);
  if (!isHex && !isRgb && !isHsl && !isNamed) {
    throw new StateError('INVALID_SCREEN', `Invalid CSS background color format: ${s}`);
  }
  return s;
}

function validateScreenBackground(color, kind) {
  if (color === undefined || color === null || color === '') {
    return kind === 'screen' ? '#000000' : 'transparent';
  }
  const validated = validateColor(color);
  if (kind === 'screen' && isTransparentColor(validated)) {
    throw new StateError('INVALID_SCREEN', 'Transparent background is not supported on screens');
  }
  return validated;
}

function toScreenView(doc) {
  return {
    id: doc.id,
    kind: doc.kind ?? 'screen',
    embed: doc.embed ?? null,
    members: doc.members ?? null,
    name: doc.name,
    orientation: doc.orientation,
    background: doc.background ?? ((doc.kind ?? 'screen') === 'screen' ? '#000000' : 'transparent'),
    width: doc.width ?? null,
    height: doc.height ?? null,
    defaultImageSeconds: doc.defaultImageSeconds,
    maxVideoSeconds: doc.maxVideoSeconds ?? null,
    entryCount: doc.entries.length,
    enabledEntryCount: doc.entries.filter(isEnabled).length,
    playlistVersion: doc.version,
    entries: doc.entries.map(withEnabled),
    power: doc.power ?? null,
  };
}

const VIEW_KIND_SET = new Set(['screen', 'view', 'aggregate']);

function isViewDoc(doc) {
  return doc.kind === 'view' || doc.kind === 'aggregate';
}

function isScreenDoc(doc) {
  return (doc.kind ?? 'screen') === 'screen';
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
  const kind = input.kind ?? 'screen';
  if (!VIEW_KIND_SET.has(kind)) {
    throw new StateError('INVALID_SCREEN', 'kind must be screen, view or aggregate');
  }
  if (kind === 'screen') {
    if (input.embed !== undefined || input.members !== undefined) {
      throw new StateError('INVALID_SCREEN', 'embed and members are only for views and aggregates');
    }
  } else {
    if (input.power !== undefined) {
      throw new StateError('INVALID_SCREEN', 'Views have no power settings');
    }
    if (kind === 'view' && input.members !== undefined) {
      throw new StateError('INVALID_SCREEN', 'members is only for aggregates');
    }
  }
  const power = kind === 'screen' && input.power !== undefined ? validatePower(input.power) : null;
  const embed = kind === 'screen' ? null : validateEmbed(input.embed);
  const members = kind === 'aggregate' ? validateMembers(input.members ?? [], input.id) : null;
  const background = validateScreenBackground(input.background, kind);

  const doc = {
    id: input.id,
    name: input.name,
    orientation,
    background,
    width,
    height,
    defaultImageSeconds,
    maxVideoSeconds,
    power,
    version: 1,
    entries: [],
  };
  if (kind !== 'screen') {
    doc.kind = kind;
    doc.embed = embed;
    doc.members = members;
  }
  return doc;
}

function applyScreenPatch(doc, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new StateError('INVALID_SCREEN', 'Screen patch must be an object');
  }
  if (patch.id !== undefined && patch.id !== doc.id) {
    throw new StateError('INVALID_SCREEN', 'Screen id cannot be changed');
  }
  if (patch.kind !== undefined && patch.kind !== (doc.kind ?? 'screen')) {
    throw new StateError('INVALID_SCREEN', 'kind cannot be changed');
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
  if (patch.embed !== undefined) {
    if (isScreenDoc(doc)) throw new StateError('INVALID_SCREEN', 'embed is only for views and aggregates');
    doc.embed = validateEmbed(patch.embed);
  }
  if (patch.members !== undefined) {
    if (doc.kind !== 'aggregate') throw new StateError('INVALID_SCREEN', 'members is only for aggregates');
    doc.members = validateMembers(patch.members, doc.id);
  }
  if (patch.power !== undefined) {
    if (!isScreenDoc(doc)) throw new StateError('INVALID_SCREEN', 'Views have no power settings');
    doc.power = validatePower(patch.power);
  }
  if (patch.background !== undefined) {
    doc.background = validateScreenBackground(patch.background, doc.kind ?? 'screen');
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

  async function assertAggregateMembers(members) {
    for (const memberId of members ?? []) {
      const res = await storage.getJson(screenKey(memberId));
      if (!res || res.value?.kind !== 'view') {
        throw new StateError('INVALID_SCREEN', `Aggregate member must be an existing view: ${memberId}`);
      }
    }
  }

  async function createScreen(input) {
    const doc = validateScreenCreate(input);
    if (doc.kind === 'aggregate' && doc.members?.length) {
      await assertAggregateMembers(doc.members);
    }
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
    if (patch?.members !== undefined) {
      await assertAggregateMembers(validateMembers(patch.members, id));
    }
    return mutateScreen(id, (doc) => {
      applyScreenPatch(doc, patch);
    });
  }

  async function deleteScreen(id) {
    const deletedKind = await withScreenLock(id, async () => {
      const res = await storage.getJson(screenKey(id));
      if (!res) {
        throw new StateError('SCREEN_NOT_FOUND', `Unknown screen: ${id}`);
      }
      await storage.deleteJson(screenKey(id));
      return res.value?.kind ?? 'screen';
    });
    if (deletedKind === 'view') {
      const keys = await storage.listJson(SCREEN_PREFIX);
      for (const k of keys) {
        const res = await storage.getJson(k);
        const doc = res?.value;
        if (doc?.kind === 'aggregate' && Array.isArray(doc.members) && doc.members.includes(id)) {
          await mutateScreen(doc.id, (d) => {
            d.members = (d.members ?? []).filter((m) => m !== id);
          }).catch(() => {});
        }
      }
    }
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

  async function applyPush(screenId, { pushId, mode = 'append', title, items, enabled = false } = {}) {
    if (!MODES.has(mode)) {
      throw new StateError('INVALID_MODE', `Invalid push mode: ${mode}`);
    }
    if (typeof enabled !== 'boolean') {
      throw new StateError('INVALID_ENABLED', 'enabled must be a boolean');
    }
    if (mode === 'replace' && !enabled) {
      // Replace takes the old items off the screen, which is a live change.
      throw new StateError('INVALID_MODE', 'replace needs enabled: true (it changes what is live)');
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

    const texts = items.map((item) => validateItemText(item));
    const windows = items.map((item) => validateEntryWindow(item));

    const screen = await mutateScreen(screenId, (doc) => {
      if (doc.kind === 'aggregate') {
        throw new StateError('KIND_MISMATCH', 'An aggregate holds views, not items: push to one of its views');
      }
      const addedAt = nowDate().toISOString();
      const newEntries = items.map((item, i) => ({
        ...texts[i],
        ...windows[i],
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
        canvaDesignId: item.canvaDesignId ?? item.designId ?? null,
        background: null,
        width: item.width ?? null,
        height: item.height ?? null,
        variants: Array.isArray(item.variants) ? item.variants : [],
        playbackRate: item.playbackRate ?? 1.0,
        clipStart: item.clipStart ?? null,
        clipEnd: item.clipEnd ?? null,
        playCount: item.playCount ?? (item.playForSeconds ? null : 1),
        playForSeconds: item.playForSeconds ?? null,
        rawSeconds: item.kind === 'video' ? Math.max(1, Math.round(item.seconds ?? 1)) : null,
        addedAt,
        enabled,
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

  async function setEntryTitle(screenId, entryId, title) {
    if (typeof title !== 'string' || title.trim().length < 1 || title.length > 200) {
      throw new StateError('INVALID_TITLE', 'Entry title must be 1-200 characters');
    }
    return mutateScreen(screenId, (doc) => {
      const entry = doc.entries.find((e) => e.entryId === entryId);
      if (!entry) {
        throw new StateError('ENTRY_NOT_FOUND', `Unknown entry: ${entryId}`);
      }
      entry.title = title.trim();
    });
  }

  async function setEntryBackground(screenId, entryId, background) {
    return mutateScreen(screenId, (doc) => {
      const entry = doc.entries.find((e) => e.entryId === entryId);
      if (!entry) {
        throw new StateError('ENTRY_NOT_FOUND', `Unknown entry: ${entryId}`);
      }
      if (background === null || background === undefined || background === '') {
        entry.background = null;
        return;
      }
      const validated = validateColor(background);
      if ((doc.kind ?? 'screen') === 'screen' && isTransparentColor(validated)) {
        throw new StateError('INVALID_SCREEN', 'Transparent background is not supported on screens');
      }
      entry.background = validated;
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

  function validatePlaybackRate(val) {
    if (val === undefined || val === null) return 1.0;
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0.2 || num > 4.0) {
      throw new StateError('INVALID_SECONDS', 'playbackRate must be a number between 0.2 and 4.0');
    }
    return Math.round(num * 100) / 100;
  }

  function validateClipTime(val, field) {
    if (val === undefined || val === null || val === '') return null;
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0) {
      throw new StateError('INVALID_SECONDS', `${field} must be a non-negative number`);
    }
    return Math.round(num * 100) / 100;
  }

  function validatePlayCount(val) {
    if (val === undefined || val === null || val === '') return null;
    const num = Number(val);
    if (!Number.isInteger(num) || num < 1 || num > 100) {
      throw new StateError('INVALID_SECONDS', 'playCount must be an integer between 1 and 100');
    }
    return num;
  }

  function validatePlayForSeconds(val) {
    if (val === undefined || val === null || val === '') return null;
    const num = Number(val);
    if (!Number.isInteger(num) || num < 1 || num > 3600) {
      throw new StateError('INVALID_SECONDS', 'playForSeconds must be an integer between 1 and 3600');
    }
    return num;
  }

  async function setEntryVideoControls(
    screenId,
    entryId,
    { playbackRate, clipStart, clipEnd, playCount, playForSeconds } = {},
  ) {
    return mutateScreen(screenId, (doc) => {
      const entry = doc.entries.find((e) => e.entryId === entryId);
      if (!entry) {
        throw new StateError('ENTRY_NOT_FOUND', `Unknown entry: ${entryId}`);
      }
      if (entry.kind !== 'video') {
        throw new StateError('INVALID_KIND', 'Video controls can only be set on video entries');
      }
      entry.rawSeconds ??= entry.seconds;

      const nextRate = playbackRate !== undefined ? validatePlaybackRate(playbackRate) : (entry.playbackRate ?? 1.0);
      const nextStart = clipStart !== undefined ? validateClipTime(clipStart, 'clipStart') : (entry.clipStart ?? null);
      const nextEnd = clipEnd !== undefined ? validateClipTime(clipEnd, 'clipEnd') : (entry.clipEnd ?? null);

      if (nextStart !== null && nextEnd !== null && nextEnd <= nextStart) {
        throw new StateError('INVALID_SECONDS', 'clipEnd must be greater than clipStart');
      }

      entry.playbackRate = nextRate;
      entry.clipStart = nextStart;
      entry.clipEnd = nextEnd;

      let nextPlayForSeconds =
        playForSeconds !== undefined ? validatePlayForSeconds(playForSeconds) : (entry.playForSeconds ?? null);
      let nextPlayCount =
        playCount !== undefined ? validatePlayCount(playCount) : (entry.playCount ?? (nextPlayForSeconds ? null : 1));

      if (playForSeconds !== undefined && playForSeconds !== null && playForSeconds !== '') {
        nextPlayCount = null;
      } else if (playCount !== undefined && playCount !== null && playCount !== '') {
        nextPlayForSeconds = null;
      }

      entry.playForSeconds = nextPlayForSeconds;
      entry.playCount = nextPlayCount;

      const baseSec = entry.rawSeconds ?? (entry.seconds || 10);
      const clipLength = Math.max(0.1, ((nextEnd ?? baseSec) - (nextStart ?? 0)) / nextRate);

      if (nextPlayForSeconds !== null) {
        entry.seconds = nextPlayForSeconds;
      } else if (nextPlayCount !== null) {
        entry.seconds = Math.max(1, Math.round(clipLength * nextPlayCount));
      } else {
        entry.seconds = Math.max(1, Math.round(clipLength));
      }
    });
  }

  async function setEntryText(screenId, entryId, textPatch = {}) {
    return mutateScreen(screenId, (doc) => {
      const entry = doc.entries.find((e) => e.entryId === entryId);
      if (!entry) {
        throw new StateError('ENTRY_NOT_FOUND', `Unknown entry: ${entryId}`);
      }
      const next = {
        alt: textPatch.alt !== undefined ? textPatch.alt : entry.alt,
        headline: textPatch.headline !== undefined ? textPatch.headline : entry.headline,
        caption: textPatch.caption !== undefined ? textPatch.caption : entry.caption,
        link: textPatch.link !== undefined ? textPatch.link : entry.link,
      };
      Object.assign(entry, validateItemText(next));
    });
  }

  /** Set the start/end window of one entry. Only the keys present in `patch` change; null clears a limit. */
  async function setEntrySchedule(screenId, entryId, patch = {}) {
    return mutateScreen(screenId, (doc) => {
      const entry = doc.entries.find((e) => e.entryId === entryId);
      if (!entry) {
        throw new StateError('ENTRY_NOT_FOUND', `Unknown entry: ${entryId}`);
      }
      const next = validateEntryWindow({
        startDatetime: patch.startDatetime !== undefined ? patch.startDatetime : entry.startDatetime,
        endDatetime: patch.endDatetime !== undefined ? patch.endDatetime : entry.endDatetime,
      });
      entry.startDatetime = next.startDatetime;
      entry.endDatetime = next.endDatetime;
    });
  }

  /** Remove every entry whose end time has passed (enabled or not). Returns { screen, removed }. */
  async function removeExpiredEntries(screenId) {
    const nowMs = nowDate().getTime();
    let removed = 0;
    const screen = await mutateScreen(screenId, (doc) => {
      if (doc.kind === 'aggregate') {
        throw new StateError('KIND_MISMATCH', 'An aggregate has no playlist of its own');
      }
      const keep = doc.entries.filter((e) => {
        const end = boundaryMs(e.endDatetime);
        return end === null || end > nowMs;
      });
      removed = doc.entries.length - keep.length;
      doc.entries = keep;
    });
    return { screen, removed };
  }

  function assertEnabledFlag(enabled) {
    if (typeof enabled !== 'boolean') {
      throw new StateError('INVALID_ENABLED', 'enabled must be a boolean');
    }
  }

  /** Make one entry live (true) or take it off the screen (false). */
  async function setEntryEnabled(screenId, entryId, enabled) {
    assertEnabledFlag(enabled);
    return mutateScreen(screenId, (doc) => {
      const entry = doc.entries.find((e) => e.entryId === entryId);
      if (!entry) {
        throw new StateError('ENTRY_NOT_FOUND', `Unknown entry: ${entryId}`);
      }
      entry.enabled = enabled;
    });
  }

  /** Attach a first-frame PNG thumbnail (already stored as media) to a video entry. */
  async function setEntryThumbnail(screenId, entryId, { mediaId, ext } = {}) {
    if (typeof mediaId !== 'string' || !mediaId || ext !== 'png') {
      throw new StateError('INVALID_PAGES', 'Thumbnail needs a mediaId and png ext');
    }
    return mutateScreen(screenId, (doc) => {
      const entry = doc.entries.find((e) => e.entryId === entryId);
      if (!entry) {
        throw new StateError('ENTRY_NOT_FOUND', `Unknown entry: ${entryId}`);
      }
      if (entry.kind !== 'video') {
        throw new StateError('INVALID_KIND', 'Thumbnails are only for video entries');
      }
      entry.thumbMediaId = mediaId;
      entry.thumbExt = ext;
    });
  }

  /** Enable or disable every entry of one push. */
  async function setPushEnabled(screenId, pushId, enabled) {
    assertEnabledFlag(enabled);
    return mutateScreen(screenId, (doc) => {
      const mine = doc.entries.filter((e) => e.pushId === pushId);
      if (mine.length === 0) {
        throw new StateError('PUSH_NOT_FOUND', `No entries for push ${pushId} on screen ${screenId}`);
      }
      for (const e of mine) e.enabled = enabled;
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

  /** Public view of a view or aggregate: its embed settings, members and enabled entries. */
  async function getViewDoc(id) {
    const res = await storage.getJson(screenKey(id));
    if (!res || !isViewDoc(res.value)) {
      throw new StateError('SCREEN_NOT_FOUND', `Unknown view: ${id}`);
    }
    const doc = res.value;
    const snap = liveSnapshot(doc.entries, nowDate().getTime());
    return {
      id: doc.id,
      name: doc.name,
      kind: doc.kind,
      embed: doc.embed,
      members: doc.members ?? null,
      version: effectiveVersion(doc.version, snap.crossed),
      nextChangeAt: snap.nextChangeAt,
      entries: snap.entries.map(withEnabled),
    };
  }

  async function getPlaylist(screenId) {
    const res = await storage.getJson(screenKey(screenId));
    if (!res) {
      throw new StateError('SCREEN_NOT_FOUND', `Unknown screen: ${screenId}`);
    }
    const doc = res.value;
    if (!isScreenDoc(doc)) {
      throw new StateError('KIND_MISMATCH', 'Playlists at /s/:id are only for screens');
    }
    const snap = liveSnapshot(doc.entries, nowDate().getTime());
    return {
      screenId: doc.id,
      version: effectiveVersion(doc.version, snap.crossed),
      nextChangeAt: snap.nextChangeAt,
      orientation: doc.orientation,
      background: doc.background ?? '#000000',
      entries: snap.entries,
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
        if (entry.thumbMediaId && entry.thumbExt) {
          refs.add(`${entry.thumbMediaId}.${entry.thumbExt}`);
        }
        if (Array.isArray(entry.variants)) {
          for (const v of entry.variants) {
            if (v.mediaId && v.ext) refs.add(`${v.mediaId}.${v.ext}`);
          }
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
      const baseSha = obj.sha256.replace(/-\d+w$/, '');
      if (baseSha !== obj.sha256 && [...referenced].some((r) => r.startsWith(baseSha + '.'))) {
        continue;
      }
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
      if (!isScreenDoc(doc)) {
        throw new StateError('INVALID_SCREEN', 'Views have no power settings');
      }
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
    setEntryTitle,
    setEntryBackground,
    setEntrySeconds,
    setEntryVideoControls,
    setEntryText,
    setEntryEnabled,
    setEntrySchedule,
    removeExpiredEntries,
    setEntryThumbnail,
    setPushEnabled,
    removePush,
    getPlaylist,
    getViewDoc,
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
