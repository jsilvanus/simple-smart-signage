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

  const RIGHT_KEY_RE = /^sissi:(read|write|operate)(?::(screen|view):([A-Za-z0-9_-]+))?$/;

  function expandClaimRight(raw) {
    if (raw === 'sissi:admin') return ['sissi:read', 'sissi:write', 'sissi:operate'];
    if (RIGHT_KEY_RE.test(raw)) return [raw];
    return [];
  }

  async function verifyClaims(token, expectedAudience, expectedNonce = null) {
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
    const audOk = p.aud === expectedAudience || (Array.isArray(p.aud) && p.aud.includes(expectedAudience));
    if (!audOk) throw unauthorized();

    const nowSec = now() / 1000;
    const leeway = t.leewaySeconds;
    if (typeof p.exp !== 'number' || !Number.isFinite(p.exp) || nowSec >= p.exp + leeway) throw unauthorized();
    if (p.nbf !== undefined && (typeof p.nbf !== 'number' || !Number.isFinite(p.nbf) || nowSec + leeway < p.nbf)) {
      throw unauthorized();
    }
    if (expectedNonce && p.nonce !== expectedNonce) throw unauthorized();
    if (typeof p.sub !== 'string' || !p.sub) throw unauthorized();

    const groups = Array.isArray(p.groups) ? p.groups.filter((g) => typeof g === 'string') : [];
    const scopeParts = typeof p.scope === 'string' ? p.scope.split(/\s+/).filter(Boolean) : [];
    const rights = new Set();
    for (const g of groups) {
      for (const r of t.groupRights.get(g) ?? []) rights.add(r);
      for (const r of expandClaimRight(g)) rights.add(r);
    }
    for (const s of scopeParts) {
      for (const r of expandClaimRight(s)) rights.add(r);
    }
    if (rights.size === 0) {
      throw new HttpError('FORBIDDEN', 'Your account has no signage rights');
    }
    return { kind: 'tunnus', sub: p.sub, name: typeof p.name === 'string' ? p.name : undefined, rights };
  }

  /** API access token -> { sub, name, rights: Set<string> }. Throws HttpError UNAUTHORIZED / FORBIDDEN. */
  async function verify(token) {
    return verifyClaims(token, t.audience);
  }

  /** OIDC ID token -> { sub, name, rights: Set<string> }. Checks aud === oidcClientId and optional nonce. */
  async function verifyIdToken(idToken, { nonce } = {}) {
    if (!t.oidcClientId) throw unauthorized();
    return verifyClaims(idToken, t.oidcClientId, nonce ?? null);
  }

  return { verify, verifyIdToken, issuer: t.issuer };
}

const PARSE_RIGHT_RE = /^sissi:(read|write|operate)(?::(screen|view):([A-Za-z0-9_-]+))?$/;

export function parseRightKey(key) {
  const m = PARSE_RIGHT_RE.exec(String(key ?? ''));
  if (!m) return null;
  return { action: m[1], targetKind: m[2] ?? null, targetId: m[3] ?? null };
}

function actionSatisfies(grantedAction, neededAction) {
  if (neededAction === 'read') return grantedAction === 'read' || grantedAction === 'write' || grantedAction === 'operate';
  return grantedAction === neededAction;
}

export function hasRight(principal, need, target = null) {
  if (principal?.kind !== 'tunnus') return true;
  if (need === 'any') return hasRight(principal, 'write', target) || hasRight(principal, 'operate', target);
  for (const key of principal.rights ?? []) {
    const parsed = parseRightKey(key);
    if (!parsed || !actionSatisfies(parsed.action, need)) continue;
    if (!parsed.targetKind) return true;
    if (!target) return true;
    if (parsed.targetKind === target.kind && parsed.targetId === target.id) return true;
  }
  return false;
}

export function rightsForTarget(principal, target) {
  return ['read', 'write', 'operate'].filter((a) => hasRight(principal, a, target));
}

/**
 * need: 'read' (read, write or operate) | 'any' (write or operate) | 'write' | 'operate' | array of those (all required).
 * target: optional { kind: 'screen' | 'view', id: string } to check scoped rights in addition to global rights.
 */
export function assertRights(principal, need, target = null) {
  if (principal?.kind !== 'tunnus') return; // legacy principals keep their existing trust
  const needs = Array.isArray(need) ? need : [need];
  for (const n of needs) {
    const allowed = hasRight(principal, n, target);
    const label =
      n === 'read'
        ? 'sissi:read, sissi:write or sissi:operate'
        : n === 'any'
          ? 'sissi:write or sissi:operate'
          : `sissi:${n}`;
    if (!allowed) {
      throw new HttpError('FORBIDDEN', `Requires ${label}`);
    }
  }
}
