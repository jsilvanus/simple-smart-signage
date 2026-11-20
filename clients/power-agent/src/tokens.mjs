import nodeFs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_DATA_DIR = '/var/lib/sissi-power-agent';

export function tokensFilePath(dataDir = DEFAULT_DATA_DIR) {
  return path.join(dataDir, 'tokens.json');
}

export async function loadTokens(dataDir = DEFAULT_DATA_DIR, fs = nodeFs) {
  try {
    const raw = await fs.readFile(tokensFilePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        samsung: parsed.samsung && typeof parsed.samsung === 'object' ? { ...parsed.samsung } : {},
      };
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  return { samsung: {} };
}

export async function saveSamsungToken(dataDir = DEFAULT_DATA_DIR, ip, token, fs = nodeFs) {
  if (!ip || !token) return;
  const tokens = await loadTokens(dataDir, fs);
  tokens.samsung[ip] = token;
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(tokensFilePath(dataDir), `${JSON.stringify(tokens, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}
