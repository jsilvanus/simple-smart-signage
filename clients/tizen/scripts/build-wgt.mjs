import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIZEN_ROOT = path.resolve(HERE, '..');
const DEFAULT_OUT_FILE = path.join(TIZEN_ROOT, 'dist', 'sissi-tizen.wgt');

const REQUIRED_PRIVILEGES = [
  'http://tizen.org/privilege/internet',
  'http://tizen.org/privilege/tv.inputdevice',
  'http://tizen.org/privilege/power',
  'http://tizen.org/privilege/filesystem.read',
  'http://tizen.org/privilege/filesystem.write',
];

export function validateConfigXml(xmlText) {
  const checks = [
    ['tv-samsung profile', /<tizen:profile\s+name="tv-samsung"/],
    ['required_version="4.0"', /required_version="4\.0"/],
    ['WARP access origin="*"', /<access\s+origin="\*"\s+subdomains="true"/],
    ['hwkey-event="enable"', /hwkey-event="enable"/],
  ];
  for (const [label, re] of checks) {
    if (!re.test(xmlText)) {
      throw new Error(`config.xml missing ${label}`);
    }
  }
  for (const priv of REQUIRED_PRIVILEGES) {
    if (!xmlText.includes(priv)) {
      throw new Error(`config.xml missing privilege ${priv}`);
    }
  }
}

async function collectFiles(rootDir) {
  const entries = [];
  const topFiles = ['config.xml', 'icon.png', 'index.html', 'app.css'];
  for (const rel of topFiles) {
    const abs = path.join(rootDir, rel);
    const s = await stat(abs);
    if (!s.isFile()) throw new Error(`Missing required file: ${rel}`);
    entries.push({ name: rel, data: await readFile(abs) });
  }

  const srcDir = path.join(rootDir, 'src');
  const srcItems = (await readdir(srcDir)).sort();
  for (const item of srcItems) {
    if (!item.endsWith('.js')) continue;
    const abs = path.join(srcDir, item);
    const s = await stat(abs);
    if (s.isFile()) {
      entries.push({ name: `src/${item}`, data: await readFile(abs) });
    }
  }
  return entries;
}

function dosTimeDate(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

export function buildZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosTimeDate();

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const raw = file.data;
    const crc = crc32(raw) >>> 0;
    const deflated = deflateRawSync(raw);
    const useDeflate = deflated.length < raw.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : raw;

    // Local file header (30 bytes + name)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len

    localParts.push(local, nameBuf, payload);

    // Central directory header (46 bytes + name)
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // UTF-8 filename flag
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // cd start disk
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

export function parseZipEntries(zipBuf) {
  // Find End of Central Directory (PK\x05\x06)
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= Math.max(0, zipBuf.length - 65557); i -= 1) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP: EOCD not found');
  }

  const entryCount = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let ptr = cdOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (zipBuf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central header at ${ptr}`);
    }
    const method = zipBuf.readUInt16LE(ptr + 10);
    const compressedSize = zipBuf.readUInt32LE(ptr + 20);
    const uncompressedSize = zipBuf.readUInt32LE(ptr + 24);
    const nameLen = zipBuf.readUInt16LE(ptr + 28);
    const extraLen = zipBuf.readUInt16LE(ptr + 30);
    const commentLen = zipBuf.readUInt16LE(ptr + 32);
    const localOffset = zipBuf.readUInt32LE(ptr + 42);
    const name = zipBuf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');

    if (zipBuf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header for ${name}`);
    }

    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export async function buildWgt({ rootDir = TIZEN_ROOT, outFile = DEFAULT_OUT_FILE } = {}) {
  const files = await collectFiles(rootDir);
  const configEntry = files.find((f) => f.name === 'config.xml');
  validateConfigXml(configEntry.data.toString('utf8'));

  const zipBuf = buildZipBuffer(files);
  const verified = parseZipEntries(zipBuf);
  const names = new Set(verified.map((e) => e.name));
  for (const required of ['config.xml', 'index.html', 'icon.png']) {
    if (!names.has(required)) {
      throw new Error(`Built .wgt missing required entry: ${required}`);
    }
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, zipBuf);
  return { outFile, bytes: zipBuf.length, entries: verified };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const res = await buildWgt();
  console.log(`Built ${res.outFile} (${res.bytes} bytes, ${res.entries.length} entries)`);
}
