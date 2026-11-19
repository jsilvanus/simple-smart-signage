import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendText } from '../router.mjs';

const SCREEN_ID_RE = /^[a-z0-9-]{1,40}$/;
const PLAYER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/player');

async function screenExists(state, screenId) {
  if (!SCREEN_ID_RE.test(screenId)) return false;
  if (!state) return true;
  try {
    await state.getScreen(screenId);
    return true;
  } catch (err) {
    if (err?.code === 'SCREEN_NOT_FOUND') return false;
    throw err;
  }
}

/**
 * Registers Step 1 public player routes:
 * - `GET /s/sw.js`
 * - `GET /s/player.js`
 * - `GET /s/player.css`
 * - `GET /s/:screenId`
 */
export function registerPlayerRoutes(router, ctx = {}) {
  const { config, state } = ctx;
  const swMaxVideoMb = Number.isFinite(config?.swMaxVideoMb) ? config.swMaxVideoMb : 100;

  router.get('/s/sw.js', async (req, res) => {
    const raw = await readFile(path.join(PLAYER_DIR, 'sw.js'), 'utf8');
    const body = raw.replace(/\/\*__SW_MAX_VIDEO_MB__\*\/\s*\d+/, String(swMaxVideoMb));
    sendText(res, 200, body, 'application/javascript; charset=utf-8', {
      'cache-control': 'no-cache',
    });
  });

  router.get('/s/player.js', async (req, res) => {
    const body = await readFile(path.join(PLAYER_DIR, 'player.js'), 'utf8');
    sendText(res, 200, body, 'application/javascript; charset=utf-8', {
      'cache-control': 'no-cache',
    });
  });

  router.get('/s/player.css', async (req, res) => {
    const body = await readFile(path.join(PLAYER_DIR, 'player.css'), 'utf8');
    sendText(res, 200, body, 'text/css; charset=utf-8', {
      'cache-control': 'no-cache',
    });
  });

  router.get('/s/:screenId', async (req, res, { params }) => {
    const exists = await screenExists(state, params.screenId);
    const html = await readFile(path.join(PLAYER_DIR, 'index.html'), 'utf8');
    sendText(res, exists ? 200 : 404, html, 'text/html; charset=utf-8', {
      'cache-control': 'no-cache',
    });
  });
}

export { registerPlayerRoutes as registerPlayer };
