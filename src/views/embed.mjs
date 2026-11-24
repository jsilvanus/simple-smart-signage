// Views: web page embeds of Sissi content. Pure helpers (no I/O) so they are unit-tested in Node.
// Decisions: docs/plans/views-web-embeds.md (views are public; embedding sites are limited per view).

import { HttpError } from '../router.mjs';

export const VIEW_KINDS = Object.freeze(['screen', 'view', 'aggregate']);
export const EMBED_TYPES = Object.freeze(['carousel', 'single', 'gallery']);
const MAX_ORIGINS = 20;
const MAX_MEMBERS = 50;

const TEXT_LIMITS = Object.freeze({ alt: 300, headline: 120, caption: 500 });

function invalid(message) {
  return new HttpError('INVALID_SCREEN', message, 422);
}

/**
 * Normalises an allowed-origin list. Only https origins (and http://localhost for local tests)
 * are accepted; paths, credentials and wildcards are refused.
 */
export function normaliseOrigins(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw invalid('embed.allowedOrigins must be an array');
  if (input.length > MAX_ORIGINS) throw invalid(`embed.allowedOrigins allows at most ${MAX_ORIGINS} origins`);
  const out = [];
  for (const raw of input) {
    if (typeof raw !== 'string' || raw.includes('*')) {
      throw invalid('embed.allowedOrigins entries must be exact origins, for example https://example.org');
    }
    let u;
    try {
      u = new URL(raw.trim());
    } catch {
      throw invalid(`Invalid origin: ${raw}`);
    }
    const local = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if (u.protocol !== 'https:' && !local) throw invalid(`Origin must use https: ${raw}`);
    if (u.username || u.password || (u.pathname && u.pathname !== '/') || u.search || u.hash) {
      throw invalid(`Origin must not contain a path, query or credentials: ${raw}`);
    }
    if (!out.includes(u.origin)) out.push(u.origin);
  }
  return out;
}

/** Embed settings of a view or aggregate. Defaults: carousel, contain, no origins (so it cannot be embedded). */
export function validateEmbed(input) {
  const src = input ?? {};
  if (typeof src !== 'object' || Array.isArray(src)) throw invalid('embed must be an object');
  const type = src.type ?? 'carousel';
  if (!EMBED_TYPES.includes(type)) throw invalid(`embed.type must be one of ${EMBED_TYPES.join(', ')}`);
  const options = src.options ?? {};
  if (typeof options !== 'object' || Array.isArray(options)) throw invalid('embed.options must be an object');
  const fit = options.fit ?? 'contain';
  if (fit !== 'contain' && fit !== 'cover') throw invalid('embed.options.fit must be contain or cover');
  const aspect = options.aspect ?? '16:9';
  if (typeof aspect !== 'string' || !/^\d{1,2}:\d{1,2}$/.test(aspect)) {
    throw invalid('embed.options.aspect must look like 16:9');
  }
  return {
    type,
    options: { fit, aspect, dots: options.dots !== false },
    allowedOrigins: normaliseOrigins(src.allowedOrigins),
  };
}

/** Text fields of one item. All optional; text is plain text, never HTML. */
export function validateItemText(input = {}) {
  const src = input ?? {};
  const out = {};
  for (const field of ['alt', 'headline', 'caption']) {
    const value = src[field];
    if (value === undefined || value === null || value === '') {
      out[field] = null;
      continue;
    }
    if (typeof value !== 'string' || value.length > TEXT_LIMITS[field]) {
      throw new HttpError('INVALID_PAGES', `${field} must be text up to ${TEXT_LIMITS[field]} characters`, 422);
    }
    out[field] = value.trim() || null;
  }
  const link = src.link;
  if (link === undefined || link === null || link === '') {
    out.link = null;
  } else {
    let u;
    try {
      u = new URL(String(link));
    } catch {
      throw new HttpError('INVALID_PAGES', 'link must be an absolute https URL', 422);
    }
    if (u.protocol !== 'https:' || u.username || u.password) {
      throw new HttpError('INVALID_PAGES', 'link must be an https URL without credentials', 422);
    }
    out.link = u.href;
  }
  return out;
}

/** Members of an aggregate: plain views, in order, no duplicates, not itself. */
export function validateMembers(input, selfId) {
  if (!Array.isArray(input)) throw invalid('members must be an array of view ids');
  if (input.length > MAX_MEMBERS) throw invalid(`An aggregate holds at most ${MAX_MEMBERS} views`);
  const seen = new Set();
  for (const id of input) {
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) throw invalid(`Invalid view id in members: ${id}`);
    if (id === selfId) throw invalid('An aggregate cannot contain itself');
    if (seen.has(id)) throw invalid(`Duplicate view in members: ${id}`);
    seen.add(id);
  }
  return [...input];
}

/**
 * Aggregated playlist: the enabled entries of each member view in member order.
 * `memberDocs` is [{ id, entries }] already filtered to enabled entries.
 * Each entry keeps its own media and text and gains `sourceView`.
 */
export function joinMembers(memberDocs) {
  return memberDocs.flatMap((m) => m.entries.map((e) => ({ ...e, sourceView: m.id })));
}

/** Escapes a string for safe use inside an HTML attribute or text node. */
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Content-Security-Policy for the frame page. Only the page's own origin supplies scripts,
 * media and data; embedding is allowed only from the view's allowed origins.
 */
export function frameCsp(allowedOrigins) {
  const ancestors = allowedOrigins.length ? allowedOrigins.join(' ') : "'none'";
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src 'self'",
    "media-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    `frame-ancestors ${ancestors}`,
  ].join('; ');
}

/** CORS: the JSON is readable only from allowed origins. Returns headers to add (empty when not allowed). */
export function corsHeaders(requestOrigin, allowedOrigins) {
  if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) return {};
  return {
    'access-control-allow-origin': requestOrigin,
    vary: 'Origin',
  };
}
