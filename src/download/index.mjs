// Download client: SSRF-guarded, size-limited, content-sniffing page downloader.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_REDIRECTS = 4;

export class DownloadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

/** URL without credentials, query string or fragment; safe for logs and messages. */
export function scrubUrl(url) {
  try {
    const u = url instanceof URL ? url : new URL(String(url));
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return String(url).split(/[?#]/)[0].replace(/\/\/[^/@]*@/, '//');
  }
}

/** Detect media kind from leading bytes. Returns {kind, ext, contentType} or null. */
export function sniffKind(buf) {
  if (!buf || buf.length < 12) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'image', ext: 'png', contentType: 'image/png' };
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { kind: 'image', ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    return { kind: 'image', ext: 'webp', contentType: 'image/webp' };
  }
  if (b.toString('latin1', 4, 8) === 'ftyp') {
    return { kind: 'video', ext: 'mp4', contentType: 'video/mp4' };
  }
  return null;
}

// ---------------------------------------------------------------- addresses

function ipv4Bytes(s) {
  const p = s.split('.').map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}

function ipv6Bytes(s) {
  s = s.split('%')[0].toLowerCase();
  let tail = null;
  const lastColon = s.lastIndexOf(':');
  if (s.includes('.')) {
    const v4 = ipv4Bytes(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4;
    s = s.slice(0, lastColon + 1) + '0:0';
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (x) => (x === '' ? [] : x.split(':'));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill('0'), ...rest];
  } else groups = head;
  if (groups.length !== 8) return null;
  const out = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    out.push(n >> 8, n & 255);
  }
  if (tail) out.splice(12, 4, ...tail);
  return out;
}

function privateV4([a, b, c]) {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** True when the address must not be fetched (unparseable counts as private). */
export function isPrivateAddress(address) {
  const fam = net.isIP(address);
  if (fam === 4) return privateV4(ipv4Bytes(address));
  if (fam !== 6) return true;
  const b = ipv6Bytes(address);
  if (!b) return true;
  if (b.slice(0, 10).every((x) => x === 0)) {
    // ::, ::1, ::a.b.c.d (compat) and ::ffff:a.b.c.d (mapped)
    if ((b[10] === 0xff && b[11] === 0xff) ) return privateV4(b.slice(12));
    return true;
  }
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
    return privateV4(b.slice(12)); // NAT64
  }
  if (b[0] === 0x20 && b[1] === 0x02) return privateV4(b.slice(2, 6)); // 6to4
  if (b[0] === 0xff) return true; // multicast
  if ((b[0] & 0xfe) === 0xfc) return true; // unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // link local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // site local
  return false;
}

function hostAllowed(hostname, hosts) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return hosts.some((raw) => {
    const d = String(raw).toLowerCase().replace(/^\./, '');
    return d && (h === d || h.endsWith('.' + d));
  });
}

// ---------------------------------------------------------------- mp4

