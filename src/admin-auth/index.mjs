import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../router.mjs';
import { assertRights, createTunnusVerifier } from '../auth/tunnus.mjs';

const COOKIE_NAME = 'sissi_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function toMs(val) {
  return val instanceof Date ? val.getTime() : Number(val);
}

function parseCookie(header, name) {
  if (!header || typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}

function clientIp(req) {
  return req?.socket?.remoteAddress || 'unknown';
}

/**
 * Create admin session authentication and rate-limited login/logout helpers.
 */
export function createAdminAuth(config, { now = () => Date.now(), fetch: fetchFn = globalThis.fetch, tunnus, oidc = null } = {}) {
  const mode = config?.authMode ?? 'legacy';
  const tunnusVerifier = mode === 'legacy' ? null : (tunnus ?? createTunnusVerifier(config, { fetch: fetchFn, now }));
  const passwordOn = mode !== 'tunnus';
  const failuresByIp = new Map();
  const cookiePath = config?.publicPath || '/';
  const secureAttr = config?.production ? '; Secure' : '';

  function getNowMs() {
    return toMs(now());
  }

  function ensureConfigured() {
    if (!config?.adminPassword) {
      throw new HttpError('AUTH_NOT_CONFIGURED', 'Admin authentication is not configured');
    }
  }

  function deriveHmacKey() {
    return createHmac('sha256', 'sissi-admin-session-v1')
      .update(config.adminPassword, 'utf8')
      .digest();
  }

  function pruneFailures(ip, nowMs) {
    const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
    const list = failuresByIp.get(ip);
    if (!list) return [];
    const recent = list.filter((ts) => ts > cutoff);
    if (recent.length === 0) {
      failuresByIp.delete(ip);
    } else if (recent.length !== list.length) {
      failuresByIp.set(ip, recent);
    }
    return recent;
  }

  function recordFailure(ip, nowMs) {
    if (failuresByIp.size > 1000) {
      for (const key of failuresByIp.keys()) {
        pruneFailures(key, nowMs);
      }
    }
    const recent = pruneFailures(ip, nowMs);
    recent.push(nowMs);
    failuresByIp.set(ip, recent);
  }

  function signToken(nowMs) {
    const payload = { exp: nowMs + SESSION_TTL_MS };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sigB64 = createHmac('sha256', deriveHmacKey()).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sigB64}`;
  }

  function verifyToken(token, nowMs) {
    if (!token || typeof token !== 'string') return false;
    const dot = token.indexOf('.');
    if (dot === -1 || token.indexOf('.', dot + 1) !== -1) return false;
    const payloadB64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    if (!B64URL_RE.test(payloadB64) || !B64URL_RE.test(sigB64)) return false;

    const expectedSig = createHmac('sha256', deriveHmacKey()).update(payloadB64).digest();
    const actualSig = Buffer.from(sigB64, 'base64url');
    if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
      return false;
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      return false;
    }
    if (!payload || typeof payload !== 'object' || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return false;
    }
    return nowMs < payload.exp;
  }

  async function login(req, res, body) {
    if (!passwordOn) throw new HttpError('UNAUTHORIZED', 'Password sign-in is disabled');
    ensureConfigured();
    const nowMs = getNowMs();
    const ip = clientIp(req);
    const recent = pruneFailures(ip, nowMs);
    if (recent.length >= MAX_FAILURES) {
      throw new HttpError('RATE_LIMITED', 'Too many failed login attempts');
    }

    const candidate = typeof body?.password === 'string' ? body.password : '';
    const ok =
      typeof body?.password === 'string' &&
      timingSafeEqual(sha256(candidate), sha256(config.adminPassword));

    if (!ok) {
      recordFailure(ip, nowMs);
      throw new HttpError('UNAUTHORIZED', 'Invalid admin password');
    }

    failuresByIp.delete(ip);
    const token = signToken(nowMs);
    const cookie = `${COOKIE_NAME}=${token}; Path=${cookiePath}; HttpOnly; SameSite=Strict${secureAttr}`;
    res.writeHead(204, { 'set-cookie': cookie });
    res.end();
  }

  function requireAdmin(req) {
    const method = String(req?.method ?? 'GET').toUpperCase();
    const session = oidc?.readSession(req?.headers?.cookie);
    if (session?.rights?.has('sissi:write') && session?.rights?.has('sissi:operate')) {
      if (STATE_CHANGING_METHODS.has(method) && req?.headers?.['x-sissi-admin'] !== '1') {
        throw new HttpError('UNAUTHORIZED', 'Missing X-Sissi-Admin header');
      }
      return;
    }
    if (!passwordOn) throw new HttpError('UNAUTHORIZED', 'Password sign-in is disabled');
    ensureConfigured();
    const token = parseCookie(req?.headers?.cookie, COOKIE_NAME);
    if (!verifyToken(token, getNowMs())) {
      throw new HttpError('UNAUTHORIZED', 'Admin authentication required');
    }
    if (STATE_CHANGING_METHODS.has(method) && req?.headers?.['x-sissi-admin'] !== '1') {
      throw new HttpError('UNAUTHORIZED', 'Missing X-Sissi-Admin header');
    }
  }

  /**
   * Tunnus-aware gate for the routes a person with sissi rights may use.
   * A Bearer token is verified as a Tunnus token and checked against `need`
   * ('any' | 'write' | 'operate' | array = all). Without a Bearer header the admin
   * cookie is required, exactly as before (unless SISSI_AUTH_MODE=tunnus). Setup routes
   * (screens, power) keep calling requireAdmin and never accept a Tunnus token.
   */
  async function authorize(req, need, target = null) {
    const m = /^Bearer\s+(\S+)$/i.exec((req?.headers?.authorization ?? '').trim());
    if (m && tunnusVerifier) {
      const principal = await tunnusVerifier.verify(m[1]);
      assertRights(principal, need, target);
      return principal;
    }
    // Browser session from the Tunnus sign-in on /admin. Writes still need the X-Sissi-Admin header.
    const session = oidc?.readSession(req?.headers?.cookie);
    if (session) {
      if (STATE_CHANGING_METHODS.has(String(req?.method ?? 'GET').toUpperCase()) && req?.headers?.['x-sissi-admin'] !== '1') {
        throw new HttpError('UNAUTHORIZED', 'Missing X-Sissi-Admin header');
      }
      assertRights(session, need, target);
      return session;
    }
    requireAdmin(req);
    return { kind: 'admin' };
  }

  function hasAdminCookie(req) {
    if (config.authMode === 'tunnus' || !secret) return false;
    try {
      const token = parseCookie(req?.headers?.cookie, COOKIE_NAME);
      return Boolean(token && verifyToken(token));
    } catch {
      return false;
    }
  }

  function logout(req, res) {
    const cookie = `${COOKIE_NAME}=; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=0${secureAttr}`;
    res.writeHead(204, { 'set-cookie': cookie });
    res.end();
  }

  return {
    login,
    requireAdmin,
    hasAdminCookie,
    authorize,
    logout,
  };
}
