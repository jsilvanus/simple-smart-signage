import { createPublicKey } from 'node:crypto';

const JWKS_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const JWKS_REFRESH_COOLDOWN_MS = 30 * 1000;
const JWKS_TIMEOUT_MS = 10_000;

/**
 * getUrl: a URL string or an async function returning one (OIDC discovery).
 * Returns getKey(kid) -> KeyObject | null. Keys are cached for an hour; an unknown kid
 * triggers one refresh per 30 s.
 */
export function createJwksResolver(getUrl, { fetchFn, now }) {
  let keysByKid = new Map();
  let fetchedAt = -Infinity;
  let lastAttemptAt = -Infinity;
  let inFlight = null;

  async function refresh() {
    if (inFlight) return inFlight;
    const t = now();
    if (t - lastAttemptAt < JWKS_REFRESH_COOLDOWN_MS) {
      return;
    }
    lastAttemptAt = t;

    inFlight = (async () => {
      const jwksUrl = typeof getUrl === 'function' ? await getUrl() : getUrl;
      const res = await fetchFn(jwksUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
      });
      if (!res || !res.ok) {
        throw new Error(`JWKS fetch failed (${res?.status ?? 'no response'})`);
      }
      const body = await res.json();
      if (!body || !Array.isArray(body.keys)) {
        throw new Error('Invalid JWKS payload');
      }
      const next = new Map();
      for (const jwk of body.keys) {
        if (!jwk || typeof jwk.kid !== 'string' || !jwk.kid) continue;
        if (jwk.kty !== 'RSA') continue;
        if (jwk.use && jwk.use !== 'sig') continue;
        if (jwk.alg && jwk.alg !== 'RS256') continue;
        try {
          next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
        } catch {
          // Ignore malformed individual JWK entries.
        }
      }
      keysByKid = next;
      fetchedAt = now();
    })();

    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return async function getKey(kid) {
    const expired = now() - fetchedAt >= JWKS_CACHE_MAX_AGE_MS;
    if (expired) {
      await refresh();
      return keysByKid.get(kid) ?? null;
    }

    const cached = keysByKid.get(kid);
    if (cached) return cached;

    // Unknown kid: refresh once (subject to rate-limit cooldown) in case Canva rotated keys.
    await refresh();
    return keysByKid.get(kid) ?? null;
  };
}
