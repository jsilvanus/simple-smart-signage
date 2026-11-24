import { HttpError, ERROR_STATUS, sendJson } from '../router.mjs';
import { createPushRunner } from '../push/index.mjs';
import { validateItemText } from '../views/embed.mjs';

const SCREEN_ID_RE = /^[a-z0-9-]{1,40}$/;
const PUSH_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err?.code && ERROR_STATUS[err.code]) {
    return new HttpError(err.code, err.message, ERROR_STATUS[err.code]);
  }
  return err;
}

function hostAllowed(hostname, hosts) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return hosts.some((raw) => {
    const d = String(raw).toLowerCase().replace(/^\./, '');
    return d && (h === d || h.endsWith('.' + d));
  });
}

function validatePageUrl(rawUrl, config) {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    throw new HttpError('PAGE_URL_NOT_ALLOWED', 'Page URL is not allowed', 422);
  }
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new HttpError('PAGE_URL_NOT_ALLOWED', 'Page URL is not a valid URL', 422);
  }
  const allowPrivate = Boolean(config?.allowPrivateDownloads);
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) {
    throw new HttpError('PAGE_URL_NOT_ALLOWED', 'Page URL must use https', 422);
  }
  if (u.username || u.password) {
    throw new HttpError('PAGE_URL_NOT_ALLOWED', 'Page URL must not contain credentials', 422);
  }
  const hostname = u.hostname.replace(/^\[|\]$/g, '');
  if (!hostAllowed(hostname, config?.downloadHosts ?? [])) {
    throw new HttpError('PAGE_URL_NOT_ALLOWED', 'Page URL host is not allowed', 422);
  }
}

function validatePushBody(body, config) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError('INVALID_JSON', 'Request body must be a JSON object', 400);
  }
  if (typeof body.screenId !== 'string' || !SCREEN_ID_RE.test(body.screenId)) {
    throw new HttpError('SCREEN_NOT_FOUND', 'Unknown screen', 404);
  }

  const mode = body.mode ?? 'append';
  if (mode !== 'append' && mode !== 'replace') {
    throw new HttpError('INVALID_MODE', 'mode must be append or replace', 422);
  }

  // Publishing content (enabled: false, the default) and making it live (enabled: true)
  // are different rights: sissi:write and sissi:operate (checked in the route for Tunnus sign-ins).
  const enabled = body.enabled ?? false;
  if (typeof enabled !== 'boolean') {
    throw new HttpError('INVALID_ENABLED', 'enabled must be a boolean', 422);
  }
  if (mode === 'replace' && !enabled) {
    throw new HttpError('INVALID_MODE', 'replace needs enabled: true (it changes what is live)', 422);
  }

  if (typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.length > 200) {
    throw new HttpError('INVALID_TITLE', 'title must be 1-200 characters', 422);
  }

  if (!Array.isArray(body.pages) || body.pages.length < 1) {
    throw new HttpError('INVALID_PAGES', 'pages must be a non-empty array', 422);
  }
  if (body.pages.length > 100) {
    throw new HttpError('TOO_MANY_PAGES', 'pages must contain at most 100 items', 422);
  }

  for (const page of body.pages) {
    if (!page || typeof page !== 'object' || Array.isArray(page)) {
      throw new HttpError('INVALID_PAGES', 'Each page must be an object', 422);
    }
    if (page.pageNumber !== undefined && !Number.isInteger(page.pageNumber)) {
      throw new HttpError('INVALID_PAGES', 'pageNumber must be an integer', 422);
    }
    if (page.kind !== undefined && page.kind !== 'image' && page.kind !== 'video') {
      throw new HttpError('INVALID_KIND', 'page kind must be image or video', 422);
    }
    if (
      page.seconds !== undefined &&
      (!Number.isInteger(page.seconds) || page.seconds < 1 || page.seconds > 3600)
    ) {
      throw new HttpError('INVALID_SECONDS', 'seconds must be an integer between 1 and 3600', 422);
    }
    validatePageUrl(page.url, config);
    // Validate and normalise view metadata at request time, not after the media download.
    Object.assign(page, validateItemText(page));
  }

  return {
    screenId: body.screenId,
    mode,
    enabled,
    title: body.title,
    pages: body.pages,
  };
}

/** Register POST /api/v1/push and GET /api/v1/push/:pushId routes. */
export function registerPushRoutes(router, ctx) {
  const runner = ctx.pushRunner ?? ctx.push ?? createPushRunner(ctx);
  if (!ctx.pushRunner) ctx.pushRunner = runner;
  if (!ctx.push) ctx.push = runner;

  router.post('/api/v1/push', async (req, res) => {
    ctx.auth.applyCors(req, res);
    const principal = await ctx.auth.authenticate(req);

    const raw = await router.readJson(req);
    const input = validatePushBody(raw, ctx.config);
    // Content needs sissi:write. Going live (enabled) or replacing needs sissi:operate as well.
    ctx.auth.assertRights?.(principal, input.enabled || input.mode === 'replace' ? ['write', 'operate'] : 'write');

    try {
      await ctx.state.getScreen(input.screenId);
      const push = await runner.enqueue(input);
      sendJson(
        res,
        202,
        {
          pushId: push.pushId,
          taskId: push.pushId,
          state: 'queued',
          screenId: push.screenId,
        },
        { location: router.url(`/api/v1/push/${push.pushId}`) },
      );
    } catch (err) {
      throw toHttpError(err);
    }
  });

  router.get('/api/v1/push/:pushId', async (req, res, { params }) => {
    ctx.auth.applyCors(req, res);
    ctx.auth.assertRights?.(await ctx.auth.authenticate(req), 'read');

    if (typeof params.pushId !== 'string' || !PUSH_ID_RE.test(params.pushId)) {
      throw new HttpError('PUSH_NOT_FOUND', 'Unknown push', 404);
    }

    try {
      const push = await ctx.state.getPush(params.pushId);
      sendJson(res, 200, {
        pushId: push.pushId,
        screenId: push.screenId,
        state: push.state,
        progress: push.progress,
        pages: push.pages,
        error: push.error ?? null,
        playlistVersion: push.playlistVersion ?? null,
      });
    } catch (err) {
      throw toHttpError(err);
    }
  });
}

export { registerPushRoutes as registerPush };
