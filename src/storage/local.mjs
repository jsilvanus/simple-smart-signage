import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  StorageConflictError,
  inferContentType,
  mediaKey,
  normalizeRange,
  sha256Hex,
  validateJsonKey,
  validateMediaParts,
  validatePrefix,
} from './common.mjs';

const META_DIR = '.sissi-meta';

function makeKeyLock() {
  const tails = new Map();
  return async function withLock(key, fn) {
    const prev = tails.get(key) ?? Promise.resolve();
    let release;
    const next = new Promise((r) => (release = r));
    tails.set(key, next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(key) === next) tails.delete(key);
    }
  };
}

async function writeAtomic(targetPath, data) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, targetPath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

async function copyAtomic(srcPath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.copyFile(srcPath, tmpPath);
    await fs.rename(tmpPath, targetPath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/** Local filesystem Storage driver with atomic temp+rename writes and sha256 ETags. */
export function createLocalStorage(localDir) {
  if (!localDir) throw new Error('localDir is required for local storage');
  const rootDir = path.resolve(localDir);
  const withLock = makeKeyLock();

  function resolveSafe(relKey) {
    const full = path.resolve(rootDir, relKey);
    if (full !== rootDir && !full.startsWith(rootDir + path.sep)) {
      throw new Error(`Path escapes storage root: ${relKey}`);
    }
    return full;
  }

  function mediaMetaPath(sha256, ext) {
    return resolveSafe(path.join(META_DIR, `${sha256}.${ext}.json`));
  }

  async function readContentType(sha256, ext) {
    try {
      const raw = await fs.readFile(mediaMetaPath(sha256, ext), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.contentType === 'string') return parsed.contentType;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return inferContentType(ext);
  }

  return {
    async putMediaFromFile(sha256, ext, filePath, contentType) {
      const key = mediaKey(sha256, ext);
      const target = resolveSafe(key);
      try {
        const st = await fs.stat(target);
        return { key, size: st.size };
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      await writeAtomic(
        mediaMetaPath(sha256, ext),
        JSON.stringify({ contentType: contentType || 'application/octet-stream' }),
      );
      await copyAtomic(filePath, target);
      const st = await fs.stat(target);
      return { key, size: st.size };
    },

    async getMedia(sha256, ext, range = {}) {
      const key = mediaKey(sha256, ext);
      const target = resolveSafe(key);
      let st;
      try {
        st = await fs.stat(target);
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
      const { start, end } = normalizeRange(st.size, range);
      const contentType = await readContentType(sha256, ext);
      const stream = st.size === 0 ? Readable.from([]) : createReadStream(target, { start, end });
      return { stream, size: st.size, contentType, start, end };
    },

    async statMedia(sha256, ext) {
      const key = mediaKey(sha256, ext);
      const target = resolveSafe(key);
      let st;
      try {
        st = await fs.stat(target);
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
      const contentType = await readContentType(sha256, ext);
      return { size: st.size, contentType, lastModified: st.mtime };
    },

    async deleteMedia(sha256, ext) {
      const key = mediaKey(sha256, ext);
      await fs.unlink(resolveSafe(key)).catch((err) => {
        if (err.code !== 'ENOENT') throw err;
      });
      await fs.unlink(mediaMetaPath(sha256, ext)).catch((err) => {
        if (err.code !== 'ENOENT') throw err;
      });
    },

    async *listMedia() {
      const mediaDir = resolveSafe('media');
      let entries;
      try {
        entries = await fs.readdir(mediaDir, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.includes('.tmp-')) continue;
        const dot = entry.name.lastIndexOf('.');
        if (dot <= 0 || dot === entry.name.length - 1) continue;
        const sha256 = entry.name.slice(0, dot);
        const ext = entry.name.slice(dot + 1);
        try {
          validateMediaParts(sha256, ext);
        } catch {
          continue;
        }
        try {
          const st = await fs.stat(path.join(mediaDir, entry.name));
          yield { sha256, ext, size: st.size, lastModified: st.mtime };
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
    },

    async getJson(key) {
      validateJsonKey(key);
      const target = resolveSafe(key);
      let text;
      try {
        text = await fs.readFile(target, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
      return { value: JSON.parse(text), etag: sha256Hex(text) };
    },

    async putJson(key, value, { ifMatch } = {}) {
      validateJsonKey(key);
      const target = resolveSafe(key);
      return withLock(key, async () => {
        if (ifMatch !== undefined) {
          let existingText = null;
          try {
            existingText = await fs.readFile(target, 'utf8');
          } catch (err) {
            if (err.code !== 'ENOENT') throw err;
          }
          if (ifMatch === null) {
            if (existingText !== null) {
              throw new StorageConflictError(`Key already exists: ${key}`);
            }
          } else {
            if (existingText === null || sha256Hex(existingText) !== ifMatch) {
              throw new StorageConflictError(`ETag mismatch for key: ${key}`);
            }
          }
        }
        const text = JSON.stringify(value);
        const etag = sha256Hex(text);
        await writeAtomic(target, text);
        return { etag };
      });
    },

    async deleteJson(key) {
      validateJsonKey(key);
      await fs.unlink(resolveSafe(key)).catch((err) => {
        if (err.code !== 'ENOENT') throw err;
      });
    },

    async listJson(prefix = '') {
      validatePrefix(prefix);
      const keys = [];
      async function walk(dir, relBase) {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (err) {
          if (err.code === 'ENOENT') return;
          throw err;
        }
        for (const entry of entries) {
          if (relBase === '' && (entry.name === META_DIR || entry.name === 'media')) continue;
          if (entry.name.includes('.tmp-')) continue;
          const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full, rel);
          } else if (entry.isFile() && rel.startsWith(prefix)) {
            keys.push(rel);
          }
        }
      }
      await walk(rootDir, '');
      keys.sort();
      return keys;
    },
  };
}
