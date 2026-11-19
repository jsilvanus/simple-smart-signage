import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  StorageConflictError,
  mediaKey,
  normalizeRange,
  sha256Hex,
  validateJsonKey,
  validateMediaParts,
  validatePrefix,
} from './common.mjs';

/** In-memory Storage implementation with identical semantics to local and S3 drivers. */
export function createMemoryStorage() {
  const media = new Map(); // key -> { sha256, ext, buffer, contentType, lastModified }
  const json = new Map();  // key -> { text, etag }

  return {
    async putMediaFromFile(sha256, ext, filePath, contentType) {
      const key = mediaKey(sha256, ext);
      const existing = media.get(key);
      if (existing) {
        return { key, size: existing.buffer.length };
      }
      const buffer = await fs.readFile(filePath);
      media.set(key, {
        sha256,
        ext,
        buffer,
        contentType: contentType || 'application/octet-stream',
        lastModified: new Date(),
      });
      return { key, size: buffer.length };
    },

    async getMedia(sha256, ext, range = {}) {
      const key = mediaKey(sha256, ext);
      const entry = media.get(key);
      if (!entry) return null;
      const size = entry.buffer.length;
      const { start, end } = normalizeRange(size, range);
      const slice = size === 0 ? Buffer.alloc(0) : entry.buffer.subarray(start, end + 1);
      return {
        stream: Readable.from([slice]),
        size,
        contentType: entry.contentType,
        start,
        end,
      };
    },

    async statMedia(sha256, ext) {
      const key = mediaKey(sha256, ext);
      const entry = media.get(key);
      if (!entry) return null;
      return {
        size: entry.buffer.length,
        contentType: entry.contentType,
        lastModified: new Date(entry.lastModified),
      };
    },

    async deleteMedia(sha256, ext) {
      const key = mediaKey(sha256, ext);
      media.delete(key);
    },

    async *listMedia() {
      for (const entry of media.values()) {
        yield {
          sha256: entry.sha256,
          ext: entry.ext,
          size: entry.buffer.length,
          lastModified: new Date(entry.lastModified),
        };
      }
    },

    async getJson(key) {
      validateJsonKey(key);
      const entry = json.get(key);
      if (!entry) return null;
      return { value: JSON.parse(entry.text), etag: entry.etag };
    },

    async putJson(key, value, { ifMatch } = {}) {
      validateJsonKey(key);
      const existing = json.get(key);
      if (ifMatch === null) {
        if (existing) throw new StorageConflictError(`Key already exists: ${key}`);
      } else if (ifMatch !== undefined) {
        if (!existing || existing.etag !== ifMatch) {
          throw new StorageConflictError(`ETag mismatch for key: ${key}`);
        }
      }
      const text = JSON.stringify(value);
      const etag = sha256Hex(text);
      json.set(key, { text, etag });
      return { etag };
    },

    async deleteJson(key) {
      validateJsonKey(key);
      json.delete(key);
    },

    async listJson(prefix = '') {
      validatePrefix(prefix);
      const keys = [];
      for (const key of json.keys()) {
        if (key.startsWith(prefix)) keys.push(key);
      }
      keys.sort();
      return keys;
    },
  };
}
