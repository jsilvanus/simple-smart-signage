import crypto from 'node:crypto';

export class StorageConflictError extends Error {
  constructor(message = 'Storage conflict') {
    super(message);
    this.name = 'StorageConflictError';
  }
}

const SAFE_SHA_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_EXT_RE = /^[a-zA-Z0-9]+$/;

/** Validates media identifiers against path traversal and invalid characters. */
export function validateMediaParts(sha256, ext) {
  if (typeof sha256 !== 'string' || !SAFE_SHA_RE.test(sha256)) {
    throw new Error(`Invalid media sha256: ${String(sha256)}`);
  }
  if (typeof ext !== 'string' || !SAFE_EXT_RE.test(ext)) {
    throw new Error(`Invalid media ext: ${String(ext)}`);
  }
}

export function mediaKey(sha256, ext) {
  validateMediaParts(sha256, ext);
  return `media/${sha256}.${ext}`;
}

/** Validates a JSON storage key against path traversal, empty segments, and backslashes. */
export function validateJsonKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('Storage key must be a non-empty string');
  }
  if (key.includes('\0') || key.includes('\\') || key.startsWith('/')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  const segments = key.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`Invalid storage key: ${key}`);
    }
  }
}

/** Validates a key prefix for listJson against path traversal. */
export function validatePrefix(prefix) {
  if (typeof prefix !== 'string') {
    throw new Error('Storage prefix must be a string');
  }
  if (prefix.includes('\0') || prefix.includes('\\') || prefix.startsWith('/')) {
    throw new Error(`Invalid storage prefix: ${prefix}`);
  }
  for (const seg of prefix.split('/')) {
    if (seg === '.' || seg === '..') {
      throw new Error(`Invalid storage prefix: ${prefix}`);
    }
  }
}

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Normalizes an optional byte range { start, end } against total `size`.
 * Returns { start, end } inclusive, or throws RangeError if invalid.
 */
export function normalizeRange(size, { start, end } = {}) {
  if (size === 0) {
    if ((start !== undefined && start !== 0) || (end !== undefined && end < 0)) {
      throw new RangeError(`Invalid range [${start}, ${end}] for empty object`);
    }
    return { start: 0, end: -1 };
  }
  const s = start === undefined ? 0 : start;
  const e = end === undefined ? size - 1 : Math.min(end, size - 1);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s >= size || e < s) {
    throw new RangeError(`Invalid range [${start}, ${end}] for size ${size}`);
  }
  return { start: s, end: e };
}

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export function inferContentType(ext) {
  return MIME_BY_EXT[String(ext).toLowerCase()] ?? 'application/octet-stream';
}
