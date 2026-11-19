# Step 1 — Phase 2 Review

**Status:** **NOT CLEARED for Phase 3** (1 small must-fix wiring bug; otherwise solid).  
**Reviewed commit:** `0e41c75efa79861a6d30fa2c426a1a6dac861d8b` (`feat: phase 2 (push API, read API, admin auth & API, server wiring)`)  
**Test run:** `npm test` — 67/67 passing.

---

## 1. Contract & Headers (`openapi/sissi-v1.yaml` & `docs/plans/step-1-web-signage.md`)

- **Push API (`src/api/push.mjs`, `src/push/index.mjs`)**:
  - `POST /api/v1/push` returns `202`, `Location: <SISSI_PUBLIC_PATH>/api/v1/push/<pushId>`, and `{ pushId, taskId, state: 'queued', screenId }`.
  - `GET /api/v1/push/:pushId` returns `200` with `PushStatus` (`pushId`, `screenId`, `state`, `progress`, `pages`, `error`, `playlistVersion`).
  - Body validation, `404 SCREEN_NOT_FOUND` / `PUSH_NOT_FOUND`, `422` codes, and `429 BUSY` match OpenAPI.
- **Read API (`src/api/read.mjs`)**:
  - `GET /api/v1/screens` returns `200` with OpenAPI `Screen` shape (no `entries`).
  - `GET /s/:screenId/playlist.json` returns `200` with `Cache-Control: no-cache`, `sha256`, and prefixed `router.url('/media/...')` URLs.
  - `GET /media/:file` serves `200` / `206` with `Cache-Control: public, max-age=31536000, immutable`, `Accept-Ranges: bytes`, `Content-Range`, `416` with `Content-Range: bytes */<size>` on invalid/unsatisfiable ranges (including S3 `InvalidRange`), `HEAD` support, and stream cleanup on `res` close.
- **Admin API (`src/api/admin.mjs`, `src/admin-auth/index.mjs`)**:
  - All OpenAPI `/api/v1/admin/*` endpoints, status codes (`200`, `201`, `204`, `401`, `404`, `409`, `422`, `429`, `503`), and payloads match (plus `POST /api/v1/admin/logout` returning `204`).

---

## 2. Security

- **CORS (`src/server.mjs`, `src/auth/index.mjs`)**: `handleCors` runs before `router.handle`; allowed origins get `Access-Control-Allow-Origin` + `Vary: Origin` + `Allow-Headers` (`Authorization, Content-Type, X-Sissi-Admin`) + `Allow-Methods` + `204` on `OPTIONS`; disallowed/missing origins on `OPTIONS` get `403 ORIGIN_NOT_ALLOWED`.
- **Admin isolation**: `adminAuth.requireAdmin` only reads the `sissi_admin` cookie; Canva/push Bearer tokens are never accepted on `/api/v1/admin/*`.
- **Admin CSRF, cookies & rate limiting**:
  - `X-Sissi-Admin: 1` required on `POST`/`PUT`/`PATCH`/`DELETE` (except `/login`).
  - Cookie attributes: `Path=<SISSI_PUBLIC_PATH || '/'>; HttpOnly; SameSite=Strict` + `; Secure` when `config.production` is true.
  - Constant-time password comparison via `timingSafeEqual(sha256(...))`.
  - Login rate limit: 5 failures per IP per 10 minutes → `429 RATE_LIMITED`, reset on success.
- **Push safety**:
  - All pages are downloaded, size/duration-checked, and stored before `state.applyPush`; any failure leaves the screen untouched (`append` and `replace`) and cleans up temp files.
  - Concurrency capped at `maxConcurrentPushes` (default 3) → `429 BUSY`.
  - Error messages scrub URL query strings/credentials/fragments.

---

## 3. Must-Fix

1. **Graceful shutdown `pushRunner` wiring mismatch (`src/api/push.mjs` vs `src/server.mjs` / `src/start.mjs`)**:
   - `src/server.mjs` and `src/start.mjs` pass `pushRunner` on `ctx` (`ctx.pushRunner`), and `src/start.mjs` awaits `pushRunner.waitForIdle()` on `SIGTERM`/`SIGINT`.
   - However, `src/api/push.mjs` (line 99) reads `ctx.push ?? createPushRunner(ctx)`, ignoring `ctx.pushRunner` and instantiating a second `PushRunner`. As a result, `pushRunner.waitForIdle()` in `src/start.mjs` sees zero active tasks and exits immediately without waiting for in-flight pushes or background GC sweeps.
   - **Fix:** Use `const runner = ctx.pushRunner ?? ctx.push ?? createPushRunner(ctx);` in `src/api/push.mjs`.

---

## 4. Minor Notes (Non-Blocking)

1. **`pageNumber` optionality (`src/api/push.mjs`)**: `openapi/sissi-v1.yaml` lists `pageNumber` under `PushRequest.pages.items.required`, whereas `validatePushBody` allows `page.pageNumber === undefined`. Harmless in practice since `pageNumber` is only a label, but worth keeping in mind if strict schema validation is added later.
2. **Admin rate-limit IP behind Traefik (`src/admin-auth/index.mjs`)**: `clientIp(req)` uses `req.socket.remoteAddress`, which behind Traefik will be the proxy's container IP for all clients. Acceptable for step 1 if intentional (or can read a trusted proxy header later), just noting for operator awareness.
3. **S3 `streamMedia` `HEAD` handling (`src/api/read.mjs`)**: `HEAD /media/:file` calls `storage.getMedia` and immediately destroys the stream, which is fine, though `statMedia` could avoid opening a body stream on `HEAD` without `Range`.
