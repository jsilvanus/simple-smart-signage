import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const defaultExecFile = promisify(execFileCb);

export function substituteTemplate(template, vars = {}) {
  return String(template ?? '').replace(/\$\{(mac|ip|screenId)\}/g, (_, key) => String(vars[key] ?? ''));
}

export function defaultPortForDriver(driver) {
  if (driver === 'samsung-lan') return 8002;
  if (driver === 'android-adb') return 5555;
  return 80;
}

export function probeTcp(ip, port, { timeoutMs = 1500 } = {}) {
  if (!ip) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function wakeViaRouter(routerConfig, device, { fetch = globalThis.fetch, execFile = defaultExecFile } = {}) {
  if (!routerConfig) {
    throw new Error(`Unknown router for screen ${device.screenId}`);
  }
  if (routerConfig.type === 'webhook') {
    const url = substituteTemplate(routerConfig.url, device);
    const method = (routerConfig.method || 'POST').toUpperCase();
    const headers = {};
    if (routerConfig.headers && typeof routerConfig.headers === 'object') {
      for (const [k, v] of Object.entries(routerConfig.headers)) {
        headers[k] = typeof v === 'string' ? substituteTemplate(v, device) : String(v);
      }
    }
    let body;
    if (routerConfig.bodyTemplate !== undefined && routerConfig.bodyTemplate !== null) {
      const raw =
        typeof routerConfig.bodyTemplate === 'string'
          ? routerConfig.bodyTemplate
          : JSON.stringify(routerConfig.bodyTemplate);
      body = substituteTemplate(raw, device);
    }
    const res = await fetch(url, { method, headers, body });
    if (!res.ok) {
      throw new Error(`Router webhook failed (${res.status})`);
    }
    return;
  }
  if (routerConfig.type === 'ssh') {
    const command = substituteTemplate(routerConfig.commandTemplate, device);
    const target = routerConfig.user ? `${routerConfig.user}@${routerConfig.host}` : routerConfig.host;
    const args = [];
    if (routerConfig.port) {
      args.push('-p', String(routerConfig.port));
    }
    args.push('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', target, command);
    await execFile('ssh', args);
    return;
  }
  throw new Error(`Unsupported router type: ${routerConfig.type}`);
}

async function loadSamsungTokens(dataDir) {
  if (!dataDir) return {};
  try {
    const raw = await fs.readFile(path.join(dataDir, 'tokens.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveSamsungToken(dataDir, ip, token) {
  if (!dataDir || !token) return;
  await fs.mkdir(dataDir, { recursive: true });
  const tokens = await loadSamsungTokens(dataDir);
  tokens[ip] = token;
  await fs.writeFile(path.join(dataDir, 'tokens.json'), JSON.stringify(tokens, null, 2));
}

export async function samsungPowerOff(ip, { dataDir, WebSocketImpl = globalThis.WebSocket, timeoutMs = 5000 } = {}) {
  if (!ip) throw new Error('Missing IP for samsung-lan');
  if (typeof WebSocketImpl !== 'function') {
    throw new Error('WebSocket implementation is unavailable');
  }
  const tokens = await loadSamsungTokens(dataDir);
  const savedToken = tokens[ip];
  const tokenParam = savedToken ? `&token=${encodeURIComponent(savedToken)}` : '';
  const url = `wss://${ip}:8002/api/v2/channels/samsung.remote.control?name=U2lTU2k=${tokenParam}`;

  await new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(url);
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(new Error('Samsung WebSocket timeout'));
    }, timeoutMs);

    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve();
    };

    const sendKey = () => {
      ws.send(
        JSON.stringify({
          method: 'ms.remote.control',
          params: {
            Cmd: 'Click',
            DataOfCmd: 'KEY_POWER',
            Option: 'false',
            TypeOfRemote: 'SendRemoteKey',
          },
        }),
      );
      setTimeout(() => finish(), 150);
    };

    ws.addEventListener('message', async (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.event === 'ms.channel.connect') {
          if (msg.data?.token) {
            await saveSamsungToken(dataDir, ip, msg.data.token).catch(() => {});
          }
          sendKey();
        }
      } catch {
        // ignore non-JSON messages
      }
    });

    ws.addEventListener('error', (err) => {
      finish(err instanceof Error ? err : new Error('Samsung WebSocket error'));
    });
  });
}

export async function androidAdbSleep(ip, { execFile = defaultExecFile } = {}) {
  if (!ip) throw new Error('Missing IP for android-adb');
  const target = `${ip}:5555`;
  await execFile('adb', ['connect', target]);
  await execFile('adb', ['-s', target, 'shell', 'input', 'keyevent', 'KEYCODE_SLEEP']);
}

export async function powerOffDevice(device, opts = {}) {
  if (device.driver === 'samsung-lan') {
    await samsungPowerOff(device.ip, opts);
    return true;
  }
  if (device.driver === 'android-adb') {
    await androidAdbSleep(device.ip, opts);
    return true;
  }
  return false;
}
