# Step 1 progress

## Phase 0 (skeleton) — done, `npm test` green (17 tests)

Node 24 ESM, no build, **zero dependencies** (add them in the task that needs them: S3 client, `@canva/app-middleware`).

### What exists
- `package.json` (`type: module`, engines node>=24). Test script is `node --test "test/**/*.test.mjs"` (a bare `test/` directory argument fails on Node 24). Test files must be named `*.test.mjs`; `test/helpers/` is not run.
- `src/config.mjs`, `src/metrics.mjs`, `src/router.mjs`, `src/routes.mjs`, `src/server.mjs`, `src/start.mjs` (`npm start`).
- `test/helpers/server.mjs`, tests `test/{config,server,metrics}.test.mjs`.
- `.github/workflows/ci.yml`, `.gitignore`, `.env.example` (every env var), `package-lock.json`.

### Module interfaces
- `loadConfig(env = process.env) -> config`; throws `ConfigError` (`.problems[]`). Shape: `{ nodeEnv, production, port, baseUrl, publicPath ('' or '/signage'), canva:{appId, allowedBrands[]}, pushKey, corsOrigins[], downloadHosts[], adminPassword, metricsToken, storage:{kind:'local'|'s3', localDir, s3:{endpoint,region,bucket,accessKeyId,secretAccessKey,forcePathStyle,prefix}}, limits:{imageBytes, videoBytes, pushBytes, bodyBytes, maxConcurrentPushes}, swMaxVideoMb, gcGraceMinutes, pushRetentionHours, allowPrivateDownloads }`. Extra env vars beyond the plan: `PORT`, `NODE_ENV`, `SISSI_LOCAL_DIR`, `SISSI_MAX_BODY_KB`, `SISSI_MAX_CONCURRENT_PUSHES`, `SISSI_PUSH_RETENTION_HOURS`, `SISSI_S3_*`.
- `createServer(config, deps = {}) -> http.Server` (not listening; `server.ctx` is the ctx). `deps`: `{ storage, state, auth, download, metrics }`, all optional.
- `registerRoutes(router, ctx)` in `src/routes.mjs`; `ctx = { config, router, metrics, storage, state, auth, download }` (the last four `undefined` for now). Placeholders for push (E), read (F), admin (G), player static (H), admin static (I) are commented at the bottom; each owner adds a `registerX(router, ctx)` import + call.
- Router (`createRouter({publicPath, bodyLimit, metrics})`): `router.get/post/put/patch/delete(pattern, handler)`, patterns like `/api/v1/push/:pushId`, registered **without prefix**; incoming paths match with or without `SISSI_PUBLIC_PATH` (prefix stripped on segment boundary). Handler: `async (req, res, { params, query, url, router })`. `router.url(path)` returns prefix + path (for `Location`, media URLs). `router.readJson(req)` parses the body with the size cap. HEAD is routed to GET handlers.
- Helpers exported from `src/router.mjs`: `HttpError(code, message, status?)`, `sendJson(res, status, body, headers?)`, `sendError(res, code, message, status?, headers?)`, `sendText`, `readJsonBody(req, maxBytes)`, `ERROR_STATUS` (exactly the OpenAPI ErrorCode enum → HTTP status; a test keeps it in sync with `openapi/sissi-v1.yaml`). Transport-only codes outside the enum: `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `INVALID_JSON` (400), `PAYLOAD_TOO_LARGE` (413), `INTERNAL` (500). Thrown non-`HttpError` → 500 `INTERNAL`, no detail leaked.
- Metrics: `createMetrics()` → `inc(name, labels?, by?, help?)`, `set(name, value, labels?, help?)`, `get`, `render()`. The router auto-counts `sissi_http_requests_total{method,route,status}` and `sissi_http_request_seconds_total{route}`.
- `GET /health` → `{ok:true}`. `GET /metrics`: Bearer `METRICS_BEARER_TOKEN` (constant-time compare); 401 `UNAUTHORIZED`; 503 `AUTH_NOT_CONFIGURED` if the token is unset.
- Test helpers: `startTestServer(env = {}, deps = {}) -> { server, config, ctx, base, close }` (port 0, 127.0.0.1), `http(base, path, { method, headers, body }) -> { status, headers, text, json }` (object bodies are JSON-encoded), `testConfig(env)`.

### Left / notes
- `src/start.mjs` builds no deps yet; Phase 1/2 owners wire storage, state, auth, download there.
- CORS is not implemented here (task D, `src/auth/`); there is no generic CORS hook in the router yet.
- Per-path size caps beyond JSON body (media) are the download client's job.
- `openapi/sissi-v1.yaml` already existed and was not changed.

## Phase 1 interface contracts (fixed by the coordinator; all Phase 1 agents and Phase 2 depend on these)

All modules: ESM `.mjs` under their own directory, a single `index.mjs` exporting the factory below, `node:test` tests named `*.test.mjs` under `test/<area>/`. Never edit files you do not own (package.json only for adding your own dependency via `npm install <pkg>`).

**storage (`src/storage/index.mjs`)** `createStorage(config.storage, {fetch?}) -> Storage`, async methods:
- `putMediaFromFile(sha256, ext, filePath, contentType) -> {key, size}` (idempotent; content-addressed key `media/<sha256>.<ext>`)
- `getMedia(sha256, ext, {start?, end?}={}) -> {stream: Readable, size (total bytes), contentType, start, end} | null`
- `statMedia(sha256, ext) -> {size, contentType, lastModified: Date} | null`
- `deleteMedia(sha256, ext) -> void`
- `listMedia() -> AsyncIterable<{sha256, ext, size, lastModified: Date}>`
- `getJson(key) -> {value, etag} | null`; `putJson(key, value, {ifMatch?: etag|null}) -> {etag}`, throws `StorageConflictError` when `ifMatch` is given and does not match (`ifMatch: null` means "must not exist"); `deleteJson(key)`; `listJson(prefix) -> string[]` of keys.
- Also exports `createMemoryStorage()` implementing the same interface (used by tests of other modules), `StorageConflictError`.
- local driver writes atomically (temp file + rename); S3 driver uses `@aws-sdk/client-s3` with conditional writes (If-Match / If-None-Match) for putJson.

**state (`src/state/index.mjs`)** `createState(storage, {now?, idGen?}) -> State`:
- screens: `createScreen(input) / updateScreen(id, patch) / deleteScreen(id) / getScreen(id) / listScreens()` (id pattern `^[a-z0-9-]{1,40}$`, validation per ScreenInput in OpenAPI, errors as `StateError(code, message)` with OpenAPI ErrorCodes SCREEN_EXISTS, SCREEN_NOT_FOUND, INVALID_SCREEN, INVALID_SECONDS).
- one JSON doc per screen at `state/screens/<id>.json` = `{screen fields, version, entries:[Entry]}`; every mutation goes through `mutateScreen(id, fn)` = per-screen in-process lock + load + `fn(doc)` + version increment + `putJson` with `ifMatch` (CAS; retry once on conflict then throw `StateError('BUSY')`).
- playlist ops: `applyPush(screenId, {pushId, mode, title, items:[{mediaId(sha256), ext, kind, seconds}]}) -> {playlistVersion}` (append or replace, atomic, one mutation), `removeEntry`, `reorderEntries`, `setEntrySeconds`, `removePush(screenId, pushId)`, `getPlaylist(screenId) -> {screenId, version, orientation, entries}`.
- push records: `createPush / updatePush / getPush(pushId) / sweepPushes()` stored at `state/pushes/<pushId>.json`; `markInterruptedOnStart()` sets every `queued|downloading` push to `failed` with code `INTERRUPTED`.
- `referencedMedia() -> Set<"sha256.ext">` over all screens and `gcSweep(storage, {graceMinutes, now}) -> {deleted:number}` (never deletes objects younger than the grace period, never deletes referenced media; the plan section 11 item 5).

**download (`src/download/index.mjs`)** `createDownloader(config, {fetch?, lookup?, tmpDir?}) -> {downloadPage({url, kindHint?, maxBytes, signal?}) -> Promise<{tmpPath, size, sha256, kind, ext, contentType, durationSeconds|null}>}`. The caller deletes `tmpPath`. Throws `DownloadError(code, message)` with codes `PAGE_URL_NOT_ALLOWED | DOWNLOAD_FAILED | TOO_LARGE | UNSUPPORTED_TYPE | KIND_MISMATCH`. Messages never contain the URL query string. Also exports `scrubUrl(url)`, `sniffKind(buffer)`, `readMp4Duration(filePath)`.

**auth (`src/auth/index.mjs`)** `createAuth(config, {fetch?, now?}) -> {authenticate(req) -> Promise<{kind:'canva'|'pushkey', brandId?}>, handleCors(req, res) -> boolean (true = preflight fully handled, response ended), applyCors(req, res)}`. `authenticate` throws `HttpError` (import from `src/router.mjs`) with 401 UNAUTHORIZED / 403 TEAM_NOT_ALLOWED / 503 AUTH_NOT_CONFIGURED. Export also `testing.createFakeCanva()` returning `{jwksFetch, signToken({brandId, aud, exp})}` for other modules' tests (put it in `src/auth/testing.mjs`).


## Phase 1 / D auth — done, `node --test test/auth/auth.test.mjs` green (10 tests)

- **Zero dependencies**: implemented RS256 JWT verification and `https://api.canva.com/rest/v1/apps/<appId>/jwks` JWKS fetching/caching in `src/auth/index.mjs` using `node:crypto`, mirroring `d:\pigateway` (`@canva/app-middleware` rules: RS256-only, `kid` required, `aud === appId`, `exp`/`nbf`, `brandId` allow-list).
- **Caching & rate-limiting**: 60-minute JWKS cache keyed by `kid`; unknown `kid` triggers one refresh with a 30s cooldown and injectable `fetch` and `now`.
- **Auth & CORS**: `createAuth(config, { fetch, now })` provides `authenticate(req)` (constant-time `pushKey`, Canva JWT, 401 `UNAUTHORIZED` without leaking reasons, 403 `TEAM_NOT_ALLOWED` with `'Your Canva team is not allowed to publish to signage'`, 503 `AUTH_NOT_CONFIGURED` when neither Canva nor `pushKey` is configured), `applyCors(req, res)`, and `handleCors(req, res)` (204 for allowed `OPTIONS`, 403 JSON error for disallowed `OPTIONS`).
- **Test helper**: `src/auth/testing.mjs` (`createFakeCanva()`, also re-exported as `testing` from `src/auth/index.mjs`) generates an RSA key pair, serves JWKS via `jwksFetch`, and provides `signToken({ brandId, aud, exp, kid, alg })` and `rotateKey()`.
- **Note on `npm test`**: 10/10 auth tests pass; 1 unrelated test in `test/download/download.test.mjs` (from Task C) was failing during the workspace run.

