// Tunnus service discovery self-registration (docs/tunnus-discovery.md).
//
// One Sissi instance registers two services under the Tunnus discovery API:
//   <prefix>-signage  screens (kind 'screen') as export targets, accepts pushes
//   <prefix>-views    web views (kind 'view' / 'aggregate') for embedding; only 'view' is a push target
// HTTP and retry handling come from the published @tunnus/discovery client.
// Nothing here blocks server start.

import { createHash } from 'node:crypto';
import { createDiscoveryClient } from '@tunnus/discovery';

export const MAX_ENTRIES = 200;
const METADATA_BUDGET_BYTES = 80_000;
const NAME_MAX = 100;
const FORMATS = ['png', 'jpeg', 'mp4'];
const SIGNAGE_CAPABILITIES = ['screen_push', 'playlist_management', 'export_target'];
const VIEW_CAPABILITIES = ['embed', 'export_target'];
const PUSH_INGEST = { path: '/api/v1/push', method: 'POST', content_type: 'application/json' };
const LANDSCAPE_RESOLUTION = { width: 1920, height: 1080 };
const VERTICAL_RESOLUTION = { width: 1080, height: 1920 };
const RETRY_MIN_MS = 10_000;
const RETRY_MAX_MS = 60_000;

/** Service ids for a prefix, e.g. 'sissi' -> ['sissi-signage', 'sissi-views']. */
export function serviceIdsFor(prefix) {
  return [`${prefix}-signage`, `${prefix}-views`];
}

