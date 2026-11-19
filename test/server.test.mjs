import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, http } from './helpers/server.mjs';
import { sendError, HttpError, ERROR_STATUS } from '../src/router.mjs';
import { readFileSync } from 'node:fs';

test('health works with and without prefix', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  for (const p of ['/health', '/signage/health']) {
    const r = await http(s.base, p);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
  }
});

test('custom public path', async (t) => {
  const s = await startTestServer({ SISSI_PUBLIC_PATH: '/foo' });
  t.after(s.close);
  assert.equal((await http(s.base, '/foo/health')).status, 200);
  assert.equal((await http(s.base, '/health')).status, 200);
  assert.equal((await http(s.base, '/signage/health')).status, 404);
  assert.equal(s.ctx.router.url('/media/a.png'), '/foo/media/a.png');
});

test('empty public path', async (t) => {
  const s = await startTestServer({ SISSI_PUBLIC_PATH: '/' });
  t.after(s.close);
  assert.equal((await http(s.base, '/health')).status, 200);
  assert.equal(s.ctx.router.url('/x'), '/x');
});

test('prefix only matches on segment boundary', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  assert.equal((await http(s.base, '/signagehealth')).status, 404);
});

test('error shape: 404 and 405', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const nf = await http(s.base, '/nope');
  assert.equal(nf.status, 404);
  assert.equal(nf.json.error.code, 'NOT_FOUND');
  assert.equal(typeof nf.json.error.message, 'string');
  const mna = await http(s.base, '/health', { method: 'POST', body: {} });
  assert.equal(mna.status, 405);
  assert.equal(mna.json.error.code, 'METHOD_NOT_ALLOWED');
});

test('params, JSON body, size cap, invalid JSON, thrown errors', async (t) => {
  const s = await startTestServer({ SISSI_MAX_BODY_KB: '1' });
  t.after(s.close);
  const { router } = s.ctx;
  router.post('/echo/:id', async (req, res, { params }) => {
    const body = await router.readJson(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: params.id, body }));
  });
  router.get('/boom', () => {
    throw new Error('secret detail');
  });
  router.get('/teapot', () => {
    throw new HttpError('SCREEN_NOT_FOUND', 'Unknown screen: lobby');
  });
  const ok = await http(s.base, '/signage/echo/a%20b', { method: 'POST', body: { x: 1 } });
  assert.deepEqual(ok.json, { id: 'a b', body: { x: 1 } });
  const bad = await http(s.base, '/echo/1', { method: 'POST', body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'INVALID_JSON');
  const big = await http(s.base, '/echo/1', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(2000) }) });
  assert.equal(big.status, 413);
  assert.equal(big.json.error.code, 'PAYLOAD_TOO_LARGE');
  const boom = await http(s.base, '/boom');
  assert.equal(boom.status, 500);
  assert.equal(boom.json.error.code, 'INTERNAL');
  assert.ok(!boom.text.includes('secret'));
  const nf = await http(s.base, '/teapot');
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.json, { error: { code: 'SCREEN_NOT_FOUND', message: 'Unknown screen: lobby' } });
});

test('ERROR_STATUS covers exactly the OpenAPI ErrorCode enum', () => {
  const yaml = readFileSync(new URL('../openapi/sissi-v1.yaml', import.meta.url), 'utf8');
  const block = yaml.split('ErrorCode:')[1].split('Error:')[0];
  const codes = [...block.matchAll(/^\s+- ([A-Z_]+)$/gm)].map((m) => m[1]);
  assert.ok(codes.length > 10);
  assert.deepEqual(Object.keys(ERROR_STATUS).sort(), codes.sort());
});

test('sendError writes the documented shape', () => {
  let head, body;
  const res = { headersSent: false, writeHead: (s, h) => (head = [s, h]), end: (b) => (body = b) };
  sendError(res, 'BUSY', 'too many');
  assert.equal(head[0], 429);
  assert.deepEqual(JSON.parse(body), { error: { code: 'BUSY', message: 'too many' } });
});

test('metrics: auth, text format, counters', async (t) => {
  const s = await startTestServer({ METRICS_BEARER_TOKEN: 'tok' });
  t.after(s.close);
  await http(s.base, '/health');
  const none = await http(s.base, '/metrics');
  assert.equal(none.status, 401);
  assert.equal(none.json.error.code, 'UNAUTHORIZED');
  assert.equal((await http(s.base, '/metrics', { headers: { authorization: 'Bearer nope' } })).status, 401);
  const ok = await http(s.base, '/signage/metrics', { headers: { authorization: 'Bearer tok' } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /^text\/plain/);
  assert.match(ok.text, /# TYPE sissi_http_requests_total counter/);
  assert.match(ok.text, /sissi_http_requests_total\{method="GET",route="\/health",status="200"\} 1/);
});

test('metrics not configured -> 503', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const r = await http(s.base, '/metrics', { headers: { authorization: 'Bearer x' } });
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, 'AUTH_NOT_CONFIGURED');
});
