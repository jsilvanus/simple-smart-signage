import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMemoryStorage } from '../../src/storage/index.mjs';
import { createState } from '../../src/state/index.mjs';
import { createAdminAuth } from '../../src/admin-auth/index.mjs';
import { registerAdminRoutes } from '../../src/api/admin.mjs';
import { registerPowerRoutes } from '../../src/api/power.mjs';
import { evaluateSchedule } from '../../src/power/schedule.mjs';
import { createPowerManager } from '../../src/power/manager.mjs';
import { http, startTestServer, testConfig } from '../helpers/server.mjs';

test('evaluateSchedule handles overrides, timezones, days, and overnight windows', () => {
  assert.equal(evaluateSchedule(null), null);
  assert.equal(evaluateSchedule({ driver: 'none', override: 'on' }), null);

  const basePower = {
    driver: 'samsung-lan',
    override: 'auto',
    schedule: {
      timezone: 'Europe/Helsinki',
      windows: [{ days: ['thu'], start: '08:00', end: '20:00' }],
    },
  };

  // 2026-11-19 is a Thursday. Helsinki is UTC+2 in November.
  // 06:00 UTC == 08:00 Helsinki -> on
  assert.equal(evaluateSchedule(basePower, new Date('2026-11-19T06:00:00Z')), 'on');
  // 05:59 UTC == 07:59 Helsinki -> off
  assert.equal(evaluateSchedule(basePower, new Date('2026-11-19T05:59:00Z')), 'off');
  // 17:59 UTC == 19:59 Helsinki -> on
  assert.equal(evaluateSchedule(basePower, new Date('2026-11-19T17:59:00Z')), 'on');
  // 18:00 UTC == 20:00 Helsinki -> off
  assert.equal(evaluateSchedule(basePower, new Date('2026-11-19T18:00:00Z')), 'off');
  // Friday -> off
  assert.equal(evaluateSchedule(basePower, new Date('2026-11-20T10:00:00Z')), 'off');

  // Overrides take precedence
  assert.equal(evaluateSchedule({ ...basePower, override: 'on' }, new Date('2026-11-20T10:00:00Z')), 'on');
  assert.equal(evaluateSchedule({ ...basePower, override: 'off' }, new Date('2026-11-19T10:00:00Z')), 'off');

  // Overnight window: Thursday 22:00 - 06:00 (UTC)
  const overnight = {
    driver: 'samsung-lan',
    override: 'auto',
    schedule: {
      timezone: 'UTC',
      windows: [{ days: ['thu'], start: '22:00', end: '06:00' }],
    },
  };
  assert.equal(evaluateSchedule(overnight, new Date('2026-11-19T22:00:00Z')), 'on');
  assert.equal(evaluateSchedule(overnight, new Date('2026-11-20T05:59:00Z')), 'on');
  assert.equal(evaluateSchedule(overnight, new Date('2026-11-20T06:00:00Z')), 'off');
});

