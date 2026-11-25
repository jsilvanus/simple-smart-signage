# Image size variants for Sissi views

Status: **plan decided, ready for implementation** (2026-11-24). Companion to [`views-web-embeds.md`](views-web-embeds.md).
Implementation lives in this repository (`simple-smart-signage`); mirroring new environment variables into the active private deployment repository (`riksunsrk/sissi`, since local `deploy/kyltti` is stale/unpushed) is noted as a deployment follow-up in section 7.

## 1. Problem & Goal

TV signage screens (`kind: "screen"`) play fixed-resolution assets (for example `1920×1080`) from browser or Service Worker cache, so serving the original Canva PNG/MP4 via `/s/:screenId/playlist.json` is intentional and stays unchanged.

Web views (`kind: "view"` and `"aggregate"`) embed Sissi content on church web pages across phones (360–430 px wide), tablets, desktops, narrow sidebars, gallery grids (`minmax(12rem, 1fr)` ≈ 192–360 px tiles), and hero carousels. Today Canva exports full-resolution PNGs (often 1–8 MB each), and `/v/:viewId/playlist.json` exposes only the raw original `url: /media/<sha256>.png`. Gallery grids and mobile visitors download multi-megabyte originals, and `/admin` Thumbnail View fetches full originals as well.

Goal: generate web-optimized, downscaled image size versions at ingest, store them content-addressed alongside originals, expose them in `/v/:viewId/playlist.json` (and `/api/v1/admin/screens`), and render responsive `<picture>` / `srcset` / `sizes` in `src/views/runtime.js` while staying fully backwards compatible with existing stored entries and TV players.

## 2. Scope & Non-Goals (v1)

### In scope (v1)
- Aspect-preserving resized WebP variants for **image entries** (`png`, `jpg`, `webp`) via `sharp` (already proven in the sibling `imagehost-mcp` service on `node:*-slim`).
- Resized WebP variants for **video poster thumbnails** (`entry.thumbMediaId` uploaded via `PUT /api/v1/admin/screens/:screenId/entries/:entryId/thumbnail`), exposed on `/v/:viewId/playlist.json` as `poster` and `posterVariants`.
- Fixing two existing `src/views/runtime.js` gaps discovered during review that directly affect multi-size web delivery (plus related runtime/media bugs found in the views review):
  1. **Cross-origin URL resolution bug**: `src/api/views.mjs` emits root-relative `/media/...` URLs; in cross-origin `<script src=".../embed.js">` embeds, `runtime.js` must resolve `entry.url`, every `variant.url`, and `entry.poster` against `opts.playlistUrl` (`new URL(u, opts.playlistUrl).href`) so browsers do not fetch `/media/...` from the host website origin. (Also add missing `Access-Control-Allow-Origin: *` on `206` Range responses in `src/api/read.mjs`.)
  2. **Unapplied `embed.options.aspect` and `embed.options.fit`**: `src/views/embed.mjs` validates `aspect` (e.g. `16:9`, `4:3`, `1:1`, `9:16`) and `fit` (`contain` | `cover`), but `src/views/runtime.js` does not yet apply CSS `aspect-ratio` on `.sv-stage` / `.sv-grid .sv-media` (causing `.sv-stage` with `position: absolute` slides to collapse to `0` height in shadow-DOM `embed.js` embeds) or `object-fit` on `img` / `video`. Alongside Task 4, also fix `.sv-dot` CSS specificity, carousel video `ended`/timer handling, and using `parsed.embed` on poll.
- Admin UI thumbnail view (`public/admin/app.js`) selecting a small WebP variant (`320w`) when available.
- Idempotent backfill endpoint (`POST /api/v1/admin/variants/backfill`) and CLI script for already-stored entries.

### Out of scope (v1)
- **Video transcoding / multi-bitrate MP4 or WebM**: confirmed out of scope for v1 — Sissi stays `ffmpeg`-free in `node:24-slim` (`docs/plans/step-1-web-signage.md`, client-side frame capture in `public/admin/app.js`); only video poster thumbnails get WebP variants.
- **Public on-the-fly resize endpoints** (e.g. `GET /media/:sha?w=500`): rejected to prevent CPU/memory/cache-busting DoS on public endpoints and cold-start encode latency.
- **Server-side cropped aspect-ratio variants** (e.g. separate `1:1`, `9:16`, and `16:9` cover crops per image): deferred in v1 — aspect-preserving width variants plus CSS `aspect-ratio` and `object-fit: contain | cover` handle framing without multiplying storage permutations (`widths × aspects`).

