import { createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';
import { HttpError, sendError } from '../router.mjs';
import * as testing from './testing.mjs';

export { testing };

const CANVA_JWKS_BASE = 'https://api.canva.com';
const JWKS_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const JWKS_REFRESH_COOLDOWN_MS = 30 * 1000;
const JWKS_TIMEOUT_MS = 10_000;
const CORS_ALLOW_HEADERS = 'Authorization, Content-Type, X-Sissi-Admin';
const CORS_ALLOW_METHODS = 'GET, POST, DELETE, PATCH, PUT';
const CORS_MAX_AGE = '86400';

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function safeEqual(a, b) {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

function decodeJwtPart(part) {
  if (!part || !B64URL_RE.test(part)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createJwksResolver(appId, { fetchFn, now }) {
  const jwksUrl = `${CANVA_JWKS_BASE}/rest/v1/apps/${encodeURIComponent(appId)}/jwks`;
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

/**
 * createAuth(config, { fetch?, now? }) -> { authenticate(req), handleCors(req, res), applyCors(req, res) }
 */
export function createAuth(config, { fetch: fetchFn = globalThis.fetch, now = () => Date.now() } = {}) {
  const appId = config?.canva?.appId || '';
  const allowedBrands = new Set(config?.canva?.allowedBrands ?? []);
  const hasCanva = Boolean(appId && allowedBrands.size > 0);
  const pushKey = config?.pushKey || '';
  const hasPushKey = Boolean(pushKey);
  const corsOrigins = new Set(config?.corsOrigins ?? []);

  const getKey = hasCanva ? createJwksResolver(appId, { fetchFn, now }) : null;

  async function verifyCanvaToken(token) {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }

    const [headerB64, payloadB64, sigB64] = parts;
    const header = decodeJwtPart(headerB64);
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }

    if (!sigB64 || !B64URL_RE.test(sigB64)) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }

    let publicKey;
    try {
      publicKey = await getKey(header.kid);
    } catch {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }
    if (!publicKey) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }

    const sigBuf = Buffer.from(sigB64, 'base64url');
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
    let validSig = false;
    try {
      validSig = cryptoVerify('RSA-SHA256', signingInput, publicKey, sigBuf);
    } catch {
      validSig = false;
    }
    if (!validSig) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }

    const payload = decodeJwtPart(payloadB64);
    if (!payload) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }

    const audOk =
      payload.aud === appId || (Array.isArray(payload.aud) && payload.aud.includes(appId));
    if (!audOk) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }

    const nowSec = now() / 1000;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || nowSec >= payload.exp) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }
    if (
      payload.nbf !== undefined &&
      (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || nowSec < payload.nbf)
    ) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }

    if (typeof payload.brandId !== 'string' || !payload.brandId) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }

    if (!allowedBrands.has(payload.brandId)) {
      throw new HttpError(
        'TEAM_NOT_ALLOWED',
        'Your Canva team is not allowed to publish to signage',
      );
    }

    return { kind: 'canva', brandId: payload.brandId };
  }

  async function authenticate(req) {
    if (!hasCanva && !hasPushKey) {
      throw new HttpError('AUTH_NOT_CONFIGURED', 'Authentication is not configured');
    }

    const header = req.headers?.authorization ?? '';
    const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!m) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }
    const token = m[1];

    if (hasPushKey && safeEqual(token, pushKey)) {
      return { kind: 'pushkey' };
    }

    if (!hasCanva) {
      throw new HttpError('UNAUTHORIZED', 'Unauthorized');
    }

    return verifyCanvaToken(token);
  }

  function applyCors(req, res) {
    const origin = req.headers?.origin;
    if (!origin || !corsOrigins.has(origin)) return false;

    res.setHeader('Access-Control-Allow-Origin', origin);
    const existingVary = res.getHeader('Vary');
    if (!existingVary) {
      res.setHeader('Vary', 'Origin');
    } else if (!String(existingVary).toLowerCase().includes('origin')) {
      res.setHeader('Vary', `${existingVary}, Origin`);
    }
    res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
    res.setHeader('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
    res.setHeader('Access-Control-Max-Age', CORS_MAX_AGE);
    return true;
  }

  function handleCors(req, res) {
    if (req.method?.toUpperCase() !== 'OPTIONS') {
      applyCors(req, res);
      return false;
    }

    const origin = req.headers?.origin;
    if (!origin || !corsOrigins.has(origin)) {
      sendError(res, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed', 403);
      return true;
    }

    applyCors(req, res);
    res.writeHead(204);
    res.end();
    return true;
  }

  return { authenticate, handleCors, applyCors };
}
