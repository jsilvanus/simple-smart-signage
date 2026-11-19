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
