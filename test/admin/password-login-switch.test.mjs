import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAuth } from '../../src/admin-auth/index.mjs';

function fakeRes() {
  return { writeHead() {}, end() {} };
}

test('SISSI_PASSWORD_LOGIN=false blocks password login while AUTH_MODE=both', async () => {
  const auth = createAdminAuth({ authMode: 'both', adminPassword: 'correct-horse-battery', passwordLogin: false });
  await assert.rejects(
    () => auth.login({ headers: {} }, fakeRes(), { password: 'correct-horse-battery' }),
    (err) => err.code === 'UNAUTHORIZED' && /disabled/.test(err.message),
  );
  assert.equal(auth.hasAdminCookie({ headers: {} }), false);
});

test('password login stays on by default with AUTH_MODE=both', async () => {
  const auth = createAdminAuth({ authMode: 'both', adminPassword: 'correct-horse-battery' });
  let ok = false;
  await auth.login({ headers: {} }, { writeHead() { ok = true; }, end() {} }, { password: 'correct-horse-battery' });
  assert.equal(ok, true);
});
