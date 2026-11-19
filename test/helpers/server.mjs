import { loadConfig } from '../../src/config.mjs';
import { createServer } from '../../src/server.mjs';

/** Config for tests: defaults + overrides (env-style strings). */
export function testConfig(env = {}) {
  return loadConfig({ NODE_ENV: 'test', ...env });
}

/**
 * Starts a server on port 0. Returns { server, ctx, base, close }.
 * `base` has no trailing slash, e.g. http://127.0.0.1:41234
 */
export async function startTestServer(env = {}, deps = {}) {
  const config = testConfig(env);
  const server = createServer(config, deps);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    config,
    ctx: server.ctx,
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

/** fetch wrapper: returns { status, headers, text, json }. */
export async function http(base, path, { method = 'GET', headers = {}, body } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (typeof body === 'string' || Buffer.isBuffer(body)) init.body = body;
    else {
      init.body = JSON.stringify(body);
      init.headers['content-type'] ??= 'application/json';
    }
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json };
}
