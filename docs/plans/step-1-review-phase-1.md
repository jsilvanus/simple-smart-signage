# Step 1 — Phase 1 Review

**Branch:** `step-1-impl` (commit `56dd388`, `npm test` 52/52 passing)  
**Verdict:** **Cleared for Phase 2.** No must-fix blockers; all Phase 1 interface contracts in `docs/plans/step-1-progress.md` are met and security/hardening requirements from `docs/plans/step-1-web-signage.md` (§4, §6, §11) and `openapi/sissi-v1.yaml` are satisfied.

---

## 1. Interface Contracts Check

- **storage (`src/storage/index.mjs`)**: Exports `createStorage(config.storage, opts)`, `createMemoryStorage()`, and `StorageConflictError`. All required methods (`putMediaFromFile`, `getMedia` with Range, `statMedia`, `deleteMedia`, `listMedia`, `getJson`, `putJson` with `ifMatch`, `deleteJson`, `listJson`) are implemented consistently across `local`, `s3`, and `memory` drivers.
- **state (`src/state/index.mjs`)**: Exports `createState(storage, { now?, idGen? })` and `StateError(code, message)`. Screen CRUD, `mutateScreen`, playlist ops (`applyPush`, `removeEntry`, `reorderEntries`, `setEntrySeconds`, `removePush`, `getPlaylist`), push records (`createPush`, `updatePush`, `getPush`, `sweepPushes`, `markInterruptedOnStart`), and GC (`referencedMedia`, `gcSweep`) all match the Phase 1 contract and OpenAPI `ScreenInput`/`ErrorCode` definitions.
- **download (`src/download/index.mjs`)**: Exports `createDownloader(config, deps)`, `DownloadError`, `scrubUrl`, `sniffKind`, `readMp4Duration`, and `isPrivateAddress`. `downloadPage({ url, kindHint?, maxBytes, signal? })` returns `{ tmpPath, size, sha256, kind, ext, contentType, durationSeconds }` and deletes `tmpPath` on any failure.
- **auth (`src/auth/index.mjs`, `src/auth/testing.mjs`)**: Exports `createAuth(config, { fetch?, now? })` returning `{ authenticate, handleCors, applyCors }`, plus `testing.createFakeCanva()`. `authenticate(req)` throws `HttpError` with `401 UNAUTHORIZED`, `403 TEAM_NOT_ALLOWED`, or `503 AUTH_NOT_CONFIGURED`.

---

## 2. Security & Hardening Check

- **SSRF & Download (`src/download/index.mjs`)**:
  - Enforces `https:` (allowing `http:` and private IPs only when `config.allowPrivateDownloads` is true, and throws in `createDownloader` if `config.production` is true).
  - Rejects URL credentials (`username`/`password`) and checks `config.downloadHosts` on dot boundaries.
  - Resolves DNS once via injectable `lookup`, blocks private/loopback/link-local/multicast/unspecified/unique-local IPv4 and IPv6 addresses (including `::ffff:` IPv4-mapped, NAT64, and 6to4), and connects directly to the resolved IP with `Host` and TLS `servername` (no second DNS lookup).
  - Re-validates every redirect hop (max 4), enforces `maxBytes` via `Content-Length` and streaming byte count, enforces connect/idle timeouts and `AbortSignal`, and scrubs credentials/query strings/fragments from all error messages via `scrubUrl`.
- **Auth & CORS (`src/auth/index.mjs`)**:
  - Enforces `alg === 'RS256'` and required `kid` in JWT header; filters JWKS to `RSA` `sig` `RS256` keys; rejects `alg: none` and `HS256` key-confusion attacks with `401 UNAUTHORIZED` without leaking failure reasons.
  - Verifies `aud === appId` (string or array), `exp`, optional `nbf`, and `brandId` against `allowedBrands` (`403 TEAM_NOT_ALLOWED`).
  - Compares `SISSI_PUSH_KEY` using `timingSafeEqual`.
  - JWKS cache (60 min) with 30 s cooldown on unknown-`kid` refresh.
  - `handleCors` / `applyCors` restrict CORS headers to `config.corsOrigins` and return `403` on disallowed `OPTIONS` preflights.
- **Storage (`src/storage/`)**:
  - `validateMediaParts`, `validateJsonKey`, `validatePrefix`, and `resolveSafe` prevent path traversal (`..`, `/`, `\`, null bytes).
  - Local driver uses atomic temp-file + `rename` writes and per-key in-process locks for `ifMatch` CAS; S3 driver uses `IfMatch` / `IfNoneMatch` conditional writes.
- **State (`src/state/index.mjs`)**:
  - `mutateScreen` serializes per-screen mutations with an in-process FIFO queue lock, increments `version`, and uses `putJson` `ifMatch` CAS (1 retry on conflict, then `StateError('BUSY')`).
  - `gcSweep` skips all referenced media and any object newer than `graceMinutes`.

---

## 3. Must-Fix Items

None.

---

## 4. Minor Notes (for Phase 2 / Future Cleanup)

1. **Error translation in Phase 2**: `StateError` (`src/state/index.mjs`) and `DownloadError` (`src/download/index.mjs`) are not instances of `HttpError` (`src/router.mjs`). Phase 2 route handlers must catch `StateError` and convert it to `HttpError(err.code, err.message, err.status)` (or `sendError`), otherwise `router.handle` will treat it as an unhandled `500 INTERNAL`.
2. **Invalid ID characters in state lookups**: `getScreen(id)`, `deleteScreen(id)`, `getPlaylist(screenId)`, and `getPush(pushId)` pass the ID directly to `storage.getJson(...)`. If a caller passes `..` or `/` in a path param, `validateJsonKey` throws a generic `Error` (which becomes `500 INTERNAL` in `router.mjs` instead of `404`/`422`). Phase 2 route handlers should validate `screenId` / `pushId` path parameters before calling `state`.
3. **S3 vs. local/memory `getMedia` out-of-range behavior**: On an out-of-bounds byte range (`start >= size` or explicit range on a 0-byte object), `local` and `memory` throw `RangeError`, while `s3` forwards `Range` to S3 and surfaces an S3 416 `InvalidRange` error. Phase 2 (`src/api/read.mjs`) should clamp/validate the `Range` header against `statMedia` (or handle both `RangeError` and S3 416) to return `416 Range Not Satisfiable`.
4. **MP4 `ftyp` brand check**: Plan §11.4 mentions `isom`/`mp42`/`avc1`-compatible brands; `sniffKind` currently checks only for the `ftyp` box header at offset 4..8. Acceptable for step 1, and can be tightened later if non-MP4 `ftyp` containers (e.g., HEIC/AVIF) need to be rejected explicitly.
5. **CORS wiring in Phase 2**: `src/router.mjs` does not currently invoke `auth.handleCors` or `auth.applyCors`; Phase 2 / server wiring should ensure `OPTIONS` preflights are handled before `router.handle` returns `405 METHOD_NOT_ALLOWED`.
6. **`PushStatus` / `playlist.json` field shaping in Phase 2**: `getPush(pushId)` returns `createdAt`/`updatedAt` alongside the OpenAPI `PushStatus` fields, and `getPlaylist(screenId)` returns raw `Entry` objects (`mediaId`, `ext`, etc.). Phase 2 `GET /api/v1/push/:pushId` and `GET /s/:screenId/playlist.json` should shape the responses to match OpenAPI `PushStatus` and Plan §4.5 / §11.9 (`url` with `router.url(...)` and `sha256`).
