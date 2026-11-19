import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createDownloader,
  DownloadError,
  isPrivateAddress,
  readMp4Duration,
  scrubUrl,
  sniffKind,
} from '../../src/download/index.mjs';

// ------------------------------------------------------------------ binary fixtures

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452', 'hex'),
]);

const JPG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);

const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x0c, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.from('VP8 '),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
]);

function box(type, ...parts) {
  const payload = Buffer.concat(parts);
  const hdr = Buffer.alloc(8);
  hdr.writeUInt32BE(8 + payload.length, 0);
  hdr.write(type, 4, 4, 'latin1');
  return Buffer.concat([hdr, payload]);
}

function ftypBox(brand = 'isom') {
  const body = Buffer.alloc(12);
  body.write(brand, 0, 4, 'latin1');
  body.writeUInt32BE(0x200, 4);
  body.write('isom', 8, 4, 'latin1');
  return box('ftyp', body);
}

function mvhdV0(timescale, duration) {
  const b = Buffer.alloc(100);
  b[0] = 0; // version 0
  b.writeUInt32BE(timescale, 12);
  b.writeUInt32BE(duration, 16);
  return box('mvhd', b);
}

function mvhdV1(timescale, durationBig) {
  const b = Buffer.alloc(112);
  b[0] = 1; // version 1
  b.writeUInt32BE(timescale, 20);
  b.writeBigUInt64BE(BigInt(durationBig), 24);
  return box('mvhd', b);
}

function mehdV0(fragDuration) {
  const b = Buffer.alloc(8);
  b[0] = 0;
  b.writeUInt32BE(fragDuration, 4);
  return box('mehd', b);
}

function mehdV1(fragDurationBig) {
  const b = Buffer.alloc(12);
  b[0] = 1;
  b.writeBigUInt64BE(BigInt(fragDurationBig), 4);
  return box('mehd', b);
}

function makeMp4(...moovChildren) {
  return Buffer.concat([ftypBox(), box('moov', ...moovChildren)]);
}

