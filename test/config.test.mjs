import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError, normalizePublicPath } from '../src/config.mjs';

test('defaults', () => {
  const c = loadConfig({});
  assert.equal(c.port, 3000);
  assert.equal(c.publicPath, '/signage');
  assert.deepEqual(c.downloadHosts, ['canva.com', 'canva.dev', 'canva-apps.com']);
  assert.equal(c.storage.kind, 'local');
  assert.equal(c.limits.imageBytes, 40 * 1024 * 1024);
  assert.equal(c.limits.videoBytes, 500 * 1024 * 1024);
  assert.equal(c.limits.pushBytes, 1024 * 1024 * 1024);
  assert.equal(c.limits.maxConcurrentPushes, 3);
  assert.equal(c.swMaxVideoMb, 100);
  assert.equal(c.gcGraceMinutes, 60);
  assert.equal(c.allowPrivateDownloads, false);
});

test('parses lists and values', () => {
  const c = loadConfig({
    SISSI_CANVA_ALLOWED_BRANDS: 'a, b ,',
    SISSI_CORS_ORIGINS: 'https://app.canva.com',
    SISSI_PUBLIC_PATH: 'x/',
    SISSI_MAX_IMAGE_MB: '5',
    SISSI_PUSH_KEY: 'k',
  });
  assert.deepEqual(c.canva.allowedBrands, ['a', 'b']);
  assert.deepEqual(c.corsOrigins, ['https://app.canva.com']);
  assert.equal(c.publicPath, '/x');
  assert.equal(c.limits.imageBytes, 5 * 1024 * 1024);
  assert.equal(c.pushKey, 'k');
});

test('empty public path means root', () => {
  assert.equal(loadConfig({ SISSI_PUBLIC_PATH: '' }).publicPath, '');
  assert.equal(normalizePublicPath('/'), '');
  assert.equal(normalizePublicPath('/signage/'), '/signage');
});

test('validation collects problems', () => {
  assert.throws(
    () => loadConfig({ SISSI_STORAGE: 'ftp', PORT: 'abc', SISSI_CORS_ORIGINS: 'https://a.b/path' }),
    (e) => e instanceof ConfigError && e.problems.length === 3,
  );
});

test('s3 requires bucket and keys', () => {
  assert.throws(() => loadConfig({ SISSI_STORAGE: 's3' }), (e) => e.problems.length === 3);
  const c = loadConfig({ SISSI_STORAGE: 's3', SISSI_S3_BUCKET: 'b', SISSI_S3_ACCESS_KEY_ID: 'i', SISSI_S3_SECRET_ACCESS_KEY: 's' });
  assert.equal(c.storage.s3.bucket, 'b');
});

test('private downloads refused in production', () => {
  assert.equal(loadConfig({ SISSI_ALLOW_PRIVATE_DOWNLOADS: '1' }).allowPrivateDownloads, true);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', SISSI_ALLOW_PRIVATE_DOWNLOADS: '1' }), ConfigError);
});