## Phase 1 / C download — done, `npm test` green (37 tests, 10 in `test/download/download.test.mjs`)

- **SSRF & URL validation** (`src/download/index.mjs`): `createDownloader(config, { lookup, tmpDir, connectTimeoutMs, idleTimeoutMs, timeouts })` enforces `https` only, rejects credentials in URLs, checks `config.downloadHosts` on a dot boundary, resolves DNS once via injectable `lookup`, rejects private/loopback/link-local/multicast/unspecified/unique-local IPv4 and IPv6 (including IPv4-mapped `::ffff:`) addresses, connects directly to the resolved IP with `Host` and TLS `servername` from the hostname, and re-validates on every redirect hop (max 4). `config.allowPrivateDownloads` permits plain `http` and private addresses for tests, and throws at `createDownloader` if `config.production` is true.
- **Streaming, sniffing, MP4 duration, scrubbed errors**: streams to a temp file computing `sha256` while enforcing `maxBytes` (`TOO_LARGE` by `Content-Length` or stream) and deleting the temp file on any failure; sniffs PNG/JPEG/WebP/MP4 (`UNSUPPORTED_TYPE`, `KIND_MISMATCH`); reads MP4 duration via bounded `readMp4Duration(filePath)` (`mvhd` v0/v1, `mvex/mehd` v0/v1 fallback, rounded up to whole seconds, `UNSUPPORTED_TYPE` `'cannot read video length'` otherwise); scrubs credentials/query strings/fragments from all errors (`scrubUrl`); supports connect (10s) and mid-stream idle (30s) timeouts and `AbortSignal`.
- **Tests**: `test/download/download.test.mjs` (10 tests) covers `allowPrivateDownloads` in production, `scrubUrl`, `sniffKind`, `isPrivateAddress`, `readMp4Duration` (v0, v1, fragmented v0/v1, missing duration, truncated), SSRF/DNS rebinding single-lookup, local HTTP server downloads with SHA-256 + duration, redirects (4 hops, loop, disallowed host), size caps, error scrubbing, idle timeout, and `AbortSignal`. `npm test` passes 37/37.


