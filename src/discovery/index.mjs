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
const PUSH_PATH = '/api/v1/push';
const LANDSCAPE_RESOLUTION = { width: 1920, height: 1080 };
const VERTICAL_RESOLUTION = { width: 1080, height: 1920 };
const RETRY_MIN_MS = 10_000;
const RETRY_MAX_MS = 60_000;
const DELETE_FALLBACK_MS = 3000;

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

/**
 * One export target for a Sissi screen or view. `ingest.url` is absolute (the public path is kept);
 * `ingestAuth` is set only on view targets, whose service itself has no auth.
 */
export function exportTargetOf(screen, publicBaseUrl, ingestAuth = null) {
  const target = {
    id: screen.id,
    name: clampName(screen.name, screen.id),
    category: 'signage',
    aspect_ratio: aspectRatioOf(screen),
    resolution: resolutionOf(screen),
    formats: [...FORMATS],
    multi_page: true,
    ingest: { url: `${publicBaseUrl}${PUSH_PATH}`, method: 'POST', content_type: 'application/json' },
    body_defaults: { screenId: screen.id },
  };
  if (ingestAuth) target.ingest.auth = { ...ingestAuth };
  return target;
}

function signageMetadataFor(list, base) {
  return {
    export_targets: list.map((s) => exportTargetOf(s, base)),
    screens: list.map((s) => s.id),
  };
}

function viewsMetadataFor(list, base, authSpec) {
  return {
    views: list.map((v) => {
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
    // A view is dropped from both lists together, so they stay consistent.
    export_targets: list.filter((v) => v.kind === 'view').map((v) => exportTargetOf(v, base, authSpec)),
  };
}

/** Keeps the longest prefix of `list` whose metadata fits the byte budget. */
function fitList(list, build, budget = METADATA_BUDGET_BYTES) {
  let kept = list;
  while (kept.length > 0 && Buffer.byteLength(JSON.stringify(build(kept))) > budget) {
    kept = kept.slice(0, -1);
  }
  return kept;
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
  const authSpec = { type: 'oidc', client_id: dc.publisherClientId, audience: dc.audience };
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
  const keptScreens = fitList(screenList, (l) => signageMetadataFor(l, base));
  if (keptScreens.length < screenList.length) truncated.push('screens (size budget)');

  const viewList = capped(
    screens.filter((s) => s.kind === 'view' || s.kind === 'aggregate'),
    'views',
  );
  const keptViews = fitList(viewList, (l) => viewsMetadataFor(l, base, authSpec));
  if (keptViews.length < viewList.length) truncated.push('views (size budget)');

  const services = [
    {
      id: signageId,
      name: 'Sissi signage screens',
      type: 'signage',
      venue: dc.venue,
      endpoint_url: base,
      auth: { ...authSpec },
      capabilities: [...SIGNAGE_CAPABILITIES],
      metadata: signageMetadataFor(keptScreens, base),
    },
    {
      id: viewsId,
      name: 'Sissi web views',
      type: 'webview',
      venue: dc.venue,
      endpoint_url: base,
      auth: { type: 'none' },
      capabilities: [...VIEW_CAPABILITIES],
      metadata: viewsMetadataFor(keptViews, base, authSpec),
    },
  ];
  return { services, truncated };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function abortError() {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

/** Resolves when `promise` settles or `signal` aborts, whichever comes first. */
function untilAborted(promise, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener('abort', () => resolve(), { once: true });
    promise.then(
      () => resolve(),
      () => resolve(),
    );
  });
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
 * service is fixed at creation, so a changed payload replaces its client: the old client's
 * in-flight requests are aborted and drained before the new one starts (PUT overwrites).
 *   start()    begins registration in the background and checks for changes every heartbeat interval
 *   refresh()  checks for changes now; never rejects (admin routes fire and forget)
 *   stop({ deregister: true, timeoutMs })  aborts in-flight requests, then best-effort DELETEs both
 *              services. Everything is bounded by one budget of timeoutMs (default 3 s).
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
  let shutdownSignal = null;
  /** @type {Map<string, { id: string, hash: string, client: object, abort: () => void, drain: () => Promise<void> }>} */
  const clients = new Map();

  function markFatal(status) {
    if (fatal) return;
    fatal = true;
    clearInterval(timer);
    timer = null;
    for (const entry of clients.values()) entry.abort();
    logger.error?.(`[discovery] Tunnus refused the discovery client (${status}); not retrying`);
  }

  // Watches every Tunnus response so an auth refusal stops all clients, whichever one saw it.
  const guardedFetch = async (url, init) => {
    const res = await fetchFn(url, init);
    if (res.status === 401 || res.status === 403) markFatal(res.status);
    return res;
  };

  /**
   * Starts one client for one service. Its PUT/heartbeat requests share an AbortController and
   * are tracked, so replacing or stopping the client cancels them and waits for them to settle.
   * DELETE is the exception: it uses the shutdown budget, so it still runs after an abort.
   */
  function startClient(service) {
    const ac = new AbortController();
    const inflight = new Set();
    const entry = {
      id: service.id,
      hash: null,
      client: null,
      abort() {
        ac.abort();
        entry.client.stop();
      },
      async drain() {
        await Promise.allSettled([...inflight]);
      },
    };
    const boundFetch = (url, init = {}) => {
      const isDelete = init.method === 'DELETE';
      if (!isDelete && ac.signal.aborted) return Promise.reject(abortError());
      const signal = isDelete ? (shutdownSignal ?? AbortSignal.timeout(DELETE_FALLBACK_MS)) : ac.signal;
      const request = (async () => {
        const res = await guardedFetch(url, { ...init, signal });
        // Aborted while the response was on its way: fail before the client reads the body.
        if (!isDelete && ac.signal.aborted) throw abortError();
        return res;
      })();
      inflight.add(request);
      const done = () => inflight.delete(request);
      request.then(done, done);
      return request;
    };
    entry.client = createDiscoveryClient({
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
      fetch: boundFetch,
    });
    entry.client.start().catch((err) => logger.error?.(`[discovery] start failed: ${err.message}`));
    return entry;
  }

  async function reconcile() {
    if (!running || fatal) return false;
    const screens = await state.listScreens();
    // stop() or a fatal auth error may have happened while the list was read.
    if (!running || fatal) return false;
    const { services, truncated } = buildDiscoveryServices(dc, screens);
    let changed = false;
    for (const service of services) {
      const hash = sha256(JSON.stringify(service));
      const current = clients.get(service.id);
      if (current?.hash === hash) continue;
      if (current) {
        clients.delete(service.id);
        current.abort();
        await current.drain();
      }
      if (!running || fatal) return changed;
      const entry = startClient(service);
      entry.hash = hash;
      clients.set(service.id, entry);
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
      const budget = AbortSignal.timeout(timeoutMs);
      shutdownSignal = budget;
      const entries = [...clients.values()];
      clients.clear();
      for (const entry of entries) entry.abort();
      await untilAborted(chain, budget);
      if (!deregister || fatal) return;
      await untilAborted(
        Promise.all(
          entries.map(async (entry) => {
            const ok = await entry.client.deregister();
            if (ok === true) logger.info?.(`[discovery] deregistered ${entry.id}`);
            else logger.warn?.(`[discovery] deregister ${entry.id} did not complete`);
          }),
        ),
        budget,
      );
    },

    status() {
      const all = [...clients.values()];
      return {
        enabled: true,
        running,
        registered: all.length > 0 && all.every((entry) => entry.client.state.isRegistered),
        fatal,
      };
    },
  };
}
