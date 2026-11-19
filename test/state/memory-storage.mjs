export class StorageConflictError extends Error {
  constructor(message = 'Storage CAS conflict') {
    super(message);
    this.name = 'StorageConflictError';
    this.code = 'STORAGE_CONFLICT';
  }
}

/**
 * Minimal in-memory implementation of the Storage interface for state unit tests.
 */
export function createMemoryStorage() {
  const json = new Map();
  const media = new Map();
  let seq = 0;

  function mediaKey(sha256, ext) {
    return `${sha256}.${ext}`;
  }

  return {
    async getJson(key) {
      const rec = json.get(key);
      if (!rec) return null;
      return { value: structuredClone(rec.value), etag: rec.etag };
    },

    async putJson(key, value, { ifMatch } = {}) {
      const existing = json.get(key);
      if (ifMatch === null) {
        if (existing) throw new StorageConflictError(`Key already exists: ${key}`);
      } else if (ifMatch !== undefined) {
        if (!existing || existing.etag !== ifMatch) {
          throw new StorageConflictError(`ETag mismatch for ${key}`);
        }
      }
      const etag = `etag-${++seq}`;
      json.set(key, { value: structuredClone(value), etag });
      return { etag };
    },

    async deleteJson(key) {
      json.delete(key);
    },

    async listJson(prefix = '') {
      return [...json.keys()].filter((k) => k.startsWith(prefix)).sort();
    },

    seedMedia(sha256, ext, { size = 100, contentType = 'image/png', lastModified = new Date() } = {}) {
      media.set(mediaKey(sha256, ext), {
        sha256,
        ext,
        size,
        contentType,
        lastModified: lastModified instanceof Date ? lastModified : new Date(lastModified),
      });
    },

    async statMedia(sha256, ext) {
      const m = media.get(mediaKey(sha256, ext));
      if (!m) return null;
      return { size: m.size, contentType: m.contentType, lastModified: m.lastModified };
    },

    async deleteMedia(sha256, ext) {
      media.delete(mediaKey(sha256, ext));
    },

    async *listMedia() {
      for (const m of media.values()) {
        yield { sha256: m.sha256, ext: m.ext, size: m.size, lastModified: m.lastModified };
      }
    },
  };
}
