import { StorageConflictError } from './common.mjs';
import { createLocalStorage } from './local.mjs';
import { createMemoryStorage } from './memory.mjs';
import { createS3Storage } from './s3.mjs';

export { StorageConflictError, createMemoryStorage };

/** Creates a Storage driver from `config.storage`. */
export function createStorage(storageConfig, opts = {}) {
  if (!storageConfig || typeof storageConfig !== 'object') {
    throw new Error('storageConfig is required');
  }
  if (storageConfig.kind === 'local') {
    return createLocalStorage(storageConfig.localDir);
  }
  if (storageConfig.kind === 's3') {
    return createS3Storage(storageConfig.s3, opts);
  }
  throw new Error(`Unknown storage kind: ${String(storageConfig.kind)}`);
}
