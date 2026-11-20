import { evaluateSchedule } from './schedule.mjs';
import { defaultPortForDriver, powerOffDevice, probeTcp, wakeViaRouter } from './drivers.mjs';

/**
 * Push-style power manager running on the SiSSi server.
 * Polls screens with `power.routerId` set, probes reachability, wakes via router WoL,
 * and sleeps directly via Samsung WS or Android ADB.
 */
export function createPowerManager({
  config,
  state,
  fetch = globalThis.fetch,
  execFile,
  probe = probeTcp,
  WebSocketImpl = globalThis.WebSocket,
  now = () => new Date(),
} = {}) {
  let timer = null;
  let running = false;
  let currentTick = null;

  async function tick() {
    if (currentTick) return currentTick;
    currentTick = (async () => {
      const nowVal = now();
      const currentNow = nowVal instanceof Date ? nowVal : new Date(nowVal);
      const screens = await state.listScreens();
      const results = [];

      for (const s of screens) {
        const p = s.power;
        if (!p || !p.routerId || !p.driver || p.driver === 'none') continue;

        const desired = evaluateSchedule(p, currentNow);
        const port = defaultPortForDriver(p.driver);
        let reachable = false;
        let lastAction = null;
        let error = null;

        try {
          reachable = Boolean(await probe(p.ip, port));
          if (desired === 'on' && !reachable) {
            const routerConfig = config.powerRouters?.[p.routerId];
            await wakeViaRouter(
              routerConfig,
              { screenId: s.id, mac: p.mac ?? '', ip: p.ip ?? '' },
              { fetch, execFile },
            );
            lastAction = 'wake';
          } else if (desired === 'off' && reachable) {
            const acted = await powerOffDevice(
              { screenId: s.id, driver: p.driver, ip: p.ip ?? '', mac: p.mac ?? '' },
              { dataDir: config.powerDataDir, execFile, WebSocketImpl },
            );
            if (acted) lastAction = 'sleep';
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }

        const report = {
          screenId: s.id,
          reachable,
          lastAction,
          error,
        };
        state.recordPowerReport(p.lanId ?? p.routerId, [report]);
        results.push(report);
      }

      return results;
    })().finally(() => {
      currentTick = null;
    });

    return currentTick;
  }

  function start() {
    if (running) return;
    running = true;
    const intervalMs = Math.max(1, config.powerPollSeconds ?? 60) * 1000;
    timer = setInterval(() => {
      tick().catch((err) => {
        console.error('powerManager tick failed:', err);
      });
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function stop() {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (currentTick) {
      await currentTick.catch(() => {});
    }
  }

  return { tick, start, stop };
}