test('power API: /desired, /report, and admin override + powerStatus', async (t) => {
  const storage = createMemoryStorage();
  const state = createState(storage);

  // Unconfigured agent tokens -> 503
  const unconfSrv = await startTestServer({ SISSI_AGENT_TOKENS: '' }, { storage, state });
  t.after(unconfSrv.close);
  const res503 = await http(unconfSrv.base, '/signage/api/v1/power/desired', {
    headers: { authorization: 'Bearer tok' },
  });
  assert.equal(res503.status, 503);
  assert.equal(res503.json.error.code, 'AUTH_NOT_CONFIGURED');

  // Configured server
  const fixedNow = new Date('2026-11-19T10:00:00Z'); // Thu 12:00 Helsinki
  const srv = await startTestServer(
    {
      SISSI_ADMIN_PASSWORD: 'admin-password-123',
      SISSI_AGENT_TOKENS: 'church-main:secret-main,other-lan:secret-other',
    },
    { storage, state, now: () => fixedNow },
  );
  t.after(srv.close);
  srv.ctx.adminAuth = createAdminAuth(srv.config);
  registerAdminRoutes(srv.ctx.router, srv.ctx);

  await state.createScreen({
    id: 'lobby',
    name: 'Lobby',
    power: {
      lanId: 'church-main',
      driver: 'samsung-lan',
      mac: 'AA:BB:CC:DD:EE:FF',
      ip: '192.168.10.42',
      override: 'auto',
      schedule: {
        timezone: 'Europe/Helsinki',
        windows: [{ days: ['thu'], start: '08:00', end: '20:00' }],
      },
    },
  });
  await state.createScreen({
    id: 'chapel',
    name: 'Chapel',
    power: {
      lanId: 'other-lan',
      driver: 'android-adb',
      mac: '11:22:33:44:55:66',
      ip: '192.168.20.10',
      override: 'off',
    },
  });
  await state.createScreen({
    id: 'push-managed',
    name: 'Push Managed',
    power: {
      lanId: 'church-main',
      routerId: 'mikrotik-1',
      driver: 'samsung-lan',
      mac: 'AA:BB:CC:DD:EE:01',
      ip: '192.168.10.43',
      override: 'on',
    },
  });

  // Bad token -> 401
  const badAuth = await http(srv.base, '/signage/api/v1/power/desired', {
    headers: { authorization: 'Bearer wrong' },
  });
  assert.equal(badAuth.status, 401);

  // Good token -> only church-main pull-style screens
  const desired = await http(srv.base, '/signage/api/v1/power/desired', {
    headers: { authorization: 'Bearer secret-main' },
  });
  assert.equal(desired.status, 200);
  assert.equal(desired.json.lanId, 'church-main');
  assert.equal(desired.json.devices.length, 1);
  assert.deepEqual(desired.json.devices[0], {
    screenId: 'lobby',
    driver: 'samsung-lan',
    mac: 'AA:BB:CC:DD:EE:FF',
    ip: '192.168.10.42',
    desiredState: 'on',
  });

  // Report reachability
  const reportRes = await http(srv.base, '/signage/api/v1/power/report', {
    method: 'POST',
    headers: { authorization: 'Bearer secret-main' },
    body: {
      devices: [{ screenId: 'lobby', reachable: true, lastAction: 'wake', error: null }],
    },
  });
  assert.equal(reportRes.status, 200);
  assert.equal(reportRes.json.recorded, 1);

  // Admin login + override + powerStatus
  const loginRes = await http(srv.base, '/signage/api/v1/admin/login', {
    method: 'POST',
    body: { password: 'admin-password-123' },
  });
  assert.equal(loginRes.status, 204);
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];

  const adminList = await http(srv.base, '/signage/api/v1/admin/screens', {
    headers: { cookie },
  });
  assert.equal(adminList.status, 200);
  const lobbyAdmin = adminList.json.screens.find((s) => s.id === 'lobby');
  assert.equal(lobbyAdmin.powerStatus.reachable, true);
  assert.equal(lobbyAdmin.powerStatus.lastAction, 'wake');

  const overrideRes = await http(srv.base, '/signage/api/v1/admin/screens/lobby/power/override', {
    method: 'POST',
    headers: { cookie, 'x-sissi-admin': '1' },
    body: { override: 'off' },
  });
  assert.equal(overrideRes.status, 200);
  assert.equal(overrideRes.json.power.override, 'off');

  const desiredAfter = await http(srv.base, '/signage/api/v1/power/desired', {
    headers: { authorization: 'Bearer secret-main' },
  });
  assert.equal(desiredAfter.json.devices[0].desiredState, 'off');
});

