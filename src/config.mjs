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

  const config = {
    nodeEnv,
    production,
    port: int('PORT', 3000, { max: 65535 }),
    baseUrl,
    publicPath: normalizePublicPath(env.SISSI_PUBLIC_PATH === undefined ? '/signage' : env.SISSI_PUBLIC_PATH),
    canva: {
      appId: str('SISSI_CANVA_APP_ID'),
      allowedBrands: list(env.SISSI_CANVA_ALLOWED_BRANDS),
    },
    pushKey: str('SISSI_PUSH_KEY'),
    corsOrigins,
    downloadHosts,
    adminPassword: str('SISSI_ADMIN_PASSWORD'),
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
