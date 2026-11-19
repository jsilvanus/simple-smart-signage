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