test('push-style power manager: webhook WoL, SSH WoL, Samsung WS off, ADB off, and idempotency', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sissi-power-test-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const storage = createMemoryStorage();
  const state = createState(storage);

  const config = testConfig({
    SISSI_POWER_DATA_DIR: dataDir,
    SISSI_POWER_ROUTERS: JSON.stringify({
      'r-webhook': {
        type: 'webhook',
        url: 'https://router.local/wol',
        method: 'POST',
        headers: { 'X-Token': 'abc' },
        bodyTemplate: '{"mac":"${mac}","screen":"${screenId}"}',
      },
      'r-ssh': {
        type: 'ssh',
        host: '192.168.1.1',
        user: 'admin',
        commandTemplate: '/tool wol mac=${mac}',
      },
    }),
  });

  await state.createScreen({
    id: 'tv-webhook',
    name: 'TV Webhook',
    power: {
      routerId: 'r-webhook',
      driver: 'samsung-lan',
      mac: 'AA:BB:CC:DD:EE:01',
      ip: '192.168.10.51',
      override: 'on',
    },
  });
  await state.createScreen({
    id: 'tv-ssh',
    name: 'TV SSH',
    power: {
      routerId: 'r-ssh',
      driver: 'android-adb',
      mac: 'AA:BB:CC:DD:EE:02',
      ip: '192.168.10.52',
      override: 'on',
    },
  });

  const fetchCalls = [];
  const execCalls = [];
  const wsSent = [];
  let reachableMap = {
    '192.168.10.51': false,
    '192.168.10.52': false,
  };

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      setTimeout(() => {
        this.emit('message', {
          data: JSON.stringify({ event: 'ms.channel.connect', data: { token: 'saved-tok-123' } }),
        });
      }, 5);
    }
    addEventListener(ev, fn) {
      if (!this.listeners.has(ev)) this.listeners.set(ev, []);
      this.listeners.get(ev).push(fn);
    }
    emit(ev, payload) {
      for (const fn of this.listeners.get(ev) ?? []) fn(payload);
    }
    send(data) {
      wsSent.push({ url: this.url, data: JSON.parse(data) });
    }
    close() {}
  }

  const manager = createPowerManager({
    config,
    state,
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      return { ok: true, status: 200 };
    },
    execFile: async (cmd, args) => {
      execCalls.push({ cmd, args });
      return { stdout: '', stderr: '' };
    },
    probe: async (ip) => Boolean(reachableMap[ip]),
    WebSocketImpl: FakeWebSocket,
  });

  // 1. Both unreachable & desired=on -> webhook WoL + SSH WoL
  await manager.tick();
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://router.local/wol');
  assert.equal(fetchCalls[0].init.body, '{"mac":"AA:BB:CC:DD:EE:01","screen":"tv-webhook"}');
  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0].cmd, 'ssh');
  assert.ok(execCalls[0].args.includes('/tool wol mac=AA:BB:CC:DD:EE:02'));

  // 2. Now both reachable & desired=on -> idempotent (no wake calls)
  reachableMap['192.168.10.51'] = true;
  reachableMap['192.168.10.52'] = true;
  await manager.tick();
  assert.equal(fetchCalls.length, 1);
  assert.equal(execCalls.length, 1);

  // 3. Switch both to override=off while reachable -> Samsung WS KEY_POWER + ADB KEYCODE_SLEEP
  await state.setPowerOverride('tv-webhook', 'off');
  await state.setPowerOverride('tv-ssh', 'off');
  await manager.tick();
  assert.equal(wsSent.length, 1);
  assert.equal(wsSent[0].data.params.DataOfCmd, 'KEY_POWER');
  const tokensRaw = await fs.readFile(path.join(dataDir, 'tokens.json'), 'utf8');
  assert.equal(JSON.parse(tokensRaw)['192.168.10.51'], 'saved-tok-123');

  assert.equal(execCalls.length, 3);
  assert.deepEqual(execCalls[1], { cmd: 'adb', args: ['connect', '192.168.10.52:5555'] });
  assert.deepEqual(execCalls[2], {
    cmd: 'adb',
    args: ['-s', '192.168.10.52:5555', 'shell', 'input', 'keyevent', 'KEYCODE_SLEEP'],
  });

  // 4. Now both unreachable & desired=off -> idempotent (no sleep calls)
  reachableMap['192.168.10.51'] = false;
  reachableMap['192.168.10.52'] = false;
  await manager.tick();
  assert.equal(wsSent.length, 1);
  assert.equal(execCalls.length, 3);
});
