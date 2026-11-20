import nodeFs from 'node:fs/promises';
import { probeTcp as defaultProbeTcp } from './probe.mjs';
import { sendWol as defaultSendWol } from './wol.mjs';
import { sendSamsungKey as defaultSendSamsungKey } from './samsung.mjs';
import { sleepAndroidTv as defaultSleepAndroidTv } from './adb.mjs';
import { DEFAULT_DATA_DIR, loadTokens, saveSamsungToken } from './tokens.mjs';

const DRIVER_PROBE_PORTS = {
  'samsung-lan': [8001, 8002],
  'android-adb': [5555],
};

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Create a pull-style LAN power agent that polls SiSSi for desired screen power states
 * and executes WoL / Samsung TLS-WS / ADB sleep locally.
 */
export function createPowerAgent(config, deps = {}) {
  const sissiUrl = normalizeBaseUrl(config?.sissiUrl);
  const agentToken = config?.agentToken || '';
  const dataDir = config?.dataDir || DEFAULT_DATA_DIR;
  const pollSeconds = Number(config?.pollSeconds) > 0 ? Number(config.pollSeconds) : 60;
  const wolBroadcast = config?.wolBroadcast || '255.255.255.255';
  const probeTimeoutMs = Number(config?.probeTimeoutMs) > 0 ? Number(config.probeTimeoutMs) : 1500;
  const maxBackoffSeconds =
    Number(config?.maxBackoffSeconds) > 0 ? Number(config.maxBackoffSeconds) : 300;

  if (!sissiUrl) throw new Error('sissiUrl is required');
  if (!agentToken) throw new Error('agentToken is required');

  const fetchFn = deps.fetch || globalThis.fetch;
  const probeTcp = deps.probeTcp || defaultProbeTcp;
  const sendWol = deps.sendWol || defaultSendWol;
  const sendSamsungKey = deps.sendSamsungKey || defaultSendSamsungKey;
  const sleepAndroidTv = deps.sleepAndroidTv || defaultSleepAndroidTv;
  const fs = deps.fs || nodeFs;
  const logger = deps.logger || console;

  let failures = 0;
  let running = false;
  let timer = null;

  async function processDevice(device, tokens) {
    const { screenId, driver, mac, ip, desiredState } = device;
    const ports = DRIVER_PROBE_PORTS[driver] || [];
    const reachable = ports.length > 0 ? await probeTcp(ip, ports, probeTimeoutMs) : false;

    let lastAction = 'none';
    let error = null;

    if (driver === 'none') {
      return { screenId, reachable, lastAction, error };
    }

    try {
      if (desiredState === 'on' && !reachable) {
        if (!mac) {
          throw new Error(`Missing MAC address for ${screenId}`);
        }
        await sendWol(mac, { broadcast: wolBroadcast });
        lastAction = 'wol';
      } else if (desiredState === 'off' && reachable) {
        if (driver === 'samsung-lan') {
          const currentToken = tokens.samsung?.[ip];
          const res = await sendSamsungKey(ip, { token: currentToken, key: 'KEY_POWER' });
          if (res?.token && res.token !== currentToken) {
            await saveSamsungToken(dataDir, ip, res.token, fs);
            tokens.samsung[ip] = res.token;
          }
          lastAction = 'samsung-power-off';
        } else if (driver === 'android-adb') {
          await sleepAndroidTv(ip);
          lastAction = 'adb-sleep';
        }
      }
    } catch (err) {
      error = err?.message || String(err);
      logger.error?.(`[power-agent] ${screenId} (${driver} ${ip || mac || ''}): ${error}`);
    }

    return { screenId, reachable, lastAction, error };
  }

  async function tick() {
    let desired;
    try {
      const res = await fetchFn(`${sissiUrl}/api/v1/power/desired`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${agentToken}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
      }
      desired = await res.json();
    } catch (err) {
      failures += 1;
      const backoffSeconds = Math.min(maxBackoffSeconds, pollSeconds * 2 ** (failures - 1));
      const error = err?.message || String(err);
      logger.warn?.(
        `[power-agent] poll failed (${error}); retrying in ${backoffSeconds}s`,
      );
      return { ok: false, backoffSeconds, error };
    }

    failures = 0;
    const devices = Array.isArray(desired?.devices) ? desired.devices : [];
    const tokens = await loadTokens(dataDir, fs);

    const reports = [];
    for (const device of devices) {
      reports.push(await processDevice(device, tokens));
    }

    try {
      const reportRes = await fetchFn(`${sissiUrl}/api/v1/power/report`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${agentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ devices: reports }),
      });
      if (!reportRes.ok) {
        logger.warn?.(`[power-agent] report failed: HTTP ${reportRes.status}`);
      }
    } catch (err) {
      logger.warn?.(`[power-agent] report failed: ${err?.message || String(err)}`);
    }

    return { ok: true, devices: reports, nextDelaySeconds: pollSeconds };
  }

  function scheduleNext(delaySeconds) {
    if (!running) return;
    timer = setTimeout(async () => {
      if (!running) return;
      const result = await tick();
      const nextSeconds = result.ok ? result.nextDelaySeconds : result.backoffSeconds;
      scheduleNext(nextSeconds);
    }, delaySeconds * 1000);
  }

  async function start() {
    if (running) return;
    running = true;
    const result = await tick();
    const nextSeconds = result.ok ? result.nextDelaySeconds : result.backoffSeconds;
    scheduleNext(nextSeconds);
  }

  function stop() {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { tick, start, stop };
}