function clampName(value, fallback) {
  const s = String(value ?? '').trim() || fallback;
  return s.length > NAME_MAX ? s.slice(0, NAME_MAX) : s;
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function knownSize(screen) {
  const width = Number(screen.width);
  const height = Number(screen.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Reduced width:height from the screen size, else 16:9 (landscape) or 9:16 (vertical). */
export function aspectRatioOf(screen) {
  const size = knownSize(screen);
  if (size) {
    const g = gcd(size.width, size.height);
    return `${size.width / g}:${size.height / g}`;
  }
  return screen.orientation === 'vertical' ? '9:16' : '16:9';
}

export function resolutionOf(screen) {
  const size = knownSize(screen);
  if (size) return { ...size };
  return { ...(screen.orientation === 'vertical' ? VERTICAL_RESOLUTION : LANDSCAPE_RESOLUTION) };
}

/** One export target for a Sissi screen or view (same shape for both). */
export function exportTargetOf(screen) {
  return {
    id: screen.id,
    name: clampName(screen.name, screen.id),
    category: 'signage',
    aspect_ratio: aspectRatioOf(screen),
    resolution: resolutionOf(screen),
    formats: [...FORMATS],
    multi_page: true,
    ingest: { ...PUSH_INGEST },
    body_defaults: { screenId: screen.id },
  };
}

/**
 * Drops entries from the longest list until the serialized metadata fits the budget.
 * Returns true when anything was dropped.
 */
function fitBudget(metadata, budget = METADATA_BUDGET_BYTES) {
  let dropped = false;
  while (Buffer.byteLength(JSON.stringify(metadata)) > budget) {
    const longest = Object.keys(metadata)
      .filter((k) => Array.isArray(metadata[k]) && metadata[k].length > 0)
      .sort((a, b) => metadata[b].length - metadata[a].length)[0];
    if (!longest) break;
    metadata[longest].pop();
    dropped = true;
  }
  return dropped;
}

/**
 * Builds the two service payloads (with `id`) from the discovery config and Sissi's screens.
 * Pure: no I/O. Returns { services, truncated } where truncated lists what was capped.
 * @param {object} dc config.discovery
 * @param {Array<object>} screens state.listScreens() output
 */
export function buildDiscoveryServices(dc, screens) {
  const base = dc.publicBaseUrl;
  const [signageId, viewsId] = serviceIdsFor(dc.servicePrefix);
  const truncated = [];
  const capped = (list, label) => {
    if (list.length <= MAX_ENTRIES) return list;
    truncated.push(label);
    return list.slice(0, MAX_ENTRIES);
  };

  const screenList = capped(
    screens.filter((s) => (s.kind ?? 'screen') === 'screen'),
    'screens',
  );
  const signageMetadata = {
    export_targets: screenList.map(exportTargetOf),
    screens: screenList.map((s) => s.id),
  };
  if (fitBudget(signageMetadata)) truncated.push('screens (size budget)');

  const viewList = capped(
    screens.filter((s) => s.kind === 'view' || s.kind === 'aggregate'),
    'views',
  );
  const viewsMetadata = {
    views: viewList.map((v) => {
      const root = `${base}/v/${encodeURIComponent(v.id)}`;
      return {
        id: v.id,
        kind: v.kind,
        name: clampName(v.name, v.id),
        frame_url: `${root}/frame`,
        embed_script_url: `${root}/embed.js`,
        playlist_url: `${root}/playlist.json`,
      };
    }),
    export_targets: viewList.filter((v) => v.kind === 'view').map(exportTargetOf),
  };
  if (fitBudget(viewsMetadata)) truncated.push('views (size budget)');

  const services = [
    {
      id: signageId,
      name: 'Sissi signage screens',
      type: 'signage',
      venue: dc.venue,
      endpoint_url: base,
      auth: { type: 'oidc', client_id: dc.clientId, audience: dc.audience },
      capabilities: [...SIGNAGE_CAPABILITIES],
      metadata: signageMetadata,
    },
    {
      id: viewsId,
      name: 'Sissi web views',
      type: 'webview',
      venue: dc.venue,
      endpoint_url: base,
      auth: { type: 'none' },
      capabilities: [...VIEW_CAPABILITIES],
      metadata: viewsMetadata,
    },
  ];
  return { services, truncated };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function withTimeout(promise, ms) {
  let handle;
  const timeout = new Promise((resolve) => {
    handle = setTimeout(() => resolve(undefined), ms);
    handle.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}

const DISABLED = Object.freeze({
  enabled: false,
  start() {},
  async stop() {},
  async refresh() {
    return false;
  },
  status() {
    return { enabled: false, running: false, registered: false, fatal: false };
  },
});

/**
 * Discovery lifecycle controller. One @tunnus/discovery client per service; the client's
 * service is fixed at creation, so a changed payload replaces its client (PUT overwrites).
 *   start()    begins registration in the background and checks for changes every heartbeat interval
 *   refresh()  checks for changes now; never rejects (admin routes fire and forget)
 *   stop({ deregister: true })  stops clients and best-effort DELETEs both services (bounded)
 * A 401/403 from Tunnus marks the controller fatal: no further requests, nothing retried.
 *
 * options: { state, logger, fetch, checkMs, retryMinMs, retryMaxMs }
 */
export function createDiscovery(config, options = {}) {
  const dc = config.discovery;
  if (!dc) return DISABLED;

  const logger = options.logger ?? console;
  const state = options.state;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const checkMs = options.checkMs ?? dc.heartbeatSeconds * 1000;
  const retryMinSec = (options.retryMinMs ?? RETRY_MIN_MS) / 1000;
  const retryMaxSec = (options.retryMaxMs ?? RETRY_MAX_MS) / 1000;

  let running = false;
  let fatal = false;
  let timer = null;
  let chain = Promise.resolve();
  /** @type {Map<string, { hash: string, client: ReturnType<typeof createDiscoveryClient> }>} */
  const clients = new Map();

  function markFatal(status) {
    if (fatal) return;
    fatal = true;
    clearInterval(timer);
    timer = null;
    for (const { client } of clients.values()) client.stop();
    logger.error?.(`[discovery] Tunnus refused the discovery client (${status}); not retrying`);
  }

  // Watches every Tunnus response so an auth refusal stops all clients, whichever one saw it.
  const guardedFetch = async (url, init) => {
    const res = await fetchFn(url, init);
    if (res.status === 401 || res.status === 403) markFatal(res.status);
    return res;
  };

  function startClient(service) {
    const client = createDiscoveryClient({
      tunnusUrl: dc.tunnusUrl,
      clientId: dc.clientId,
      clientSecret: dc.clientSecret,
      service,
      heartbeatIntervalSec: dc.heartbeatSeconds,
      retryIntervalSec: retryMinSec,
      maxRetryIntervalSec: retryMaxSec,
      autoDeregisterOnShutdown: false,
      backgroundInitialRegister: true,
      logger,
      fetch: guardedFetch,
    });
    client.start().catch((err) => logger.error?.(`[discovery] start failed: ${err.message}`));
    return client;
  }

  async function reconcile() {
    if (!running || fatal) return false;
    const screens = await state.listScreens();
    const { services, truncated } = buildDiscoveryServices(dc, screens);
    let changed = false;
    for (const service of services) {
      const hash = sha256(JSON.stringify(service));
      const current = clients.get(service.id);
      if (current?.hash === hash) continue;
      current?.client.stop();
      clients.set(service.id, { hash, client: startClient(service) });
      changed = true;
      logger.info?.(`[discovery] registering ${service.id}`);
    }
    if (changed && truncated.length) {
      logger.warn?.(`[discovery] capped ${truncated.join(', ')} at ${MAX_ENTRIES} entries`);
    }
    return changed;
  }

  // Serialises reconciliations so a refresh cannot race the periodic check.
  function enqueue() {
    const run = chain.then(reconcile);
    chain = run.catch(() => {});
    return run;
  }

  return {
    enabled: true,

    start() {
      if (running) return;
      running = true;
      enqueue().catch((err) => logger.warn?.(`[discovery] initial check failed: ${err.message}`));
      timer = setInterval(() => {
        enqueue().catch((err) => logger.warn?.(`[discovery] check failed: ${err.message}`));
      }, checkMs);
      timer.unref?.();
    },

    async refresh() {
      if (!running || fatal) return false;
      try {
        await enqueue();
        return true;
      } catch (err) {
        logger.warn?.(`[discovery] re-sync failed: ${err.message}`);
        return false;
      }
    },

    async stop({ deregister = false, timeoutMs = 3000 } = {}) {
      running = false;
      clearInterval(timer);
      timer = null;
      await withTimeout(chain, timeoutMs);
      const entries = [...clients.entries()];
      for (const [, { client }] of entries) client.stop();
      clients.clear();
      if (!deregister || fatal) return;
      await Promise.all(
        entries.map(async ([id, { client }]) => {
          const ok = await withTimeout(client.deregister(), timeoutMs);
          if (ok === true) logger.info?.(`[discovery] deregistered ${id}`);
          else logger.warn?.(`[discovery] deregister ${id} did not complete`);
        }),
      );
    },

    status() {
      const all = [...clients.values()];
      return {
        enabled: true,
        running,
        registered: all.length > 0 && all.every(({ client }) => client.state.isRegistered),
        fatal,
      };
    },
  };
}