## 3. Size Ladder, Formats & `sharp` Processing Rules

### Width ladder
- **Default (`SISSI_VARIANT_WIDTHS`)**: `[320, 640, 960, 1280, 1920]` px (CSS/pixel widths):
  - `320w`: admin thumbnails, 1x gallery tiles, narrow cards
  - `640w`: mobile 1x–2x, 2x gallery tiles, sidebars
  - `960w`: tablets, medium embeds
  - `1280w`: desktop embeds, 3x mobile
  - `1920w`: full-width desktop/Retina hero banners (a 1920w WebP is typically 5–15× smaller than raw 1920w PNG)
- **No-upscale & non-standard / portrait width rule**:
  - Keep every configured target width `<= originalWidth`.
  - If `originalWidth <= maxLadderWidth` (for example a `1080×1920` vertical Canva slide or an `800×600` photo) and `originalWidth` is more than ~5% above the highest kept ladder step, also include `originalWidth` as the top WebP width so portrait/medium images still get a full-resolution WebP rather than falling back to a multi-MB PNG.
  - Never upscale (`withoutEnlargement: true`). An image smaller than the lowest step (e.g. `200×200`) produces only a `200w` variant.

### Formats
- **WebP only in v1**: `image/webp` (`quality: 82`, `effort: 4`). WebP is Baseline Widely Available, preserves Canva PNG alpha transparency, and encodes quickly in CPU (~30–80 ms per width).
- **Future extensibility**: keep `ext` / `type` on stored variant records and render `<picture><source type="image/webp" srcset="..." sizes="...">` dynamically by `variant.type` so adding another format (such as AVIF) later requires zero schema or runtime redesign.
- **Original preserved**: the original uploaded/downloaded bytes stay untouched at `entry.url` as the canonical source and `<img src>` fallback.

### Safety, EXIF & VPS memory guards (`src/media/variants.mjs`)
- Open inputs with `sharp(filePath, { limitInputPixels: config.variants.maxPixels, sequentialRead: true, failOn: 'error' })`, defaulting `SISSI_MAX_IMAGE_PIXELS=50000000` (50 MP, matching `imagehost-mcp`) to reject pixel bombs.
- Call `.rotate()` before measuring or resizing so EXIF orientation is baked into pixel dimensions and EXIF/ICC/location metadata is stripped by default. Read post-rotation intrinsic `width` and `height`.
- Configure `sharp.concurrency(1)` (or `2`) and `sharp.cache(false)` so `SISSI_MAX_CONCURRENT_PUSHES=3` stays comfortably within VPS container RAM limits.
- Stream/write each variant to a temp file, compute `sha256Hex`, store via `storage.putMediaFromFile(vSha, vExt, vTmpPath, vContentType)`, and unlink temp files in `finally`.

## 4. Storage Model, State Schema & Garbage Collection

### Content-addressed variant storage
- Variants are stored as ordinary immutable blobs under `media/<variantSha256>.<ext>` via `storage.putMediaFromFile(...)`.
- **Zero changes** are needed to [`src/storage/local.mjs`](../../src/storage/local.mjs), [`src/storage/s3.mjs`](../../src/storage/s3.mjs), [`src/storage/memory.mjs`](../../src/storage/memory.mjs), or `GET /media/:file` (`MEDIA_FILE_RE = /^([0-9a-f]{64})\.([a-z0-9]+)$/` in [`src/api/read.mjs`](../../src/api/read.mjs)).
- Variants automatically inherit `Cache-Control: public, max-age=31536000, immutable`, `Access-Control-Allow-Origin: *`, and frame CSP `img-src 'self'`.
- Future encoder/quality adjustments naturally produce new SHA-256 keys without stale cache collisions.

### Entry schema additions (`src/state/index.mjs`)
All new fields are optional so pre-existing screen/view JSON documents remain valid without migration:

```json
{
  "entryId": "entry_...",
  "mediaId": "<origSha256>",
  "ext": "png",
  "kind": "image",
  "width": 1920,
  "height": 1080,
  "variants": [
    { "mediaId": "<sha>", "ext": "webp", "width": 320, "height": 180, "bytes": 8412 },
    { "mediaId": "<sha>", "ext": "webp", "width": 640, "height": 360, "bytes": 21340 }
  ],
  "thumbMediaId": "<thumbSha>",
  "thumbExt": "png",
  "thumbVariants": [
    { "mediaId": "<sha>", "ext": "webp", "width": 320, "height": 180, "bytes": 5100 }
  ]
}
```

