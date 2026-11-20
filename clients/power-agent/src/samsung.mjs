import tls from 'node:tls';
import crypto from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CLIENT_NAME_B64 = Buffer.from('SiSSi').toString('base64');

function encodeWsFrame(opcode, payloadBuf = Buffer.alloc(0)) {
  const len = payloadBuf.length;
  let headerLen = 2;
  if (len >= 65536) headerLen = 10;
  else if (len >= 126) headerLen = 4;

  const maskKey = crypto.randomBytes(4);
  const frame = Buffer.allocUnsafe(headerLen + 4 + len);
  frame[0] = 0x80 | (opcode & 0x0f);

  if (len < 126) {
    frame[1] = 0x80 | len;
  } else if (len < 65536) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
  }

  maskKey.copy(frame, headerLen);
  const dataOffset = headerLen + 4;
  for (let i = 0; i < len; i++) {
    frame[dataOffset + i] = payloadBuf[i] ^ maskKey[i & 3];
  }
  return frame;
}

function tryDecodeFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const bigLen = buf.readBigUInt64BE(2);
    if (bigLen > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('WebSocket frame too large');
    }
    len = Number(bigLen);
    offset = 10;
  }

  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return null;

  let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
  if (masked) {
    const maskKey = buf.subarray(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i & 3];
    }
  }

  return {
    fin,
    opcode,
    payload,
    rest: buf.subarray(offset + maskLen + len),
  };
}

function parseHttpHeaders(headerText) {
  const lines = headerText.split('\r\n');
  const statusLine = lines[0] || '';
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(':');
    if (idx > 0) {
      const name = lines[i].slice(0, idx).trim().toLowerCase();
      const val = lines[i].slice(idx + 1).trim();
      headers[name] = val;
    }
  }
  return { statusLine, headers };
}

/**
 * Connect to a Samsung Tizen TV WebSocket endpoint over TLS (self-signed certs allowed),
 * wait for `ms.channel.connect`, and optionally run an action before closing.
 */
function connectSamsungWs(ip, { port = 8002, token, timeoutMs = 5000 } = {}, onConnect) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let handshakeDone = false;
    let buffer = Buffer.alloc(0);
    let fragments = [];

    const wsKey = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto
      .createHash('sha1')
      .update(wsKey + WS_GUID)
      .digest('base64');

    const socket = tls.connect({
      host: ip,
      port,
      rejectUnauthorized: false,
    });

    const timer = setTimeout(() => {
      finishError(new Error(`Samsung TV WebSocket timeout after ${timeoutMs}ms (${ip}:${port})`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
    };

    const finishSuccess = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.write(encodeWsFrame(0x8, Buffer.alloc(0)), () => {
          cleanup();
          resolve(value);
        });
      } catch {
        cleanup();
        resolve(value);
      }
    };

    const finishError = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const sendText = (obj) =>
      new Promise((res, rej) => {
        const payload = Buffer.from(JSON.stringify(obj), 'utf8');
        socket.write(encodeWsFrame(0x1, payload), (err) => {
          if (err) rej(err);
          else res();
        });
      });

    const handleMessage = (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      if (msg.event === 'ms.channel.unauthorized') {
        finishError(new Error('Samsung TV authorization denied (ms.channel.unauthorized)'));
        return;
      }
      if (msg.event === 'ms.channel.timeOut') {
        finishError(new Error('Samsung TV pairing timed out (ms.channel.timeOut)'));
        return;
      }
      if (msg.event === 'ms.channel.connect') {
        try {
          const result = onConnect(msg, sendText);
          if (result && typeof result.then === 'function') {
            result.then(finishSuccess, finishError);
          } else {
            finishSuccess(result);
          }
        } catch (err) {
          finishError(err);
        }
      }
    };

    const processFrames = () => {
      while (true) {
        const frame = tryDecodeFrame(buffer);
        if (!frame) break;
        buffer = frame.rest;

        if (frame.opcode === 0x8) {
          finishError(new Error('Samsung TV closed WebSocket before completing'));
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(encodeWsFrame(0xa, frame.payload));
          continue;
        }
        if (frame.opcode === 0xa) {
          continue;
        }
        if (frame.opcode === 0x1 || frame.opcode === 0x0) {
          fragments.push(frame.payload);
          if (frame.fin) {
            const full = Buffer.concat(fragments).toString('utf8');
            fragments = [];
            handleMessage(full);
            if (settled) return;
          }
        }
      }
    };

    socket.once('secureConnect', () => {
      let path = `/api/v2/channels/samsung.remote.control?name=${CLIENT_NAME_B64}`;
      if (token) {
        path += `&token=${encodeURIComponent(token)}`;
      }
      const req = [
        `GET ${path} HTTP/1.1`,
        `Host: ${ip}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n');
      socket.write(req);
    });

    socket.on('data', (chunk) => {
      if (settled) return;
      buffer = Buffer.concat([buffer, chunk]);

      if (!handshakeDone) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const headerText = buffer.subarray(0, headerEnd).toString('latin1');
        buffer = buffer.subarray(headerEnd + 4);
        const { statusLine, headers } = parseHttpHeaders(headerText);

        if (!statusLine.includes('101')) {
          finishError(new Error(`Samsung WebSocket handshake failed: ${statusLine}`));
          return;
        }
        if (headers['sec-websocket-accept'] !== expectedAccept) {
          finishError(new Error('Samsung WebSocket handshake failed: invalid Sec-WebSocket-Accept'));
          return;
        }
        handshakeDone = true;
      }

      try {
        processFrames();
      } catch (err) {
        finishError(err);
      }
    });

    socket.once('error', (err) => finishError(err));
    socket.once('close', () => {
      if (!settled) {
        finishError(new Error('Samsung TV WebSocket closed unexpectedly'));
      }
    });
  });
}

/**
 * Send a remote key (default KEY_POWER) to a Samsung TV over TLS WebSocket.
 * Returns { token? } if the TV issues a new token in ms.channel.connect.
 */
export async function sendSamsungKey(
  ip,
  { token, key = 'KEY_POWER', port = 8002, timeoutMs = 5000 } = {},
) {
  return connectSamsungWs(ip, { port, token, timeoutMs }, async (msg, sendText) => {
    const newToken = msg?.data?.token ? String(msg.data.token) : undefined;
    await sendText({
      method: 'ms.remote.control',
      params: {
        Cmd: 'Click',
        DataOfCmd: key,
        Option: 'false',
        TypeOfRemote: 'SendRemoteKey',
      },
    });
    return newToken ? { token: newToken } : {};
  });
}

/**
 * Pair with a Samsung TV by waiting for the user to accept the on-screen prompt.
 * Returns { token }.
 */
export async function pairSamsung(ip, { port = 8002, timeoutMs = 30000 } = {}) {
  return connectSamsungWs(ip, { port, timeoutMs }, (msg) => {
    const token = msg?.data?.token ? String(msg.data.token) : '';
    if (!token) {
      throw new Error('Samsung TV connected without issuing a token');
    }
    return { token };
  });
}
