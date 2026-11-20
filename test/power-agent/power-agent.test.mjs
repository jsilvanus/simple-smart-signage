import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

import { buildMagicPacket, sendWol } from '../../clients/power-agent/src/wol.mjs';
import { probeTcp } from '../../clients/power-agent/src/probe.mjs';
import { pairSamsung, sendSamsungKey } from '../../clients/power-agent/src/samsung.mjs';
import { pairAdb, sleepAndroidTv } from '../../clients/power-agent/src/adb.mjs';
import { createPowerAgent } from '../../clients/power-agent/src/agent.mjs';
import { loadTokens, saveSamsungToken } from '../../clients/power-agent/src/tokens.mjs';

// --- Minimal pure-Node self-signed X.509 cert generator for TLS tests ---
function derLen(len) {
  if (len < 128) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

function derSeq(...items) {
  return derTag(0x30, Buffer.concat(items));
}

function derSet(...items) {
  return derTag(0x31, Buffer.concat(items));
}

function derInt(num) {
  let buf = Buffer.from(num.toString(16).padStart(2, '0'), 'hex');
  if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0x00]), buf]);
  return derTag(0x02, buf);
}

function derOid(bytes) {
  return derTag(0x06, Buffer.from(bytes));
}

function createSelfSignedCert() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  // sha256WithRSAEncryption: 1.2.840.113549.1.1.11
  const sigAlg = derSeq(derOid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]), Buffer.from([0x05, 0x00]));
  // CN=localhost (2.5.4.3)
  const name = derSeq(derSet(derSeq(derOid([0x55, 0x04, 0x03]), derTag(0x0c, Buffer.from('localhost')))));
  const validity = derSeq(
    derTag(0x17, Buffer.from('200101000000Z')),
    derTag(0x17, Buffer.from('491231235959Z')),
  );
  const version = derTag(0xa0, derInt(2));
  const tbs = derSeq(version, derInt(1), sigAlg, name, validity, name, spki);
  const sig = crypto.sign('sha256', tbs, privateKey);
  const certDer = derSeq(tbs, sigAlg, derTag(0x03, Buffer.concat([Buffer.from([0x00]), sig])));
  const certPem = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  return { cert: certPem, key: keyPem };
}

// --- Minimal RFC 6455 server helpers for fake Samsung TV ---
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeServerTextFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeClientFrame(buf) {
  if (buf.length < 6) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 8) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return null;
  const payload = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
  if (masked) {
    const mask = buf.subarray(offset, offset + 4);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }
  return { opcode, payload, rest: buf.subarray(offset + maskLen + len) };
}

