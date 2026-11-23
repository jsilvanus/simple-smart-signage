// Tunnus (the parish's OpenID Connect provider) access-token verification for Sissi.
// Checks: RS256 signature against the issuer's JWKS, iss, aud contains Sissi's own audience,
// exp/nbf, sub. Rights come ONLY from the `groups` claim through SISSI_TUNNUS_GROUP_RIGHTS.
import { verify as cryptoVerify } from 'node:crypto';
import { HttpError } from '../router.mjs';
import { createJwksResolver } from './jwks.mjs';

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const DISCOVERY_TIMEOUT_MS = 10_000;

function decodePart(part) {
  if (!part || !B64URL_RE.test(part)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const unauthorized = () => new HttpError('UNAUTHORIZED', 'Unauthorized');

/** Unverified peek at `iss`, used only to route a Bearer token to the right verifier. */
export function peekIssuer(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const payload = decodePart(parts[1]);
  return typeof payload?.iss === 'string' ? payload.iss.replace(/\/+$/, '') : null;
}

export function createTunnusVerifier(config, { fetch: fetchFn = globalThis.fetch, now = () => Date.now() } = {}) {
  const t = config.tunnus;
  if (!t) return null;

  let jwksUrlPromise = null;
  async function discoverJwksUrl() {
    if (t.jwksUrl) return t.jwksUrl;
    const res = await fetchFn(`${t.issuer}/.well-known/openid-configuration`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res || !res.ok) throw new Error('OIDC discovery failed');
    const doc = await res.json();
    if (String(doc?.issuer ?? '').replace(/\/+$/, '') !== t.issuer || typeof doc?.jwks_uri !== 'string') {
      throw new Error('OIDC discovery document does not match the configured issuer');
    }
    return doc.jwks_uri;
  }
  const getJwksUrl = () => {
    // Do not cache a failure: Sissi must start and serve without Tunnus being reachable.
    jwksUrlPromise ??= discoverJwksUrl().catch((err) => {
      jwksUrlPromise = null;
      throw err;
    });
    return jwksUrlPromise;
  };
  const getKey = createJwksResolver(getJwksUrl, { fetchFn, now });

  /** token -> { sub, name, rights: Set<string> }. Throws HttpError UNAUTHORIZED / FORBIDDEN. */
  async function verify(token) {
    const parts = String(token).split('.');
    if (parts.length !== 3) throw unauthorized();
    const [headerB64, payloadB64, sigB64] = parts;
    const header = decodePart(headerB64);
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw unauthorized();
    if (!sigB64 || !B64URL_RE.test(sigB64)) throw unauthorized();

    let key;
    try {
      key = await getKey(header.kid);
    } catch {
      throw unauthorized();
    }
    if (!key) throw unauthorized();

    let ok = false;
    try {
      ok = cryptoVerify('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'), key, Buffer.from(sigB64, 'base64url'));
    } catch {
      ok = false;
    }
    if (!ok) throw unauthorized();

    const p = decodePart(payloadB64);
    if (!p) throw unauthorized();
    if (typeof p.iss !== 'string' || p.iss.replace(/\/+$/, '') !== t.issuer) throw unauthorized();
    const audOk = p.aud === t.audience || (Array.isArray(p.aud) && p.aud.includes(t.audience));
    if (!audOk) throw unauthorized();

    const nowSec = now() / 1000;
    const leeway = t.leewaySeconds;
    if (typeof p.exp !== 'number' || !Number.isFinite(p.exp) || nowSec >= p.exp + leeway) throw unauthorized();
    if (p.nbf !== undefined && (typeof p.nbf !== 'number' || !Number.isFinite(p.nbf) || nowSec + leeway < p.nbf)) {
      throw unauthorized();
    }
    if (typeof p.sub !== 'string' || !p.sub) throw unauthorized();

    const groups = Array.isArray(p.groups) ? p.groups.filter((g) => typeof g === 'string') : [];
    const rights = new Set();
    for (const g of groups) for (const r of t.groupRights.get(g) ?? []) rights.add(r);
    if (rights.size === 0) {
      throw new HttpError('FORBIDDEN', 'Your account has no signage rights');
    }
    return { kind: 'tunnus', sub: p.sub, name: typeof p.name === 'string' ? p.name : undefined, rights };
  }

  return { verify, issuer: t.issuer };
}

/**
 * need: 'read' (read, write or operate) | 'any' (write or operate) | 'write' | 'operate' | array of those (all required).
 * Rights are independent: operate does not imply write, nor the other way round. Read is the
 * only right that write or operate also satisfy, because they can already see everything read shows.
 */
export function assertRights(principal, need) {
  if (principal?.kind !== 'tunnus') return; // legacy principals keep their existing trust
  const needs = Array.isArray(need) ? need : [need];
  for (const n of needs) {
    let allowed;
    let label;
    if (n === 'read') {
      allowed = ['sissi:read', 'sissi:write', 'sissi:operate'].some((r) => principal.rights.has(r));
      label = 'sissi:read, sissi:write or sissi:operate';
    } else if (n === 'any') {
      allowed = principal.rights.has('sissi:write') || principal.rights.has('sissi:operate');
      label = 'sissi:write or sissi:operate';
    } else {
      allowed = principal.rights.has(`sissi:${n}`);
      label = `sissi:${n}`;
    }
    if (!allowed) {
      throw new HttpError('FORBIDDEN', `Requires ${label}`);
    }
  }
}
