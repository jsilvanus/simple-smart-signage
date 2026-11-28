import assert from 'node:assert/strict';
import test from 'node:test';
import { registerAdminUiRoutes } from '../../src/api/admin-ui.mjs';
import {
  apiUrl,
  buildScreenPayload,
  extractErrorMessage,
  formatAddedAt,
  previewUrl,
  reorderedEntryIds,
  resolveBasePath,
} from '../../public/admin/helpers.js';
import { http, startTestServer } from '../helpers/server.mjs';

async function setupUiServer(env = {}) {
  const srv = await startTestServer(env);
  registerAdminUiRoutes(srv.ctx.router, srv.ctx);
  return srv;
}

test('GET /admin and /admin/ serve index.html with no-cache and prefix-aware base href', async () => {
  const srv = await setupUiServer();
  try {
    for (const path of ['/admin', '/admin/', '/signage/admin', '/signage/admin/']) {
      const res = await http(srv.base, path);
      assert.equal(res.status, 200, `expected 200 for ${path}`);
      assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(res.headers.get('cache-control'), 'no-cache');
      assert.match(res.text, /<base href="\/signage\/admin\/">/);
      assert.match(res.text, /src="app\.js"/);
      assert.match(res.text, /href="style\.css"/);
    }

    const head = await http(srv.base, '/signage/admin', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('cache-control'), 'no-cache');
    assert.equal(head.text, '');
  } finally {
    await srv.close();
  }
});

test('GET /admin with empty SISSI_PUBLIC_PATH sets root /admin/ base href', async () => {
  const srv = await setupUiServer({ SISSI_PUBLIC_PATH: '' });
  try {
    const res = await http(srv.base, '/admin');
    assert.equal(res.status, 200);
    assert.match(res.text, /<base href="\/admin\/">/);
  } finally {
    await srv.close();
  }
});

test('static assets under /admin/* serve with 200, proper mime, no-cache, and reject traversal/missing', async () => {
  const srv = await setupUiServer();
  try {
    const js = await http(srv.base, '/signage/admin/app.js');
    assert.equal(js.status, 200);
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(js.headers.get('cache-control'), 'no-cache');
    assert.match(js.text, /X-Sissi-Admin/);

    const helpers = await http(srv.base, '/admin/helpers.js');
    assert.equal(helpers.status, 200);
    assert.equal(helpers.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(helpers.headers.get('cache-control'), 'no-cache');

    const css = await http(srv.base, '/signage/admin/style.css');
    assert.equal(css.status, 200);
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(css.headers.get('cache-control'), 'no-cache');

    const svg = await http(srv.base, '/signage/admin/sissi.svg');
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.equal(svg.headers.get('cache-control'), 'no-cache');

    const favicon = await http(srv.base, '/signage/favicon.ico');
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers.get('content-type'), 'image/svg+xml; charset=utf-8');

    const missing = await http(srv.base, '/signage/admin/does-not-exist.js');
    assert.equal(missing.status, 404);

    const traversal = await http(srv.base, '/admin/%2e%2e%2fpackage.json');
    assert.equal(traversal.status, 404);
  } finally {
    await srv.close();
  }
});

test('helpers: resolveBasePath, apiUrl, and previewUrl handle root and prefixed paths', () => {
  assert.equal(resolveBasePath('/admin'), '');
  assert.equal(resolveBasePath('/admin/'), '');
  assert.equal(resolveBasePath('/signage/admin'), '/signage');
  assert.equal(resolveBasePath('/signage/admin/'), '/signage');
  assert.equal(resolveBasePath('/a/b/admin/'), '/a/b');
  assert.equal(resolveBasePath('/signage/admin/index.html'), '/signage');

  assert.equal(apiUrl('', '/admin/login'), '/api/v1/admin/login');
  assert.equal(apiUrl('/signage', '/admin/login'), '/signage/api/v1/admin/login');
  assert.equal(apiUrl('/signage', 'admin/screens'), '/signage/api/v1/admin/screens');

  assert.equal(previewUrl('', 'lobby'), '/s/lobby');
  assert.equal(previewUrl('/signage', 'lobby-1'), '/signage/s/lobby-1');
});

test('helpers: buildScreenPayload, reorderedEntryIds, extractErrorMessage, formatAddedAt', () => {
  const createPayload = buildScreenPayload(
    {
      id: ' lobby ',
      name: ' Main Lobby ',
      orientation: 'landscape',
      width: '1920',
      height: '',
      defaultImageSeconds: '12',
      maxVideoSeconds: '',
    },
    { isCreate: true },
  );
  assert.deepEqual(createPayload, {
    id: 'lobby',
    name: 'Main Lobby',
    orientation: 'landscape',
    width: 1920,
    height: null,
    defaultImageSeconds: 12,
    maxVideoSeconds: null,
  });

  const editPayload = buildScreenPayload(
    {
      id: 'lobby',
      name: 'Side Hall',
      orientation: 'vertical',
      width: '',
      height: '1920',
      defaultImageSeconds: '8',
      maxVideoSeconds: '45',
    },
    { isCreate: false },
  );
  assert.equal('id' in editPayload, false);
  assert.deepEqual(editPayload, {
    name: 'Side Hall',
    orientation: 'vertical',
    width: null,
    height: 1920,
    defaultImageSeconds: 8,
    maxVideoSeconds: 45,
  });

  const entries = [{ entryId: 'e1' }, { entryId: 'e2' }, { entryId: 'e3' }];
  assert.equal(reorderedEntryIds(entries, 0, -1), null);
  assert.equal(reorderedEntryIds(entries, 2, 1), null);
  assert.deepEqual(reorderedEntryIds(entries, 0, 1), ['e2', 'e1', 'e3']);
  assert.deepEqual(reorderedEntryIds(entries, 2, -1), ['e1', 'e3', 'e2']);

  assert.equal(extractErrorMessage({ error: { message: 'Invalid password' } }, 'Fallback'), 'Invalid password');
  assert.equal(extractErrorMessage({}, 'Fallback'), 'Fallback');
  assert.equal(formatAddedAt(''), '');
  assert.ok(formatAddedAt('2026-11-19T10:00:00.000Z').length > 0);
});

test('GET / redirects to the admin page, respecting the public path', async () => {
  const srv = await setupUiServer();
  try {
    const res = await fetch(srv.base + '/', { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/signage/admin/');
  } finally {
    await srv.close();
  }
  const bare = await setupUiServer({ SISSI_PUBLIC_PATH: '' });
  try {
    const res = await fetch(bare.base + '/', { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/admin/');
  } finally {
    await bare.close();
  }
});