function startFakeSamsungServer({ connectEvent = { event: 'ms.channel.connect', data: { token: '99887766' } } } = {}) {
  const { cert, key } = createSelfSignedCert();
  const requests = [];
  const receivedCommands = [];

  const server = tls.createServer({ cert, key }, (socket) => {
    let handshakeDone = false;
    let buf = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshakeDone) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = buf.subarray(0, idx).toString('latin1');
        buf = buf.subarray(idx + 4);
        const lines = head.split('\r\n');
        requests.push(lines[0]);
        const keyLine = lines.find((l) => l.toLowerCase().startsWith('sec-websocket-key:'));
        const wsKey = keyLine.split(':')[1].trim();
        const accept = crypto.createHash('sha1').update(wsKey + WS_GUID).digest('base64');
        socket.write(
          [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${accept}`,
            '',
            '',
          ].join('\r\n'),
        );
        handshakeDone = true;
        socket.write(encodeServerTextFrame(connectEvent));
      }

      while (true) {
        const frame = decodeClientFrame(buf);
        if (!frame) break;
        buf = frame.rest;
        if (frame.opcode === 0x1) {
          receivedCommands.push(JSON.parse(frame.payload.toString('utf8')));
        } else if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        requests,
        receivedCommands,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// --- Tests ---

test('buildMagicPacket builds 102-byte WoL packet and validates MAC', () => {
  const pkt1 = buildMagicPacket('AA:BB:CC:DD:EE:FF');
  const pkt2 = buildMagicPacket('aa-bb-cc-dd-ee-ff');
  const pkt3 = buildMagicPacket('aabbccddeeff');

  assert.equal(pkt1.length, 102);
  assert.deepEqual(pkt1, pkt2);
  assert.deepEqual(pkt1, pkt3);
  assert.deepEqual(pkt1.subarray(0, 6), Buffer.alloc(6, 0xff));
  const macBytes = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  for (let i = 0; i < 16; i++) {
    assert.deepEqual(pkt1.subarray(6 + i * 6, 12 + i * 6), macBytes);
  }

  for (const bad of ['', null, undefined, 'AA:BB:CC:DD:EE', 'ZZ:BB:CC:DD:EE:FF', 'AA:BB-CC:DD:EE:FF']) {
    assert.throws(() => buildMagicPacket(bad));
  }
});

test('sendWol sends configured count of UDP broadcast packets', async () => {
  const sent = [];
  let broadcastEnabled = false;
  let closed = false;

  const mockDgram = {
    createSocket(type) {
      assert.equal(type, 'udp4');
      return {
        once() {},
        removeListener() {},
        bind(_port, cb) {
          cb();
        },
        setBroadcast(val) {
          broadcastEnabled = val;
        },
        send(buf, offset, length, port, addr, cb) {
          sent.push({ buf: Buffer.from(buf.subarray(offset, offset + length)), port, addr });
          cb(null);
        },
        close() {
          closed = true;
        },
      };
    },
  };

  await sendWol('AA:BB:CC:DD:EE:FF', { count: 3, dgram: mockDgram });
  assert.equal(broadcastEnabled, true);
  assert.equal(closed, true);
  assert.equal(sent.length, 3);
  assert.equal(sent[0].port, 9);
  assert.equal(sent[0].addr, '255.255.255.255');
  assert.equal(sent[0].buf.length, 102);
});

test('probeTcp detects open vs closed ports', async () => {
  const srv = net.createServer((s) => s.destroy());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();

  try {
    assert.equal(await probeTcp('127.0.0.1', [port], 500), true);
    assert.equal(await probeTcp('127.0.0.1', [port + 1], 200), false);
    assert.equal(await probeTcp('', [port], 200), false);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('Samsung TLS-WS client pairs and sends KEY_POWER', async () => {
  const tv = await startFakeSamsungServer({
    connectEvent: { event: 'ms.channel.connect', data: { token: 'tok-123' } },
  });
  try {
    const paired = await pairSamsung('127.0.0.1', { port: tv.port, timeoutMs: 2000 });
    assert.equal(paired.token, 'tok-123');

    const sent = await sendSamsungKey('127.0.0.1', {
      port: tv.port,
      token: 'old-tok',
      key: 'KEY_POWER',
      timeoutMs: 2000,
    });
    assert.equal(sent.token, 'tok-123');
    assert.match(tv.requests[1], /token=old-tok/);
    assert.equal(tv.receivedCommands.length, 1);
    assert.equal(tv.receivedCommands[0].params.DataOfCmd, 'KEY_POWER');
  } finally {
    await tv.close();
  }
});

test('Samsung TLS-WS client rejects on ms.channel.unauthorized', async () => {
  const tv = await startFakeSamsungServer({
    connectEvent: { event: 'ms.channel.unauthorized' },
  });
  try {
    await assert.rejects(
      () => sendSamsungKey('127.0.0.1', { port: tv.port, timeoutMs: 2000 }),
      /unauthorized/i,
    );
  } finally {
    await tv.close();
  }
});

test('ADB helper connects and sends KEYCODE_SLEEP, and detects connect failures', async () => {
  const calls = [];
  const mockExec = async (file, args) => {
    calls.push([file, args]);
    return { stdout: 'connected to 192.168.1.50:5555', stderr: '' };
  };

  await sleepAndroidTv('192.168.1.50', { execFile: mockExec });
  assert.deepEqual(calls, [
    ['adb', ['connect', '192.168.1.50:5555']],
    ['adb', ['-s', '192.168.1.50:5555', 'shell', 'input', 'keyevent', 'KEYCODE_SLEEP']],
  ]);

  const failExec = async () => ({ stdout: 'failed to connect to 192.168.1.50:5555', stderr: '' });
  await assert.rejects(() => pairAdb('192.168.1.50', { execFile: failExec }), /ADB connect failed/);
});

test('Power agent: wake when off, sleep when on, idempotent no-op, and token persistence', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sissi-power-test-'));
  try {
    await saveSamsungToken(dataDir, '10.0.0.11', 'saved-tok');

    const wolCalls = [];
    const samsungCalls = [];
    const adbCalls = [];
    const reports = [];

    let desiredDevices = [
      // Unreachable + desired on -> WoL
      { screenId: 's1', driver: 'samsung-lan', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.10', desiredState: 'on' },
      // Reachable + desired off (Samsung) -> KEY_POWER with saved token, returns rotated token
      { screenId: 's2', driver: 'samsung-lan', mac: 'AA:BB:CC:DD:EE:02', ip: '10.0.0.11', desiredState: 'off' },
      // Reachable + desired off (Android) -> ADB sleep
      { screenId: 's3', driver: 'android-adb', mac: 'AA:BB:CC:DD:EE:03', ip: '10.0.0.12', desiredState: 'off' },
      // Reachable + desired on -> no-op
      { screenId: 's4', driver: 'samsung-lan', mac: 'AA:BB:CC:DD:EE:04', ip: '10.0.0.13', desiredState: 'on' },
      // Unreachable + desired off -> no-op (MUST NOT send KEY_POWER!)
      { screenId: 's5', driver: 'samsung-lan', mac: 'AA:BB:CC:DD:EE:05', ip: '10.0.0.14', desiredState: 'off' },
    ];

    const reachability = {
      '10.0.0.10': false,
      '10.0.0.11': true,
      '10.0.0.12': true,
      '10.0.0.13': true,
      '10.0.0.14': false,
    };

    const agent = createPowerAgent(
      { sissiUrl: 'https://sissi.test', agentToken: 'secret-token', dataDir },
      {
        fetch: async (url, opts) => {
          assert.equal(opts.headers.Authorization, 'Bearer secret-token');
          if (url.endsWith('/api/v1/power/desired')) {
            return { ok: true, json: async () => ({ devices: desiredDevices }) };
          }
          if (url.endsWith('/api/v1/power/report')) {
            reports.push(JSON.parse(opts.body));
            return { ok: true, json: async () => ({ ok: true }) };
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
        probeTcp: async (ip) => Boolean(reachability[ip]),
        sendWol: async (mac) => wolCalls.push(mac),
        sendSamsungKey: async (ip, opts) => {
          samsungCalls.push({ ip, ...opts });
          return { token: 'rotated-tok' };
        },
        sleepAndroidTv: async (ip) => adbCalls.push(ip),
        logger: { warn() {}, error() {} },
      },
    );

    const res1 = await agent.tick();
    assert.equal(res1.ok, true);
    assert.deepEqual(wolCalls, ['AA:BB:CC:DD:EE:01']);
    assert.deepEqual(samsungCalls, [{ ip: '10.0.0.11', token: 'saved-tok', key: 'KEY_POWER' }]);
    assert.deepEqual(adbCalls, ['10.0.0.12']);
    assert.deepEqual(
      reports[0].devices.map((d) => [d.screenId, d.lastAction]),
      [
        ['s1', 'wol'],
        ['s2', 'samsung-power-off'],
        ['s3', 'adb-sleep'],
        ['s4', 'none'],
        ['s5', 'none'],
      ],
    );

    // Verify rotated token was persisted and is used on next tick
    const tokens = await loadTokens(dataDir);
    assert.equal(tokens.samsung['10.0.0.11'], 'rotated-tok');

    desiredDevices = [
      { screenId: 's2', driver: 'samsung-lan', mac: 'AA:BB:CC:DD:EE:02', ip: '10.0.0.11', desiredState: 'off' },
    ];
    await agent.tick();
    assert.equal(samsungCalls[1].token, 'rotated-tok');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('Power agent: offline server triggers exponential backoff without touching TVs', async () => {
  let tvTouched = false;
  const agent = createPowerAgent(
    { sissiUrl: 'https://sissi.test', agentToken: 't', pollSeconds: 60, maxBackoffSeconds: 300 },
    {
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
      probeTcp: async () => {
        tvTouched = true;
        return false;
      },
      sendWol: async () => {
        tvTouched = true;
      },
      logger: { warn() {}, error() {} },
    },
  );

  const delays = [];
  for (let i = 0; i < 5; i++) {
    const r = await agent.tick();
    assert.equal(r.ok, false);
    delays.push(r.backoffSeconds);
  }
  assert.deepEqual(delays, [60, 120, 240, 300, 300]);
  assert.equal(tvTouched, false);
});