## Phase 1 / A storage — done, `npm test` green (52 tests, 8 in `test/storage/storage.test.mjs`)

- **Interface & exports** (`src/storage/index.mjs`, `src/storage/common.mjs`): exports `createStorage(config.storage, { fetch? })`, `createMemoryStorage()`, and `StorageConflictError`. Validates media (`sha256`, `ext`) and JSON keys/prefixes against path traversal (`..`, backslashes, leading `/`, null bytes).
- **Local driver** (`src/storage/local.mjs`): atomic temp-file + `rename` writes for media and JSON, `sha256` hex ETag for JSON, per-key in-process lock for `putJson` `ifMatch` (`null` = must not exist) CAS semantics, and `.sissi-meta/` sidecar for media `contentType`.
- **S3 driver** (`src/storage/s3.mjs`): uses `@aws-sdk/client-s3` (added via `npm install @aws-sdk/client-s3`), supports `endpoint`, `forcePathStyle`, and `prefix` from `config.storage.s3`, conditional `putJson` via `IfMatch` / `IfNoneMatch`, `getMedia` with `Range` + `Content-Range`, and paginated `listMedia` / `listJson` via `ListObjectsV2Command`.
- **Memory driver** (`src/storage/memory.mjs`): `createMemoryStorage()` with identical semantics for other modules' tests.
- **Tests** (`test/storage/storage.test.mjs`, `test/storage/fake-s3.mjs`): shared contract suite runs against all three drivers (memory, local, and S3 against an in-process path-style fake S3 HTTP server supporting `PUT`, `GET` `Range`, `HEAD`, `DELETE`, `ListObjectsV2` pagination, `If-Match`, `If-None-Match`, and `aws-chunked` streaming uploads), plus local CAS concurrency and ETag verification. `npm test` passes 52/52.