const FAIL_LEN = 'cannot read video length';

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const { bytesRead } = await fh.read(buf, got, len - got, pos + got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

async function* boxes(fh, start, end) {
  let pos = start;
  for (let i = 0; i < 20000 && pos + 8 <= end; i++) {
    const h = await readAt(fh, pos, 16);
    if (h.length < 8) return;
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    let hdr = 8;
    if (size === 1) {
      if (h.length < 16) return;
      size = Number(h.readBigUInt64BE(8));
      hdr = 16;
    } else if (size === 0) size = end - pos;
    if (size < hdr) return;
    yield { type, bodyStart: pos + hdr, end: Math.min(pos + size, end), declaredEnd: pos + size };
    pos += size;
  }
}

/** Duration in whole seconds (rounded up) of an MP4 file; throws DownloadError UNSUPPORTED_TYPE. */
export async function readMp4Duration(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const fileSize = (await fh.stat()).size;
    let timescale = 0;
    let duration = 0;
    let fragDuration = 0;
    let sawMoov = false;
    for await (const top of boxes(fh, 0, fileSize)) {
      if (top.type !== 'moov') continue;
      sawMoov = true;
      if (top.declaredEnd > fileSize) break; // truncated
      for await (const c of boxes(fh, top.bodyStart, top.end)) {
        if (c.type === 'mvhd') {
          const b = await readAt(fh, c.bodyStart, Math.min(32, c.end - c.bodyStart));
          const v = b[0];
          if (v === 1 && b.length >= 32) {
            timescale = b.readUInt32BE(20);
            duration = Number(b.readBigUInt64BE(24));
          } else if (v === 0 && b.length >= 20) {
            timescale = b.readUInt32BE(12);
            duration = b.readUInt32BE(16);
          }
        } else if (c.type === 'mvex') {
          for await (const m of boxes(fh, c.bodyStart, c.end)) {
            if (m.type !== 'mehd') continue;
            const b = await readAt(fh, m.bodyStart, Math.min(12, m.end - m.bodyStart));
            if (b[0] === 1 && b.length >= 12) fragDuration = Number(b.readBigUInt64BE(4));
            else if (b.length >= 8) fragDuration = b.readUInt32BE(4);
          }
        }
      }
      break;
    }
    if (!sawMoov || !timescale) throw new DownloadError('UNSUPPORTED_TYPE', FAIL_LEN);
    const units = duration > 0 ? duration : fragDuration;
    if (!(units > 0)) throw new DownloadError('UNSUPPORTED_TYPE', FAIL_LEN);
    return Math.ceil(units / timescale);
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- downloader

function normalizeLookup(result) {
  const list = Array.isArray(result) ? result : [result];
  return list
    .filter((r) => r && typeof r.address === 'string')
    .map((r) => r.address);
}

export function createDownloader(config, deps = {}) {
  if (config.allowPrivateDownloads && config.production) {
    throw new Error('allowPrivateDownloads is not permitted in production');
  }
  const allowPrivate = Boolean(config.allowPrivateDownloads);
  const hosts = config.downloadHosts || [];
  const lookup = deps.lookup || ((host) => dns.promises.lookup(host, { all: true, verbatim: true }));
  const tmpDir = deps.tmpDir || os.tmpdir();
  const connectMs = deps.connectTimeoutMs ?? deps.timeouts?.connectMs ?? 10_000;
  const idleMs = deps.idleTimeoutMs ?? deps.timeouts?.idleMs ?? 30_000;

  const notAllowed = (url, why) =>
    new DownloadError('PAGE_URL_NOT_ALLOWED', `Page URL not allowed (${why}): ${scrubUrl(url)}`);
  const failed = (url, why) =>
    new DownloadError('DOWNLOAD_FAILED', `Download failed (${why}): ${scrubUrl(url)}`);

  /** Validate a URL and resolve it to a single permitted address. */
  async function check(raw) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      throw new DownloadError('PAGE_URL_NOT_ALLOWED', 'Page URL is not a valid URL');
    }
    if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) throw notAllowed(u, 'https required');
    if (u.username || u.password) throw notAllowed(u, 'credentials in URL');
    const hostname = u.hostname.replace(/^\[|\]$/g, '');
    if (!hostAllowed(hostname, hosts)) throw notAllowed(u, 'host not allowed');
    let addrs;
    if (net.isIP(hostname)) addrs = [hostname];
    else {
      try {
        addrs = normalizeLookup(await lookup(hostname));
      } catch {
        throw failed(u, 'host lookup failed');
      }
    }
    if (!addrs.length) throw failed(u, 'host lookup failed');
    if (!allowPrivate && addrs.some(isPrivateAddress)) throw notAllowed(u, 'address not allowed');
    return { url: u, hostname, address: addrs[0] };
  }

  function request(target, signal) {
    const { url, hostname, address } = target;
    const lib = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const opts = {
        host: address,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: { Host: url.host, 'User-Agent': 'sissi-download/1', Accept: '*/*' },
        agent: false,
        lookup: undefined,
      };
      if (url.protocol === 'https:' && !net.isIP(hostname)) opts.servername = hostname;
      const req = lib.request(opts);
      let settled = false;
      let currentRes = null;
      const cleanup = () => {
        clearTimeout(connectTimer);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const fail = (why) => {
        const err = failed(url, why);
        if (settled) {
          if (currentRes && !currentRes.destroyed) currentRes.destroy(err);
          else req.destroy(err);
          return;
        }
        settled = true;
        cleanup();
        req.destroy();
        reject(err);
      };
      const connectTimer = setTimeout(() => fail('connect timed out'), connectMs);
      const onAbort = () => fail('aborted');
      if (signal) {
        if (signal.aborted) return fail('aborted');
        signal.addEventListener('abort', onAbort, { once: true });
      }
      req.on('socket', (s) => {
        const connectEv = url.protocol === 'https:' ? 'secureConnect' : 'connect';
        s.once(connectEv, () => clearTimeout(connectTimer));
        s.setTimeout(idleMs, () => fail('timed out'));
      });
      req.on('error', () => fail('connection error'));
      req.on('response', (res) => {
        if (settled) return res.destroy();
        settled = true;
        clearTimeout(connectTimer);
        currentRes = res;
        res.once('close', cleanup);
        res.on('error', () => {});
        resolve(res);
      });
      req.end();
    });
  }

  async function downloadPage({ url, kindHint, maxBytes, signal }) {
    let target = await check(url);
    let res;
    for (let hop = 0; ; hop++) {
      res = await request(target, signal);
      const loc = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc) {
        res.destroy();
        if (hop >= MAX_REDIRECTS) throw failed(target.url, 'too many redirects');
        let next;
        try {
          next = new URL(loc, target.url).href;
        } catch {
          throw failed(target.url, 'bad redirect');
        }
        target = await check(next);
        continue;
      }
      break;
    }
    const shown = target.url;
    if (res.statusCode !== 200) {
      res.destroy();
      throw failed(shown, `HTTP ${res.statusCode}`);
    }
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      throw new DownloadError('TOO_LARGE', `File is larger than the ${maxBytes} byte limit`);
    }

    await fs.promises.mkdir(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, `sissi-dl-${crypto.randomUUID()}.part`);
    const fh = await fs.promises.open(tmpPath, 'w');
    const hash = crypto.createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    let sniffed = null;
    try {
      for await (const chunk of res) {
        size += chunk.length;
        if (size > maxBytes) throw new DownloadError('TOO_LARGE', `File is larger than the ${maxBytes} byte limit`);
        if (!sniffed) {
          head = Buffer.concat([head, chunk]).subarray(0, 64);
          if (head.length >= 12 || size >= 12) {
            sniffed = sniffKind(head);
            if (!sniffed) throw new DownloadError('UNSUPPORTED_TYPE', 'File is not a supported PNG, JPEG, WebP or MP4');
            if (kindHint && kindHint !== sniffed.kind) {
              throw new DownloadError('KIND_MISMATCH', `Expected ${kindHint} but the file is ${sniffed.kind}`);
            }
          }
        }
        hash.update(chunk);
        await fh.write(chunk);
      }
      if (!res.complete) throw failed(shown, 'connection closed early');
      if (!sniffed) throw new DownloadError('UNSUPPORTED_TYPE', 'File is not a supported PNG, JPEG, WebP or MP4');
      await fh.close();
      let durationSeconds = null;
      if (sniffed.kind === 'video') durationSeconds = await readMp4Duration(tmpPath);
      return {
        tmpPath, size, sha256: hash.digest('hex'),
        kind: sniffed.kind, ext: sniffed.ext, contentType: sniffed.contentType, durationSeconds,
      };
    } catch (err) {
      res.destroy();
      await fh.close().catch(() => {});
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
      if (err instanceof DownloadError) throw err;
      throw failed(shown, 'read error');
    }
  }

  return { downloadPage };
}