- Embedding `variants` and `thumbVariants` directly on the entry ensures `GET /v/:viewId/playlist.json` and aggregate joins perform **zero extra S3 GETs** (no N+1 sidecar reads on every 60 s embed poll).
- Validate `width`, `height`, `variants`, and `thumbVariants` in `applyPush` and `setEntryThumbnail`, and add `state.setEntryVariants(screenId, entryId, { width, height, variants, thumbVariants })` (which only persists and bumps `version` if something changed).

### Ingest deduplication cache (`state/media/<origSha256>.json`)
- Before invoking `sharp`, `generateFromFile` can check `storage.getJson('state/media/<origSha256>.json')` keyed by a profile signature (e.g. `webp:82:320,640,960,1280,1920`) and confirm referenced variant objects still exist (`statMedia`) so pushing the same Canva slide to multiple screens/views avoids re-encoding.
- Public read paths (`/v/:viewId/playlist.json`, `/s/:screenId/playlist.json`) never read `state/media/`.

### Garbage Collection (`src/state/index.mjs`)
- Update `referencedMedia()` to include `${v.mediaId}.${v.ext}` for every object in `entry.variants` and `entry.thumbVariants`.
- Update `gcSweep()` to also delete `state/media/<sha>.json` cache records whose `<sha>` is no longer referenced as `entry.mediaId` or `entry.thumbMediaId` on any screen/view.
- Deleting or replacing an entry automatically GCs orphaned variant blobs after `SISSI_GC_GRACE_MINUTES` while protecting variants shared across screens or views.

## 5. Public View API & Embed Runtime

### `GET /v/:viewId/playlist.json` (`src/api/views.mjs`)
Backwards-compatible additions on each entry in `toPublicEntries`:
- Keep `url` as the canonical original URL (`router.url('/media/<mediaId>.<ext>')`).
- Add `width: e.width ?? null` and `height: e.height ?? null`.
- Add `variants`: array sorted ascending by `width` of `{ url, width, height, type, bytes }` where `type` comes from `inferContentType(v.ext)` (`[]` for video or legacy un-processed entries).
- For video entries with `thumbMediaId`: add `poster` (best WebP poster variant URL, or fallback `/media/<thumbMediaId>.<thumbExt>`) and `posterVariants` (same shape as `variants`).
- TV player playlist (`GET /s/:screenId/playlist.json` in [`src/api/read.mjs`](../../src/api/read.mjs)) stays unchanged.

### Embed runtime (`src/views/runtime.js`)
1. **Cross-origin URL resolution**: pass `playlistUrl` into `render(root, playlist, embed, playlistUrl)` and resolve `entry.url`, every `variant.url`, and `entry.poster` with `new URL(u, playlistUrl).href`.
2. **Apply `embed.options.aspect` and `embed.options.fit`**:
   - Convert validated `"W:H"` (`16:9`, `4:3`, `1:1`, `9:16`, etc.) to `--sv-aspect: W / H` and `--sv-fit: contain | cover` on `.sissi-view`.
   - Apply `aspect-ratio: var(--sv-aspect, 16 / 9)` on `.sv-stage` (fixing collapsed `0`-height stages in shadow-DOM `embed.js` embeds; in `/frame`, constrain max height within the viewport without clipping nav controls) and `.sv-grid .sv-media`.
   - Apply `object-fit: var(--sv-fit, contain)` on `.sv-media img, .sv-media video`.
3. **Responsive `<picture>` rendering**:
   - When `entry.variants` has entries, group dynamically by `variant.type` and emit `<source type="image/webp" srcset="..." sizes="...">` (supporting any future MIME type added later without hardcoding) with `srcset` (`"<url> <width>w, ..."`) and explicit `sizes`, followed by fallback `<img src="<entry.url>" ...>`.
   - **Always set `sizes`** alongside `srcset` (otherwise browsers assume `100vw`):
     - `single` / `carousel`: `"100vw"` inside `/frame`; in shadow-DOM `embed.js`, measure the host container width (`Math.max(320, Math.round(rect.width)) + 'px'`, falling back to `"100vw"` if unmeasured, and updating on significant `ResizeObserver` width changes).
     - `gallery`: `"(max-width: 600px) 50vw, 320px"` for grid thumbnails (and `"90vw"` if a gallery lightbox view is added later).
   - Set integer `width` and `height` attributes on `<img>` when `entry.width` and `entry.height` are known to prevent CLS.
   - **Loading & `fetchpriority` rules**:
     - Initial visible slide (`single`, or `carousel` slide `0`): omit `loading` (defaults to eager — never `loading="lazy"`) and set `fetchpriority="high"`.
     - Initially hidden carousel slides (`index > 0`): set both `fetchpriority="low"` and `loading="lazy"`.
     - Gallery grid thumbnails: set `loading="lazy"` and omit `fetchpriority` (never combine `fetchpriority="low"` with standard below-the-fold lazy images).