## Phase 1 / B state — done, `npm test` green (52 tests, 7 in `test/state/state.test.mjs`)

- **State store** (`src/state/index.mjs`): exports `createState(storage, { now?, idGen? })` and `StateError(code, message)`.
- **Screens & locking**: `createScreen`, `updateScreen`, `deleteScreen`, `getScreen`, `listScreens` with OpenAPI `ScreenInput` validation (`SCREEN_EXISTS`, `SCREEN_NOT_FOUND`, `INVALID_SCREEN`, `INVALID_SECONDS`); `mutateScreen(id, fn)` serializes per screen with an in-process FIFO lock, increments `version`, and uses `putJson` `ifMatch` CAS (retries once on conflict, then throws `StateError('BUSY')`).
- **Playlists & pushes**: `applyPush` (`append`/`replace`, atomic single mutation, unique `entryId`s, `playlistVersion` +1), `removeEntry`, `reorderEntries` (permutation check, else `INVALID_PAGES`), `setEntrySeconds` (images only, 1–3600), `removePush`, `getPlaylist`; push records (`createPush`, `updatePush`, `getPush`, `sweepPushes` by retention, `markInterruptedOnStart` setting `queued|downloading` to `failed` with `INTERRUPTED`).
- **GC**: `referencedMedia()` across all screen docs and `gcSweep(storage, { graceMinutes, now })` skipping referenced and young objects.
- **Tests** (`test/state/state.test.mjs`, `test/state/memory-storage.mjs`): 7 tests against a minimal in-memory storage mock covering screen CRUD/validation, concurrent lock serialization, CAS retry + `BUSY`, `applyPush` append/replace, entry/push mutations, push retention + interrupted marking, and GC reference/grace-period safety.

## Phase 2 / F read — done, `npm test` green (56 tests, 4 in `test/read/read.test.mjs`)

