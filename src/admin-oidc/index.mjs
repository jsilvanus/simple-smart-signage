// Sign-in to /admin with Tunnus (OIDC authorization code + PKCE, confidential client).
// Flow: GET /admin/login -> Tunnus -> GET /admin/callback (code + state) -> token exchange ->
// the access token is verified like any Tunnus token (tunnus.mjs) -> a signed session cookie.
// Rights come only from the token's groups, the same as the API. Setup routes stay password-only.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TX_COOKIE = 'sissi_oidc_tx';
const SESSION_COOKIE = 'sissi_oidc_session';
const TX_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 10_000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** RFC 7636 S256 code challenge for a verifier. */
export function pkceChallenge(verifier) {
  return b64url(createHash('sha256').update(verifier, 'ascii').digest());
}

function parseCookie(header, name) {
  if (!header || typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/**
 * createAdminOidc(config, { tunnus, fetch, now }) -> null when not configured, else the sign-in helpers.
 * config.tunnus carries issuer, audience, oidcClientId, oidcClientSecret.
 */
export function createAdminOidc(config, { tunnus, fetch: fetchFn = globalThis.fetch, now = () => Date.now() } = {}) {
  const t = config?.tunnus;
  if (!t || !tunnus || !t.oidcClientSecret) return null;

  const key = createHmac('sha256', 'sissi-admin-oidc-v1').update(t.oidcClientSecret, 'utf8').digest();

  function sign(payload) {
    const body = b64url(JSON.stringify(payload));
    const sig = createHmac('sha256', key).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  function unsign(value) {
    if (typeof value !== 'string') return null;
    const dot = value.indexOf('.');
    if (dot <= 0) return null;
    const body = value.slice(0, dot);
    const sig = value.slice(dot + 1);
    const expected = createHmac('sha256', key).update(body).digest();
    const actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!payload || typeof payload.exp !== 'number' || now() >= payload.exp) return null;
      return payload;
    } catch {
      return null;
    }
  }

  let discoveryPromise = null;
  async function discover() {
    discoveryPromise ??= (async () => {
      const res = await fetchFn(`${t.issuer}/.well-known/openid-configuration`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res?.ok) throw new Error('OIDC discovery failed');
      const doc = await res.json();
      if (typeof doc?.authorization_endpoint !== 'string' || typeof doc?.token_endpoint !== 'string') {
        throw new Error('OIDC discovery document is incomplete');
      }
      return doc;
    })().catch((err) => {
      discoveryPromise = null; // do not cache a failure
      throw err;
    });
    return discoveryPromise;
  }

  /** Starts sign-in: returns { location, setCookie } for a 302 to Tunnus. */
  async function beginLogin({ redirectUri, cookiePath, secure }) {
    const doc = await discover();
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    const tx = sign({ state, verifier, exp: now() + TX_TTL_MS });
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: t.oidcClientId,
      redirect_uri: redirectUri,
      scope: 'openid profile',
      state,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
      resource: t.audience,
    }).toString();
    const setCookie = `${TX_COOKIE}=${tx}; Path=${cookiePath}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
    return { location: url.toString(), setCookie };
  }

  /** Completes sign-in on the callback. Returns { sessionCookie } or throws Error. */
  async function finishLogin({ code, state, cookieHeader, redirectUri, cookiePath, secure }) {
    const tx = unsign(parseCookie(cookieHeader, TX_COOKIE));
    if (!tx || typeof code !== 'string' || !code || tx.state !== state) {
      throw new Error('Sign-in expired or was started elsewhere. Try again.');
    }
    const doc = await discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: t.oidcClientId,
      client_secret: t.oidcClientSecret,
      code_verifier: tx.verifier,
    });
    const res = await fetchFn(doc.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res?.ok) throw new Error('Tunnus did not accept the sign-in. Try again.');
    const tok = await res.json();
    if (typeof tok?.access_token !== 'string') throw new Error('Tunnus returned no access token.');
    // Same checks as an API token: signature, iss, aud, exp, sub, and rights from groups only.
    const principal = await tunnus.verify(tok.access_token);
    const session = sign({
      sub: principal.sub,
      name: principal.name ?? null,
      rights: [...principal.rights],
      exp: now() + SESSION_TTL_MS,
    });
    const sessionCookie = `${SESSION_COOKIE}=${session}; Path=${cookiePath}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
    const clearTx = `${TX_COOKIE}=; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
    return { sessionCookie, clearTx };
  }

  /** Principal from the session cookie, or null. */
  function readSession(cookieHeader) {
    const payload = unsign(parseCookie(cookieHeader, SESSION_COOKIE));
    if (!payload || typeof payload.sub !== 'string') return null;
    return { kind: 'tunnus', sub: payload.sub, name: payload.name ?? undefined, rights: new Set(payload.rights ?? []) };
  }

  function clearSession(cookiePath, secure) {
    return `${SESSION_COOKIE}=; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
  }

  return { beginLogin, finishLogin, readSession, clearSession, cookieNames: { SESSION_COOKIE, TX_COOKIE } };
}
