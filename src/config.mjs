// Parses and validates all environment variables (plan sections 4.1, 6, 11).
// loadConfig(env) is pure: it throws ConfigError listing every problem.

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const MB = 1024 * 1024;

function list(v) {
  return String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizePublicPath(p) {
  let s = String(p ?? '').trim();
  if (s === '' || s === '/') return '';
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/+$/, '');
}

export const SISSI_RIGHTS = Object.freeze(['sissi:read', 'sissi:write', 'sissi:operate']);
const SCOPED_RIGHT_RE = /^sissi:(read|write|operate)(?::(screen|view):[A-Za-z0-9_-]+)?$/;

function expandRightToken(token) {
  if (token === 'sissi:admin') return SISSI_RIGHTS;
  if (SCOPED_RIGHT_RE.test(token)) return [token];
  return [];
}

/**
 * "<group>=sissi:write,sissi:operate;<group2>=sissi:write" -> Map(group -> Set(right)).
 * Only sissi:read, sissi:write, sissi:operate (optionally scoped to :screen:<id> or :view:<id>)
 * and sissi:admin (expands to read+write+operate) are ever granted. Anything else (a wildcard,
 * Pi modules, presets such as @operator) is ignored on purpose. An empty string is allowed when
 * rights come directly from Tunnus tokens; a non-empty string that grants nothing is an error.
 */
export function parseGroupRights(raw, problems = []) {
  const map = new Map();
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return map;
  for (const part of trimmed.split(';')) {
    const entry = part.trim();
    if (!entry) continue;
    const idx = entry.indexOf('=');
    if (idx <= 0) {
      problems.push(`SISSI_TUNNUS_GROUP_RIGHTS entry "${entry}" must be group=right[,right]`);
      continue;
    }
    const group = entry.slice(0, idx).trim();
    const rights = entry
      .slice(idx + 1)
      .split(',')
      .map((r) => r.trim())
      .flatMap(expandRightToken);
    if (!group || rights.length === 0) continue;
    const set = map.get(group) ?? new Set();
    for (const r of rights) set.add(r);
    map.set(group, set);
  }
  if (map.size === 0) {
    problems.push('SISSI_TUNNUS_GROUP_RIGHTS must grant at least one of sissi:read, sissi:write, sissi:operate to a group');
  }
  return map;
}