4. **Video elements in views**:
   - Set explicit integer `width` and `height` when known and `poster` from `entry.poster`.
   - Use `preload="metadata"` (instead of `preload="auto"`) for carousel slides and `preload="none"` + `loading="lazy"` for gallery/offscreen videos; continue respecting `prefers-reduced-motion: reduce`.

## 6. Ingest Flows, Admin UI & Backfill

- **Push worker (`src/push/index.mjs`)**:
  - Keep `PushStatus.state` enum unchanged (`queued | downloading | ready | failed`) so [`openapi/sissi-v1.yaml`](../../openapi/sissi-v1.yaml) and `canva-pieco-app`'s `waitForSignagePush` remain untouched.
  - Before cleaning up `dl.tmpPath`, if `dl.kind === 'image'` and `shouldGenerateVariants(screen, config.variants)` is true, generate variants via injectable `variants.generateFromFile(...)` and attach `width`, `height`, and `variants` to the item passed to `state.applyPush`.
  - Map corrupt image or pixel-limit errors from `sharp` to existing OpenAPI error codes `UNSUPPORTED_TYPE` (415) / `TOO_LARGE` (413).
- **Admin manual upload & video thumbnail (`src/api/admin.mjs`)**:
  - `POST /api/v1/admin/screens/:screenId/uploads`: if `shouldGenerateVariants(screenNow, config.variants)` is true, generate variants from `tmpPath` for uploaded images before cleanup and pass `width`, `height`, `variants` to `state.applyPush` (optionally also accept JPEG/WebP alongside PNG).
  - `PUT /api/v1/admin/screens/:screenId/entries/:entryId/thumbnail`: if `shouldGenerateVariants(screenNow, config.variants)` is true, generate small WebP poster variants (`[320, 640]`, capped at original width) and pass `thumbVariants` to `state.setEntryThumbnail`.
- **Admin UI (`public/admin/app.js`)**:
  - Update `thumbUrlFor(entry)` to select the smallest WebP variant with `width >= 320` (from `entry.variants` for images or `entry.thumbVariants` for video thumbnails), falling back to the original `mediaUrlFor(entry)`.
- **Backfill for pre-existing media**:
  - Add `POST /api/v1/admin/variants/backfill` (password-admin only, optional `{ screenId }`, idempotent, concurrency `1`, returns `{ screens, processed, skipped, failed }`) and a thin CLI helper `src/scripts/backfill-variants.mjs` for one-shot post-deploy backfill.
  - Pre-existing entries without `variants` continue rendering via `entry.url`.

## 7. Configuration, Dependencies, Docker, Metrics & OpenAPI

- **Dependency**: add `sharp` to `package.json` `dependencies`. Its prebuilt Linux x64/arm64 binaries run on `FROM node:24-slim` (`Dockerfile`) without extra apt packages, preserving `test/deploy/deploy.test.mjs` invariants.
- **Environment variables (`src/config.mjs`, `.env.example`, `docker-compose.yml`)**:
  - `SISSI_IMAGE_VARIANTS`: default `all`. Accepted values:
    - `all`: generate variants for every target (`screen` and `view`).
    - `off` (or `none`): disable variant generation.
    - Comma-separated allow-list of target kinds (`view`/`views`, `screen`/`screens`) and/or specific screen/view IDs (`^[a-z0-9-]{1,40}$`), for example `views`, `screen,view`, `view,lobby`, or `aikuistyo,nuorisotyo`.
    - Matcher helper `shouldGenerateVariants(target, config.variants)`: returns `true` for `all`, `false` for `off`/`none`, and otherwise `true` if `(target.kind ?? 'screen')` is in `kinds` OR `target.id` is in `ids`.
  - `SISSI_VARIANT_WIDTHS`: comma-separated positive integers (default `320,640,960,1280,1920`, sorted unique, max 10 items, max width `4096`).
  - `SISSI_MAX_IMAGE_PIXELS`: positive integer pixel cap (default `50000000`).
  - **Compose parity pitfall**: `test/deploy/deploy.test.mjs` asserts that every variable in `.env.example` (except `SISSI_ALLOW_PRIVATE_DOWNLOADS`) appears as `- <VAR>=` in `docker-compose.yml` — update both together, and mirror the new variables into the active private deploy repository (`riksunsrk/sissi` on GitHub) during deployment rollout.