- **Read API** (`src/api/read.mjs`): exports `registerReadRoutes(router, ctx)` registering `GET /api/v1/screens` (authenticated via `ctx.auth.authenticate` + `ctx.auth.applyCors`, shaped to OpenAPI `Screen` without `entries`), `GET /s/:screenId/playlist.json` (validates `screenId` `^[a-z0-9-]{1,40}$`, maps `StateError` to `HttpError`, returns prefixed `router.url('/media/...')` and `sha256` with `Cache-Control: no-cache`), and `GET /media/:file` (`<64-hex>.<ext>`, supports `Range: bytes=N-M`, `bytes=N-`, `bytes=-N`, 416 with `Content-Range: bytes */<size>` on `RangeError`/S3 `InvalidRange`, `Cache-Control: public, max-age=31536000, immutable`, stream destroyed on `res` close).
- **Tests** (`test/read/read.test.mjs`): 4 tests using `createMemoryStorage()`, `createState()`, `testing.createFakeCanva()`, and `startTestServer` + `registerReadRoutes` covering auth/CORS/shape on `/api/v1/screens`, playlist URLs/404s, media 200/206/416/404, and S3 `InvalidRange` handling.
- **Left**: wiring `registerReadRoutes` in `src/routes.mjs` (owned by coordinator).


## Phase 2 / E push — done, `node --test test/push/push.test.mjs` green (5 tests)

- **Push runner** (`src/push/index.mjs`): exports `createPushRunner({ config, storage, state, download, metrics })` returning `{ enqueue, waitForIdle }`. Enforces `config.limits.maxConcurrentPushes` (default 3, throws `HttpError('BUSY', ..., 429)`), creates push record via `state.createPush`, downloads pages sequentially while enforcing `imageBytes`, `videoBytes`, `pushBytes` (`TOO_LARGE`), and `screen.maxVideoSeconds` (`VIDEO_TOO_LONG`), stores media with `storage.putMediaFromFile` and cleans up temp files in `finally`, applies to screen via `state.applyPush` only when all pages succeed (finish-order per screen), marks `ready` + triggers background `state.gcSweep` and `state.sweepPushes` (swallowing/logging sweep errors), and scrubs URLs in failed push error messages.
- **Push API** (`src/api/push.mjs`): exports `registerPushRoutes(router, ctx)` (and `registerPush` alias) registering `POST /api/v1/push` (202 with `Location` and `{ pushId, taskId, state: 'queued', screenId }`) and `GET /api/v1/push/:pushId` (OpenAPI `PushStatus`), both authenticated via `ctx.auth.authenticate` + `ctx.auth.applyCors`, validating `screenId`, `pushId`, `mode`, `title`, `pages`, `kind`, `seconds`, and page `url`, and translating `StateError` via `ERROR_STATUS`.
- **Tests** (`test/push/push.test.mjs`): 5 tests covering happy path (image + video, omitted `kind`, `replace` mode), `KIND_MISMATCH`, `VIDEO_TOO_LONG`, `TOO_LARGE` (per-page and total push), failed push leaving screen untouched with scrubbed error messages, concurrent pushes (finish-order + 429 `BUSY` >3), validation errors (404, 422), and auth/CORS (401, 403).
- **Note on `npm test`**: 5/5 push tests pass; 1 unrelated test in `test/admin/admin.test.mjs` (from Task G, `screen CRUD endpoints, param validation, and error codes`) was failing during the workspace run.
- **Left**: wiring `registerPushRoutes` in `src/routes.mjs` (owned by coordinator).


## Phase 2 / G admin — done, `npm test` green (67 tests, 6 in `test/admin/admin.test.mjs`)

