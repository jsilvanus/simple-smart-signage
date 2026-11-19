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

/** Build the public player preview URL for a screen. */
export function previewUrl(base, screenId) {
  return `${base}/s/${encodeURIComponent(screenId)}`;
}

function parseOptionalInt(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * Build a ScreenInput object from form values.
 * Empty optional numeric fields (width, height, maxVideoSeconds) become null.
 */
export function buildScreenPayload(values, { isCreate = false } = {}) {
  const payload = {
    name: String(values.name ?? '').trim(),
    orientation: values.orientation === 'portrait' ? 'portrait' : 'landscape',
    width: parseOptionalInt(values.width),
    height: parseOptionalInt(values.height),
    defaultImageSeconds: Number(values.defaultImageSeconds),
    maxVideoSeconds: parseOptionalInt(values.maxVideoSeconds),
  };
  if (isCreate) {
    payload.id = String(values.id ?? '').trim();
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