- **Metrics (`src/metrics.mjs`)**:
  - `sissi_variant_jobs_total{status}` (`ok`, `cached`, `error`, `skipped`)
  - `sissi_variant_seconds_total`
  - `sissi_variant_bytes_total{format}`
- **OpenAPI (`openapi/sissi-v1.yaml`)**:
  - Document `ImageVariant` schema (`url`, `width`, `height`, `type`, `bytes`), optional `width`, `height`, `variants`, `poster`, `posterVariants` on `Entry` and view playlist entries, and `POST /admin/variants/backfill`.

## 8. Phased Implementation Plan & Verification Matrix

1. **Task 1 — Core variant generator & config**: `package.json` (`sharp`), `src/config.mjs` (including `SISSI_IMAGE_VARIANTS` parsing and `shouldGenerateVariants` matcher), `.env.example`, `docker-compose.yml`, `src/media/variants.mjs` (pure ladder selection + `createVariantGenerator`), unit tests `test/media/variants.test.mjs` (landscape `1920×1080`, vertical `1080×1920`, small `200×200` no-upscale, alpha PNG, EXIF rotation, pixel-bomb rejection, cache hit, and `SISSI_IMAGE_VARIANTS` parsing/matching for `all`, `off`, `views`, `screen,view`, `view,lobby`, and invalid tokens).
2. **Task 2 — State & GC integration**: `src/state/index.mjs` (`width`, `height`, `variants`, `thumbVariants`, `setEntryVariants`, `referencedMedia`, `gcSweep` cleanup for variants and `state/media/` cache docs), tests in `test/state/state.test.mjs` verifying shared-reference protection and post-grace deletion.
3. **Task 3 — Ingest wiring (push, upload, video thumbnail, backfill)**: `src/start.mjs`, `src/server.mjs`, `src/push/index.mjs`, `src/api/admin.mjs`, `src/scripts/backfill-variants.mjs`, tests in `test/push/push.test.mjs` and `test/admin/admin.test.mjs`.
4. **Task 4 — Public view API, runtime `<picture>` & admin thumbnails**: `src/api/views.mjs`, `src/api/read.mjs` (`206` CORS fix), `src/views/runtime.js`, `public/admin/app.js`, tests in `test/views/views.test.mjs` and `test/views/embed.test.mjs`, plus headless Chromium checks verifying `/frame` and shadow-DOM `embed.js` pick WebP variants (`currentSrc`) sized to container width with non-zero stage height.
5. **Task 5 — OpenAPI & docs**: `openapi/sissi-v1.yaml`, `docs/operations.md`, status updates in `docs/plans/views-image-variants.md` and `docs/plans/views-web-embeds.md`.

> **Baseline note (2026-11-24, commit `142ffdc`)**: On hosts with Chrome or Edge installed, 3 pre-existing Playwright tests currently fail with `StateError (INVALID_MODE): replace needs enabled: true`: `test/player/player.test.mjs` (lines 169, 191, 231, 300) and `test/tizen/tizen.test.mjs` (lines 208, 299) omit `enabled: true` when calling `state.applyPush(..., { mode: 'replace' })` after PR #5 introduced that requirement (Linux CI skips them when no browser binary is present). Fix those test calls in a small prep commit before or alongside Task 4's Playwright checks.

## 9. Decisions

Decided (Juha 2026-11-24):
1. **Aspect-preserving first**: generate aspect-preserving width variants (`320, 640, 960, 1280, 1920`) and handle framing with CSS `aspect-ratio` / `object-fit: contain | cover` in v1 (server-side cropped aspect variants deferred).
2. **Target scope (`SISSI_IMAGE_VARIANTS`)**: default `all`; supports `all`, `off`, or comma-separated kinds (`view`/`views`, `screen`/`screens`) and/or specific screen/view IDs.
3. **Format**: WebP only in v1 (keep `ext`/`type` in the variant schema and `<picture>` source grouping for future extensibility).
4. **Video**: no video scaling / no `ffmpeg` in v1; only generate WebP variants for video poster thumbnails.
