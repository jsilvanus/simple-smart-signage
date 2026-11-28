/**
 * Resolve the public base prefix from the current admin pathname.
 * Works for /admin, /admin/, /signage/admin, /signage/admin/, etc.
 */
export function resolveBasePath(pathname = '/') {
  const clean = String(pathname || '/').replace(/\/admin(?:\/.*)?$/, '');
  return clean === '/' ? '' : clean;
}

/** Build a root-relative API URL under the resolved base path. */
export function apiUrl(base, path) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/api/v1${suffix}`;
}

/** Build the public player or view preview URL for a screen, view or aggregate. */
export function previewUrl(base, screenId, kind = 'screen') {
  const encoded = encodeURIComponent(screenId);
  if (kind === 'view' || kind === 'aggregate') {
    return `${base}/v/${encoded}/frame`;
  }
  return `${base}/s/${encoded}`;
}

/** Tunnus right keys for a single screen, view or aggregate. */
export function rightsKeysFor(id, kind = 'screen') {
  const scopeKind = kind === 'screen' ? 'screen' : 'view';
  return ['read', 'write', 'operate'].map((a) => `sissi:${a}:${scopeKind}:${id}`);
}

function parseOptionalInt(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

function optionalTrim(value) {
  const s = String(value ?? '').trim();
  return s === '' ? null : s;
}

/** Parse schedule lines (`mon,tue 08:00-20:00`) into `[{ days, start, end }]`. */
export function parseScheduleWindows(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const m = /^([a-z,]+)\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/i.exec(line);
    if (!m) {
      throw new Error(`Invalid schedule window "${line}" (expected e.g. mon,tue,wed 08:00-20:00)`);
    }
    const days = m[1]
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    return { days, start: m[2], end: m[3] };
  });
}

/** Format `[{ days, start, end }]` into editable lines. */
export function formatScheduleWindows(windows) {
  if (!Array.isArray(windows) || windows.length === 0) return '';
  return windows.map((w) => `${(w.days ?? []).join(',')} ${w.start}-${w.end}`).join('\n');
}

/**
 * Build a ScreenInput object from form values.
 * Empty optional numeric fields (width, height, maxVideoSeconds) become null.
 */
export function buildScreenPayload(values, { isCreate = false } = {}) {
  const kind = values.kind || 'screen';
  const payload = {
    name: String(values.name ?? '').trim(),
    orientation: values.orientation === 'vertical' ? 'vertical' : 'landscape',
    width: parseOptionalInt(values.width),
    height: parseOptionalInt(values.height),
    defaultImageSeconds: Number(values.defaultImageSeconds),
    maxVideoSeconds: parseOptionalInt(values.maxVideoSeconds),
  };
  if (isCreate) {
    payload.id = String(values.id ?? '').trim();
    if (kind !== 'screen') payload.kind = kind;
  }
  if (kind === 'view' || kind === 'aggregate') {
    const allowedOrigins = String(values.embedOrigins ?? '')
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    payload.embed = {
      type: values.embedType || 'carousel',
      options: {
        fit: values.embedFit === 'cover' ? 'cover' : 'contain',
        aspect: String(values.embedAspect ?? '16:9').trim() || '16:9',
        dots: values.embedDots !== false,
        fitContent: values.embedFitContent === true,
        autoplay: values.embedAutoplay !== false,
      },
      allowedOrigins,
    };
    if (kind === 'aggregate') {
      payload.members = Array.isArray(values.members)
        ? values.members
        : String(values.members ?? '')
            .split(/[\r\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return payload;
  }
  if (values.powerDriver !== undefined) {
    const driver = values.powerDriver || 'none';
    const lanId = optionalTrim(values.powerLanId);
    const routerId = optionalTrim(values.powerRouterId);
    const mac = optionalTrim(values.powerMac);
    const ip = optionalTrim(values.powerIp);
    const timezone = optionalTrim(values.powerTimezone);
    const windows = parseScheduleWindows(values.powerWindows);
    if (driver === 'none' && !lanId && !routerId && !mac && !ip && !timezone && windows.length === 0) {
      payload.power = null;
    } else {
      payload.power = {
        driver,
        lanId,
        routerId,
        mac,
        ip,
        override: values.powerOverride || 'auto',
        schedule: timezone || windows.length > 0 ? { timezone: timezone || 'UTC', windows } : null,
      };
    }
  }
  return payload;
}

/**
 * Return a new ordered array of entryIds with item at `index` shifted by `delta` (-1 or +1),
 * or null when the move is out of bounds.
 */
export function reorderedEntryIds(entries, index, delta) {
  if (!Array.isArray(entries)) return null;
  const target = index + delta;
  if (index < 0 || index >= entries.length || target < 0 || target >= entries.length) {
    return null;
  }
  const ids = entries.map((e) => e.entryId);
  const [moved] = ids.splice(index, 1);
  ids.splice(target, 0, moved);
  return ids;
}

/** Extract `error.message` from an API error payload, with fallback. */
export function extractErrorMessage(payload, fallback = 'Request failed') {
  const msg = payload?.error?.message;
  return typeof msg === 'string' && msg.trim() !== '' ? msg : fallback;
}

/** Format an ISO-8601 timestamp into a short local date/time string. */
export function formatAddedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