- **Admin auth** (`src/admin-auth/index.mjs`): exports `createAdminAuth(config, { now? })` returning `{ login, requireAdmin, logout }`. Returns 503 `AUTH_NOT_CONFIGURED` when `config.adminPassword` is unset, rate-limits failed logins to 5 per IP per 10 minutes (`429 RATE_LIMITED`, reset on success), compares SHA-256 digests with `timingSafeEqual`, signs 12h `sissi_admin` HMAC-SHA256 cookies (`Path=<config.publicPath || '/'>; HttpOnly; SameSite=Strict` + `; Secure` in production), and enforces `X-Sissi-Admin: 1` on `POST`/`PUT`/`PATCH`/`DELETE` (`logout` clears cookie with `Max-Age=0`).
- **Admin API** (`src/api/admin.mjs`): exports `registerAdminRoutes(router, ctx)` (and `registerAdmin` alias) registering all OpenAPI `/api/v1/admin/*` routes (`login`, `logout`, `screens` list/create/patch/delete, `entries` reorder/patch/delete, `pushes` delete), validating `:screenId`/`:entryId`/`:pushId` params, converting `StateError` to `HttpError` via `ERROR_STATUS`, triggering `state.gcSweep` on delete routes, and never accepting Canva/push Bearer tokens.
- **Tests** (`test/admin/admin.test.mjs`): 6 tests covering 503 unconfigured, login/cookie attributes (`Path`, `HttpOnly`, `SameSite=Strict`, `Secure`), IP rate limiting + reset, session expiry, CSRF header enforcement, Bearer token rejection, all screen/entry/push CRUD & error codes, and GC sweep.
- **Left**: wiring `registerAdminRoutes` in `src/routes.mjs` (owned by coordinator).


## Phase 3 / J deploy — done, `npm test` green (71 tests, 4 in `test/deploy/deploy.test.mjs`)

- **Dockerfile & `.dockerignore`**: `node:24-slim`, `WORKDIR /app`, `npm ci --omit=dev`, copies `src/`, `public/`, `openapi/`, creates `/app/data` owned by `node`, runs as non-root `USER node`, `EXPOSE 3000`, `HEALTHCHECK` against `http://127.0.0.1:3000/health` via `node -e "fetch(...)"`, `CMD ["node", "src/start.mjs"]`. `.dockerignore` excludes `.git`, `.github`, `node_modules`, `test`, `docs`, `data`, `coverage`, `.env*`, `*.log`, `.DS_Store`.
- **`docker-compose.yml`**: `sissi` service/container using `ghcr.io/jsilvanus/sissi:${SISSI_IMAGE_TAG:-latest}`, `restart: unless-stopped`, `deploy.replicas: 1`, `traefik-public` + `shared_multi_network` (external) + `default` with no published host ports, Traefik `Host` + `PathPrefix` + `websecure` + `letsencrypt` + `sissi-stripprefix` labels, `/health` healthcheck, and all `SISSI_*`, `METRICS_BEARER_TOKEN`, `NODE_ENV=production`, `PORT=3000` mapped from `.env`.
- **`.github/workflows/release.yml`**: runs `npm test` before building and pushing `ghcr.io/jsilvanus/sissi` on `main` and `v*` tags (`sha`, branch ref, semver, `latest` on `main`), with a commented-out `deploy` job stub for `appdeploy` on the VPS once environment secrets are configured.
- **Tests**: `test/deploy/deploy.test.mjs` (4 tests) validates `Dockerfile`, `.dockerignore`, `docker-compose.yml` (including coverage of `.env.example` vars), and `.github/workflows/release.yml`. `npm test` passes 71/71.


## Phase 3 / I admin-ui — done, `npm test` green (76 tests, 5 in `test/admin-ui/admin-ui.test.mjs`)

- **Static routes** (`src/api/admin-ui.mjs`): exports `registerAdminUiRoutes(router, ctx)` (and `registerAdminUi` alias) serving `GET /admin`, `GET /admin/`, and `GET /admin/:file` from `public/admin/` with `Cache-Control: no-cache`, path-traversal protection, `HEAD` support, and prefix-aware `<base href="${router.url('/admin/')}">` injection in `index.html`.
- **Admin UI** (`public/admin/index.html`, `public/admin/style.css`, `public/admin/app.js`, `public/admin/helpers.js`): plain HTML + CSS + ESM JS with no build step; resolves `base` from `location.pathname.replace(/\/admin(?:\/.*)?$/, '')` so API calls (`${base}/api/v1/admin/*`) and preview links (`${base}/s/${screenId}`) work at `/admin`, `/admin/`, `/signage/admin`, and `/signage/admin/`; sends `credentials: 'same-origin'` and `X-Sissi-Admin: 1` on all writes; supports login/logout, screen create/edit/delete (with `<dialog>` confirmation), playlist reorder up/down, image seconds update, video duration display, single-entry delete, whole-push removal, and inline `error.message` display.
- **Tests** (`test/admin-ui/admin-ui.test.mjs`): 5 tests covering `/admin` & `/admin/` HTML serving (`no-cache`, `<base href>` with and without `SISSI_PUBLIC_PATH`), static asset MIME types & traversal 404s, and unit tests for `public/admin/helpers.js`. `npm test` passes 76/76.
- **Left**: wiring `registerAdminUiRoutes` in `src/routes.mjs` (owned by coordinator).