export function loadConfig(env = process.env) {
  const problems = [];
  const str = (name, def = '') => {
    const v = env[name];
    return v === undefined || v === '' ? def : String(v);
  };
  const int = (name, def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    if (!/^\d+$/.test(String(raw).trim())) {
      problems.push(`${name} must be a whole number (got "${raw}")`);
      return def;
    }
    const n = Number(raw);
    if (n < min || n > max) {
      problems.push(`${name} must be between ${min} and ${max} (got ${n})`);
      return def;
    }
    return n;
  };
  const bool = (name, def = false) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    const v = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(v)) return true;
    if (['0', 'false', 'no'].includes(v)) return false;
    problems.push(`${name} must be 1/0/true/false (got "${raw}")`);
    return def;
  };

  const nodeEnv = str('NODE_ENV', 'development');
  const production = nodeEnv === 'production';

  const storageKind = str('SISSI_STORAGE', 'local');
  if (!['local', 's3'].includes(storageKind)) {
    problems.push(`SISSI_STORAGE must be "local" or "s3" (got "${storageKind}")`);
  }

  const s3 = {
    endpoint: str('SISSI_S3_ENDPOINT'),
    region: str('SISSI_S3_REGION', 'us-east-1'),
    bucket: str('SISSI_S3_BUCKET'),
    accessKeyId: str('SISSI_S3_ACCESS_KEY_ID'),
    secretAccessKey: str('SISSI_S3_SECRET_ACCESS_KEY'),
    forcePathStyle: bool('SISSI_S3_FORCE_PATH_STYLE', true),
    prefix: str('SISSI_S3_PREFIX'),
  };
  if (storageKind === 's3') {
    for (const [k, name] of [
      ['bucket', 'SISSI_S3_BUCKET'],
      ['accessKeyId', 'SISSI_S3_ACCESS_KEY_ID'],
      ['secretAccessKey', 'SISSI_S3_SECRET_ACCESS_KEY'],
    ]) {
      if (!s3[k]) problems.push(`${name} is required when SISSI_STORAGE=s3`);
    }
  }

  const allowPrivateDownloads = bool('SISSI_ALLOW_PRIVATE_DOWNLOADS', false);
  if (allowPrivateDownloads && production) {
    problems.push('SISSI_ALLOW_PRIVATE_DOWNLOADS is refused when NODE_ENV=production');
  }

  const baseUrl = str('SISSI_BASE_URL', 'http://localhost:3000').replace(/\/+$/, '');
  try {
    const u = new URL(baseUrl);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('protocol');
  } catch {
    problems.push(`SISSI_BASE_URL must be an http(s) URL (got "${baseUrl}")`);
  }

  const corsOrigins = list(env.SISSI_CORS_ORIGINS);
  for (const o of corsOrigins) {
    try {
      const u = new URL(o);
      if (u.origin !== o) throw new Error('not an origin');
    } catch {
      problems.push(`SISSI_CORS_ORIGINS entry "${o}" must be a bare origin like https://host`);
    }
  }

  const downloadHosts = list(str('SISSI_DOWNLOAD_HOSTS', 'canva.com,canva.dev,canva-apps.com')).map((h) =>
    h.toLowerCase().replace(/^\./, ''),
  );

  const agentTokens = {};
  for (const entry of list(env.SISSI_AGENT_TOKENS)) {
    const idx = entry.indexOf(':');
    if (idx <= 0 || idx === entry.length - 1) {
      problems.push(`SISSI_AGENT_TOKENS entry "${entry}" must be in lanId:token format`);
      continue;
    }
    const lanId = entry.slice(0, idx).trim();
    const token = entry.slice(idx + 1).trim();
    if (!lanId || !token) {
      problems.push(`SISSI_AGENT_TOKENS entry "${entry}" must have non-empty lanId and token`);
      continue;
    }
    agentTokens[lanId] = token;
  }

  let powerRouters = {};
  const rawRouters = str('SISSI_POWER_ROUTERS');
  if (rawRouters) {
    try {
      const parsed = JSON.parse(rawRouters);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        problems.push('SISSI_POWER_ROUTERS must be a JSON object');
      } else {
        for (const [routerId, cfg] of Object.entries(parsed)) {
          if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
            problems.push(`SISSI_POWER_ROUTERS.${routerId} must be an object`);
            continue;
          }
          if (!['webhook', 'ssh'].includes(cfg.type)) {
            problems.push(`SISSI_POWER_ROUTERS.${routerId}.type must be "webhook" or "ssh"`);
          } else if (cfg.type === 'webhook' && !cfg.url) {
            problems.push(`SISSI_POWER_ROUTERS.${routerId}.url is required for webhook`);
          } else if (cfg.type === 'ssh' && (!cfg.host || !cfg.commandTemplate)) {
            problems.push(`SISSI_POWER_ROUTERS.${routerId} requires host and commandTemplate for ssh`);
          }
        }
        powerRouters = parsed;
      }
    } catch {
      problems.push('SISSI_POWER_ROUTERS must be valid JSON');
    }
  }

  // Tunnus sign-in (docs/tunnus-sign-in.md). Everything is off unless SISSI_AUTH_MODE is both or tunnus.
  const authMode = str('SISSI_AUTH_MODE', 'legacy');
  if (!['legacy', 'both', 'tunnus'].includes(authMode)) {
    problems.push(`SISSI_AUTH_MODE must be "legacy", "both" or "tunnus" (got "${authMode}")`);
  }
  let tunnus = null;
  if (authMode === 'both' || authMode === 'tunnus') {
    const issuer = str('SISSI_TUNNUS_ISSUER').replace(/\/+$/, '');
    const audience = str('SISSI_TUNNUS_AUDIENCE');
    const jwksUrl = str('SISSI_TUNNUS_JWKS_URL');
    const urlOk = (v, name) => {
      try {
        const u = new URL(v);
        if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !production)) throw new Error('protocol');
      } catch {
        problems.push(`${name} must be an https URL (got "${v}")`);
      }
    };
    if (!issuer) problems.push('SISSI_TUNNUS_ISSUER is required when SISSI_AUTH_MODE is both or tunnus');
    else urlOk(issuer, 'SISSI_TUNNUS_ISSUER');
    if (!audience) problems.push('SISSI_TUNNUS_AUDIENCE is required when SISSI_AUTH_MODE is both or tunnus');
    if (jwksUrl) urlOk(jwksUrl, 'SISSI_TUNNUS_JWKS_URL');
    const groupRights = parseGroupRights(str('SISSI_TUNNUS_GROUP_RIGHTS'), problems);
    tunnus = {
      issuer,
      audience,
      jwksUrl,
      groupRights,
      leewaySeconds: int('SISSI_TUNNUS_LEEWAY_SECONDS', 30, { max: 300 }),
      // Browser sign-in to /admin (src/admin-oidc). Off unless the secret is set.
      oidcClientId: str('SISSI_OIDC_CLIENT_ID', 'sissi'),
      oidcClientSecret: str('SISSI_OIDC_CLIENT_SECRET'),
    };
  }

  const config = {
    authMode,
    tunnus,
    nodeEnv,
    production,
    port: int('PORT', 3000, { max: 65535 }),
    baseUrl,
    publicPath: normalizePublicPath(env.SISSI_PUBLIC_PATH === undefined ? '/signage' : env.SISSI_PUBLIC_PATH),
    canva: {
      appId: str('SISSI_CANVA_APP_ID'),
      allowedBrands: list(env.SISSI_CANVA_ALLOWED_BRANDS),
      // Team-ID (Canva brand) entry. true (default) keeps today's behaviour; false refuses Canva tokens
      // entirely, leaving Tunnus as the way in. See docs/operations.md.
      requireTeamIds: bool('SISSI_REQUIRE_TEAM_IDS', true),
    },
    pushKey: str('SISSI_PUSH_KEY'),
    corsOrigins,
    downloadHosts,
    adminPassword: str('SISSI_ADMIN_PASSWORD'),
    // Password sign-in on/off, separate from SISSI_AUTH_MODE. Default on (today's behaviour).
    passwordLogin: bool('SISSI_PASSWORD_LOGIN', true),
    metricsToken: str('METRICS_BEARER_TOKEN'),
    storage: { kind: storageKind, localDir: str('SISSI_LOCAL_DIR', './data'), s3 },
    limits: {
      imageBytes: int('SISSI_MAX_IMAGE_MB', 40, { min: 1 }) * MB,
      videoBytes: int('SISSI_MAX_VIDEO_MB', 500, { min: 1 }) * MB,
      pushBytes: int('SISSI_MAX_PUSH_MB', 1024, { min: 1 }) * MB,
      bodyBytes: int('SISSI_MAX_BODY_KB', 256, { min: 1 }) * 1024,
      maxConcurrentPushes: int('SISSI_MAX_CONCURRENT_PUSHES', 3, { min: 1 }),
    },
    swMaxVideoMb: int('SISSI_SW_MAX_VIDEO_MB', 100, { min: 0 }),
    gcGraceMinutes: int('SISSI_GC_GRACE_MINUTES', 60, { min: 0 }),
    pushRetentionHours: int('SISSI_PUSH_RETENTION_HOURS', 24, { min: 1 }),
    allowPrivateDownloads,
    agentTokens,
    powerRouters,
    powerPollSeconds: int('SISSI_POWER_POLL_SECONDS', 60, { min: 1 }),
    powerDataDir: str('SISSI_POWER_DATA_DIR'),
  };

  if (problems.length) throw new ConfigError(problems);
  return config;
}
