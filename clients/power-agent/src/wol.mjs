import nodeDgram from 'node:dgram';

const MAC_COLON_RE = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;
const MAC_DASH_RE = /^([0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}$/;
const MAC_COMPACT_RE = /^[0-9a-fA-F]{12}$/;

/**
 * Parse and validate a MAC address into a 6-byte Buffer.
 * Accepts AA:BB:CC:DD:EE:FF, AA-BB-CC-DD-EE-FF, or AABBCCDDEEFF.
 */
export function parseMac(mac) {
  if (typeof mac !== 'string') {
    throw new Error(`Invalid MAC address: ${String(mac)}`);
  }
  const trimmed = mac.trim();
  if (!MAC_COLON_RE.test(trimmed) && !MAC_DASH_RE.test(trimmed) && !MAC_COMPACT_RE.test(trimmed)) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }
  const hex = trimmed.replace(/[:-]/g, '');
  return Buffer.from(hex, 'hex');
}

/**
 * Build a 102-byte Wake-on-LAN magic packet (6x 0xFF + 16x MAC).
 */
export function buildMagicPacket(mac) {
  const macBytes = parseMac(mac);
  const packet = Buffer.alloc(102);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    macBytes.copy(packet, 6 + i * 6);
  }
  return packet;
}

function sendUdpPacket(socket, packet, port, address) {
  return new Promise((resolve, reject) => {
    socket.send(packet, 0, packet.length, port, address, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Send Wake-on-LAN magic packets via UDP broadcast.
 */
export async function sendWol(
  mac,
  { broadcast = '255.255.255.255', port = 9, count = 3, dgram = nodeDgram } = {},
) {
  const packet = buildMagicPacket(mac);
  const targets = Array.isArray(broadcast)
    ? broadcast.filter(Boolean)
    : String(broadcast)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  if (targets.length === 0) {
    targets.push('255.255.255.255');
  }

  const socket = dgram.createSocket('udp4');
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, () => {
        socket.removeListener('error', reject);
        socket.setBroadcast(true);
        resolve();
      });
    });

    for (const target of targets) {
      for (let i = 0; i < count; i++) {
        await sendUdpPacket(socket, packet, port, target);
      }
    }
  } finally {
    try {
      socket.close();
    } catch {
      // ignore close errors on already-closed socket
    }
  }
}