async function withTempDir(fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sissi-dl-test-'));
  try {
    return await fn(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

async function startHttpServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function baseConfig(overrides = {}) {
  return {
    production: false,
    allowPrivateDownloads: true,
    downloadHosts: ['canva.com', 'canva.dev'],
    ...overrides,
  };
}

// ------------------------------------------------------------------ unit tests

test('createDownloader refuses allowPrivateDownloads in production', () => {
  assert.throws(
    () => createDownloader({ production: true, allowPrivateDownloads: true, downloadHosts: ['canva.com'] }),
    /production/i,
  );
});

test('scrubUrl removes credentials, query strings, and fragments', () => {
  assert.equal(
    scrubUrl('https://user:pass@export.canva.com/a/b.png?X-Amz-Signature=secret#frag'),
    'https://export.canva.com/a/b.png',
  );
  assert.equal(
    scrubUrl('not a url?secret=1#x'),
    'not a url',
  );
});

test('sniffKind detects PNG, JPEG, WebP, MP4 and rejects others', () => {
  assert.deepEqual(sniffKind(PNG_BYTES), { kind: 'image', ext: 'png', contentType: 'image/png' });
  assert.deepEqual(sniffKind(JPG_BYTES), { kind: 'image', ext: 'jpg', contentType: 'image/jpeg' });
  assert.deepEqual(sniffKind(WEBP_BYTES), { kind: 'image', ext: 'webp', contentType: 'image/webp' });
  assert.deepEqual(sniffKind(makeMp4(mvhdV0(1000, 1000))), { kind: 'video', ext: 'mp4', contentType: 'video/mp4' });
  assert.equal(sniffKind(Buffer.from('<html>not media</html>')), null);
  assert.equal(sniffKind(Buffer.from([1, 2, 3])), null);
});

test('isPrivateAddress blocks private/loopback/link-local/multicast/unspecified/unique-local IPv4 & IPv6', () => {
  const blocked = [
    '0.0.0.0', '10.0.0.1', '127.0.0.1', '127.255.255.254',
    '100.64.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
    'fe80::1', 'fc00::1', 'fd12:3456:789a::1', 'ff02::1',
    '64:ff9b::10.0.0.1', '2002:0a00:0001::1',
    'not-an-ip', 'fe80::1%eth0',
  ];
  for (const addr of blocked) {
    assert.equal(isPrivateAddress(addr), true, `expected ${addr} to be private`);
  }

  const allowed = [
    '93.184.216.34', '8.8.8.8', '172.32.0.1', '192.169.0.1',
    '2606:2800:220:1:248:1893:25c8:1946', '::ffff:93.184.216.34',
  ];
  for (const addr of allowed) {
    assert.equal(isPrivateAddress(addr), false, `expected ${addr} to be public`);
  }
});

// ------------------------------------------------------------------ MP4 duration

test('readMp4Duration handles mvhd v0, v1, fragmented mvex/mehd, and invalid/truncated files', async () => {
  await withTempDir(async (dir) => {
    const write = async (name, buf) => {
      const p = path.join(dir, name);
      await fs.promises.writeFile(p, buf);
      return p;
    };

    // v0: 2500 / 1000 = 2.5s -> ceil = 3
    assert.equal(await readMp4Duration(await write('v0.mp4', makeMp4(mvhdV0(1000, 2500)))), 3);

    // v1: 4001 / 1000 = 4.001s -> ceil = 5
    assert.equal(await readMp4Duration(await write('v1.mp4', makeMp4(mvhdV1(1000, 4001n)))), 5);

    // fragmented v0: mvhd duration 0 + mvex/mehd v0
    assert.equal(
      await readMp4Duration(await write('frag0.mp4', makeMp4(mvhdV0(1000, 0), box('mvex', mehdV0(6100))))),
      7,
    );

    // fragmented v1: mvhd duration 0 + mvex/mehd v1
    assert.equal(
      await readMp4Duration(await write('frag1.mp4', makeMp4(mvhdV0(90000, 0), box('mvex', mehdV1(90001n))))),
      2,
    );

    // no duration anywhere -> UNSUPPORTED_TYPE 'cannot read video length'
    await assert.rejects(
      readMp4Duration(await write('nodur.mp4', makeMp4(mvhdV0(1000, 0)))),
      (err) => err instanceof DownloadError && err.code === 'UNSUPPORTED_TYPE' && err.message === 'cannot read video length',
    );

    // truncated moov -> UNSUPPORTED_TYPE 'cannot read video length'
    const full = makeMp4(mvhdV0(1000, 5000));
    await assert.rejects(
      readMp4Duration(await write('trunc.mp4', full.subarray(0, full.length - 10))),
      (err) => err instanceof DownloadError && err.code === 'UNSUPPORTED_TYPE' && err.message === 'cannot read video length',
    );
  });
});

// ------------------------------------------------------------------ SSRF & URL checks

test('SSRF guards: https-only, userinfo, suffix trick, private lookup, DNS rebinding single-lookup', async () => {
  await withTempDir(async (tmpDir) => {
    const dl = createDownloader(baseConfig({ allowPrivateDownloads: false }), {
      tmpDir,
      lookup: async () => [{ address: '93.184.216.34' }],
      connectTimeoutMs: 50,
    });

    // plain http refused
    await assert.rejects(
      dl.downloadPage({ url: 'http://x.canva.com/img.png?sig=secret', maxBytes: 1024 }),
      (err) => err.code === 'PAGE_URL_NOT_ALLOWED' && !err.message.includes('secret'),
    );

    // userinfo refused
    await assert.rejects(
      dl.downloadPage({ url: 'https://user:pass@x.canva.com/img.png?sig=secret', maxBytes: 1024 }),
      (err) => err.code === 'PAGE_URL_NOT_ALLOWED' && !err.message.includes('pass') && !err.message.includes('secret'),
    );

    // host suffix trick refused
    await assert.rejects(
      dl.downloadPage({ url: 'https://evilcanva.com/img.png', maxBytes: 1024 }),
      (err) => err.code === 'PAGE_URL_NOT_ALLOWED',
    );

    // private IP returned by lookup refused
    for (const priv of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) {
      const dlPriv = createDownloader(baseConfig({ allowPrivateDownloads: false }), {
        tmpDir,
        lookup: async () => [{ address: priv }],
      });
      await assert.rejects(
        dlPriv.downloadPage({ url: 'https://x.canva.com/img.png', maxBytes: 1024 }),
        (err) => err.code === 'PAGE_URL_NOT_ALLOWED',
      );
    }

    // DNS rebinding: lookup returns public IP on call 1, private IP on call 2.
    // Must only call lookup ONCE and never connect to the private server.
    let localHit = false;
    const srv = await startHttpServer((_req, res) => {
      localHit = true;
      res.writeHead(200);
      res.end(PNG_BYTES);
    });
    try {
      let lookupCalls = 0;
      const dlRebind = createDownloader(baseConfig({ allowPrivateDownloads: false }), {
        tmpDir,
        connectTimeoutMs: 60,
        lookup: async () => {
          lookupCalls++;
          // 192.0.2.1 is TEST-NET-1 (non-routable, not in privateV4)
          return lookupCalls === 1 ? [{ address: '192.0.2.1' }] : [{ address: '127.0.0.1' }];
        },
      });
      await assert.rejects(
        dlRebind.downloadPage({ url: `https://x.canva.com:${srv.port}/img.png`, maxBytes: 1024 }),
        (err) => err.code === 'DOWNLOAD_FAILED',
      );
      assert.equal(lookupCalls, 1);
      assert.equal(localHit, false);
    } finally {
      await srv.close();
    }
  });
});

// ------------------------------------------------------------------ download flows

test('downloads PNG, JPEG, WebP, and MP4 via local server and computes sha256 + durationSeconds', async () => {
  await withTempDir(async (tmpDir) => {
    const mp4 = makeMp4(mvhdV0(1000, 3200)); // 4s
    const files = {
      '/a.png': { bytes: PNG_BYTES, kind: 'image', ext: 'png', contentType: 'image/png', dur: null },
      '/b.jpg': { bytes: JPG_BYTES, kind: 'image', ext: 'jpg', contentType: 'image/jpeg', dur: null },
      '/c.webp': { bytes: WEBP_BYTES, kind: 'image', ext: 'webp', contentType: 'image/webp', dur: null },
      '/d.mp4': { bytes: mp4, kind: 'video', ext: 'mp4', contentType: 'video/mp4', dur: 4 },
    };
    let lastHost = '';
    const srv = await startHttpServer((req, res) => {
      lastHost = req.headers.host;
      const item = files[req.url.split('?')[0]];
      res.writeHead(200, { 'Content-Length': item.bytes.length });
      res.end(item.bytes);
    });
    try {
      const dl = createDownloader(baseConfig(), {
        tmpDir,
        lookup: async () => [{ address: '127.0.0.1' }],
      });
      for (const [p, spec] of Object.entries(files)) {
        const res = await dl.downloadPage({
          url: `http://export.canva.com:${srv.port}${p}?token=abc`,
          kindHint: spec.kind,
          maxBytes: 1024 * 1024,
        });
        assert.equal(lastHost, `export.canva.com:${srv.port}`);
        assert.equal(res.kind, spec.kind);
        assert.equal(res.ext, spec.ext);
        assert.equal(res.contentType, spec.contentType);
        assert.equal(res.size, spec.bytes.length);
        assert.equal(res.durationSeconds, spec.dur);
        assert.equal(res.sha256, crypto.createHash('sha256').update(spec.bytes).digest('hex'));
        const onDisk = await fs.promises.readFile(res.tmpPath);
        assert.deepEqual(onDisk, spec.bytes);
        await fs.promises.rm(res.tmpPath);
      }
    } finally {
      await srv.close();
    }
  });
});

test('redirects: follows up to 4 hops, rejects loop (>4) and disallowed redirect host', async () => {
  await withTempDir(async (tmpDir) => {
    let evilHit = false;
    const srv = await startHttpServer((req, res) => {
      const pathOnly = req.url.split('?')[0];
      if (pathOnly.startsWith('/hop/')) {
        const n = Number(pathOnly.split('/')[2]);
        if (n < 4) {
          res.writeHead(302, { Location: `/hop/${n + 1}?secret=1` });
          return res.end();
        }
        res.writeHead(200);
        return res.end(PNG_BYTES);
      }
      if (pathOnly === '/loop') {
        res.writeHead(302, { Location: '/loop?s=1' });
        return res.end();
      }
      if (pathOnly === '/to-evil') {
        res.writeHead(302, { Location: `http://evilcanva.com:${srv.port}/p?secret=xyz` });
        return res.end();
      }
      if (pathOnly === '/p') {
        evilHit = true;
        res.writeHead(200);
        return res.end(PNG_BYTES);
      }
      res.writeHead(404);
      res.end();
    });
    try {
      const dl = createDownloader(baseConfig(), {
        tmpDir,
        lookup: async () => [{ address: '127.0.0.1' }],
      });

      // 4 redirects succeeds
      const ok = await dl.downloadPage({
        url: `http://x.canva.com:${srv.port}/hop/0?a=1`,
        maxBytes: 1024,
      });
      assert.equal(ok.ext, 'png');
      await fs.promises.rm(ok.tmpPath);

      // redirect loop (>4) fails
      await assert.rejects(
        dl.downloadPage({ url: `http://x.canva.com:${srv.port}/loop?sig=secret`, maxBytes: 1024 }),
        (err) => err.code === 'DOWNLOAD_FAILED' && !err.message.includes('secret'),
      );

      // redirect to disallowed host fails before connecting
      await assert.rejects(
        dl.downloadPage({ url: `http://x.canva.com:${srv.port}/to-evil?sig=secret`, maxBytes: 1024 }),
        (err) => err.code === 'PAGE_URL_NOT_ALLOWED' && !err.message.includes('secret'),
      );
      assert.equal(evilHit, false);
    } finally {
      await srv.close();
    }
  });
});

test('enforces maxBytes by Content-Length header and by stream, and cleans up temp files', async () => {
  await withTempDir(async (tmpDir) => {
    const srv = await startHttpServer((req, res) => {
      if (req.url === '/header-big') {
        res.writeHead(200, { 'Content-Length': '5000' });
        return res.end(PNG_BYTES);
      }
      if (req.url === '/png') {
        res.writeHead(200, { 'Content-Length': String(PNG_BYTES.length) });
        return res.end(PNG_BYTES);
      }
      if (req.url === '/stream-big') {
        res.writeHead(200);
        res.write(PNG_BYTES);
        res.write(Buffer.alloc(2000, 0xaa));
        return res.end();
      }
      if (req.url === '/wrong-type') {
        res.writeHead(200);
        return res.end(Buffer.from('not an image or video at all'));
      }
      if (req.url === '/http-500?X-Amz-Signature=secret999') {
        res.writeHead(500);
        return res.end('err');
      }
      res.writeHead(404);
      res.end();
    });
    try {
      const dl = createDownloader(baseConfig(), {
        tmpDir,
        lookup: async () => [{ address: '127.0.0.1' }],
      });

      await assert.rejects(
        dl.downloadPage({ url: `http://x.canva.com:${srv.port}/header-big`, maxBytes: 100 }),
        (err) => err.code === 'TOO_LARGE',
      );
      await assert.rejects(
        dl.downloadPage({ url: `http://x.canva.com:${srv.port}/stream-big`, maxBytes: 100 }),
        (err) => err.code === 'TOO_LARGE',
      );
      await assert.rejects(
        dl.downloadPage({ url: `http://x.canva.com:${srv.port}/wrong-type`, maxBytes: 1024 }),
        (err) => err.code === 'UNSUPPORTED_TYPE',
      );
      await assert.rejects(
        dl.downloadPage({ url: `http://x.canva.com:${srv.port}/png`, kindHint: 'video', maxBytes: 10000 }),
        (err) => err.code === 'KIND_MISMATCH',
      );
      await assert.rejects(
        dl.downloadPage({ url: `http://x.canva.com:${srv.port}/http-500?X-Amz-Signature=secret999`, maxBytes: 1024 }),
        (err) => err.code === 'DOWNLOAD_FAILED' && !err.message.includes('secret999') && !err.message.includes('?'),
      );

      const remaining = await fs.promises.readdir(tmpDir);
      assert.deepEqual(remaining, []);
    } finally {
      await srv.close();
    }
  });
});

test('idle timeout and AbortSignal abort mid-stream and clean up temp files', async () => {
  await withTempDir(async (tmpDir) => {
    const srv = await startHttpServer((req, res) => {
      res.writeHead(200);
      res.write(PNG_BYTES);
      // never call res.end()
    });
    try {
      const dl = createDownloader(baseConfig(), {
        tmpDir,
        lookup: async () => [{ address: '127.0.0.1' }],
        idleTimeoutMs: 60,
      });
      await assert.rejects(
        dl.downloadPage({ url: `http://x.canva.com:${srv.port}/stall`, maxBytes: 1024 }),
        (err) => err.code === 'DOWNLOAD_FAILED',
      );

      const ac = new AbortController();
      setTimeout(() => ac.abort(), 30);
      await assert.rejects(
        dl.downloadPage({ url: `http://x.canva.com:${srv.port}/abort`, maxBytes: 1024, signal: ac.signal }),
        (err) => err.code === 'DOWNLOAD_FAILED',
      );

      const remaining = await fs.promises.readdir(tmpDir);
      assert.deepEqual(remaining, []);
    } finally {
      await srv.close();
    }
  });
});
