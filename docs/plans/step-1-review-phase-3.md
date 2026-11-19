# Step 1 — Phase 3 Review

**Verdict: CLEARED FOR PHASE 4** (no must-fix blockers; 1 minor CI test-coverage note).

**Test run:** `npm test` passed 79/79 tests (`0` failed, `0` skipped) on Windows with Chrome/Edge present.

## Findings by Area

### 1. Path Prefix (`/signage` + Traefik StripPrefix)
- **Pass.**
- `docker-compose.yml` configures `Host(\`${SISSI_HOST}\`) && PathPrefix(\`${SISSI_PUBLIC_PATH:-/signage}\`)`, `sissi-stripprefix` middleware (`stripprefix.prefixes=${SISSI_PUBLIC_PATH:-/signage}`), and `loadbalancer.server.port=3000`.
- `src/api/player.mjs` and `public/player/*` use relative URLs (`./player.css`, `./player.js`, `./sw.js` with `{ scope: './' }`, `<screenId>/playlist.json`), so `/s/:screenId` and `/signage/s/:screenId` both resolve `sw.js` at `/<prefix>/s/sw.js` with scope `/<prefix>/s/`.
- `src/api/admin-ui.mjs` serves both `GET /admin` and `GET /admin/` with `<base href="${escapeAttr(router.url('/admin/'))}">`, and `public/admin/helpers.js` (`resolveBasePath`) strips `/\/admin(?:\/.*)?$/` so API calls (`/api/v1/admin/*`) and preview links (`/s/:screenId`) work with or without `/signage`.

### 2. Player Offline & Video Rules
- **Pass.**
- `src/api/player.mjs` injects `config.swMaxVideoMb` into `public/player/sw.js`.
- `public/player/sw.js` caches images and videos strictly smaller than `SW_MAX_VIDEO_MB * 1024 * 1024`, answers `Range` requests for cached videos with `206 Partial Content` + `Content-Range` by slicing the cached `ArrayBuffer` (or `416` on invalid ranges), and returns `504` when offline for uncached media.
- `public/player/player.js` advances past failed/uncached videos via `onSlideError()` without stalling, falls back to `localStorage` (`sissi:playlist:${screenId}`) when offline on startup, and never renders error text on the public screen (`public/player/index.html` is an empty `#000` stage, and 404 returns the same neutral HTML).

### 3. Admin UI Security & UX
- **Pass.**
- `public/admin/app.js` (`apiFetch`) sends `credentials: 'same-origin'` on all requests and `X-Sissi-Admin: 1` on all non-GET/HEAD requests.
- No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write` usage in `public/admin/*.js` or `public/player/*.js`; all untrusted screen/entry/error strings are rendered via `textContent` or `setAttribute`.
- Clean UX with `<dialog>` modals for screen create/edit and delete/remove-push confirmations, inline error/status banners, and busy-state button disabling.

### 4. Docker & CI
- **Pass (with 1 minor note).**
- `Dockerfile` uses `node:24-slim`, creates `/app/data` owned by `node:node`, runs as non-root `USER node`, exposes `3000`, and defines a `/health` `HEALTHCHECK`.
- `docker-compose.yml` sets `deploy.replicas: 1`, uses external `traefik-public` + `shared_multi_network` + `default`, publishes no host ports, and contains no hardcoded secrets.
- `.github/workflows/release.yml` runs `npm test` before building and pushing `ghcr.io/jsilvanus/sissi`.
- **Minor note (`ci.yml` + `test/player/player.test.mjs`):** `test/player/player.test.mjs` uses `findBrowserExecutable()`, which currently only checks Windows paths (`C:\Program Files\...`). On `ubuntu-latest` in `.github/workflows/ci.yml` and `.github/workflows/release.yml`, `npm test` will **not fail** (the two Playwright tests call `t.skip('No Chrome or Edge executable found')`), but they will be silently skipped unless Linux/macOS candidate paths (e.g., `/usr/bin/google-chrome`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`, or `process.env.CHROME_PATH`) are added.

## Must-Fix Items
- None.

## Minor Notes
1. Add Linux/macOS browser paths (and/or `CHROME_PATH` env override) to `findBrowserExecutable()` in `test/player/player.test.mjs` so Playwright player tests run in GitHub Actions `ubuntu-latest` instead of skipping.