## Phase 3 / H player — done, `npm test` green (79 tests, 3 in `test/player/player.test.mjs`)

- **Player routes** (`src/api/player.mjs`): exports `registerPlayerRoutes(router, ctx)` (and `registerPlayer` alias) registering `/s/sw.js` (injecting `config.swMaxVideoMb`), `/s/player.js`, `/s/player.css` before `/s/:screenId` (all `Cache-Control: no-cache`). Unknown/invalid `:screenId` returns HTTP 404 with the same neutral black player HTML (zero error text leaked).
- **Player UI** (`public/player/index.html`, `public/player/player.css`, `public/player/player.js`): plain HTML + CSS + JS using relative URLs (`./player.css`, `./player.js`, `./sw.js`, `<screenId>/playlist.json`) so both `/s/:screenId` and `/<prefix>/s/:screenId` work; full-screen `#000` background, `object-fit: contain`, 0.5s opacity cross-fade, preloads next entry, polls every 60s (`?pollMs=` override) and on load error, applies new `version` at the next entry boundary, `muted autoplay playsinline` videos advancing on `ended` / `seconds + 5` / `error`, and `localStorage` fallback.
- **Service worker** (`public/player/sw.js`): caches shell assets and `playlist.json` network-first, caches images and videos `< swMaxVideoMb * 1024 * 1024`, serves `206 Partial Content` with `Content-Range` for `Range` requests on cached videos by slicing the cached `ArrayBuffer`, skips uncached videos when offline instead of stalling, and prunes stale media cache entries per active screen.
- **Tests** (`test/player/player.test.mjs`, `test/player/fixtures/sample.mp4`, devDependency `playwright-core`): 3 tests covering player routes/headers/`swMaxVideoMb` injection, plus headless Chrome Playwright tests for 2 images + 1 video timing/cross-fade/`ended` advance, boundary version switch, unknown screen recovery, cache pruning, offline SW loop (including video `Range` 206), and uncached video skipping when `SISSI_SW_MAX_VIDEO_MB=0`. `npm test` passes 79/79.
- **Left**: wiring `registerPlayerRoutes` in `src/routes.mjs` (owned by coordinator).


## Phase 4 / K e2e & docs — done, `npm test` green (80 tests, 1 in `test/e2e/e2e.test.mjs`)

- **End-to-end test** (`test/e2e/e2e.test.mjs`): wires the full server (`createServer` with real local `storage`, `state`, `auth` + `testing.createFakeCanva()`, `download` with `allowPrivateDownloads: true`, `pushRunner`, `adminAuth`, `metrics`) under `SISSI_PUBLIC_PATH=/signage` and a local HTTP download server; verifies admin login + screen creation (`lobby`), Canva push of 2 PNGs + `sample.mp4` (`playlistVersion === 2` from initial `1`), headless Chrome (`playwright-core`, Windows/Linux executable detection with `t.skip` fallback) playback & service worker caching, and continued offline looping after `server.close()` with no errors.
- **README & operator guide** (`README.md`, `docs/operations.md`): updated `README.md` with Step 1 quickstart (Node 24, `npm test`, `npm start`, env vars, Docker/Traefik overview, single-instance note, links to `openapi/sissi-v1.yaml` and `docs/operations.md`) while preserving existing project description/license; created `docs/operations.md` covering VPS Docker/Traefik deployment, `SISSI_*` env vars, S3 storage, single-replica requirement, admin usage, media requirements, Yodeck Web Page setup & first-deploy SW cache persistence verification (open item 2), and `/health` + `/metrics`.
- **Tests**: `npm test` passes 80/80.

## 2026-11-23: enabled/disabled entries

Done: `enabled` on entries (missing = enabled), push `enabled` (default false; `replace` needs true), `playlist.json` lists enabled only, `enabledEntryCount`, admin PATCH for entries and pushes, admin page buttons, OpenAPI, tests. Left: rights (Tunnus), Canva plugin side.
