# Step 1: web signage for Yodeck (plan)

Status: **plan, not built** (2026-11-19). This is the first step of the signage project. It is a deliberately small partial of the SiSSi prototype ([release scope](../roadmap-by-release.md)). Site data (host names, Canva team id, secrets) is not in this repository: it belongs in the operator's private deployment repository.

## 1. Problem

Some screens are outdoors and run a Yodeck player. The Yodeck plan in use has no API, so the only practical content is one **Web Page** item shown full-screen. That page has to run its own slideshow.

Content is made in Canva. The Canva app (canva-pieco-app, "pieco-canva") already publishes slides to other targets; signage becomes one more publish target.

## 2. What step 1 builds

One small service on the church VPS, with three surfaces:

| Surface | Who | Auth |
|---|---|---|
| Push API (`/api/v1/...`) | the Canva app | Canva user token, team-checked |
| Player pages (`/s/<screenId>`) | Yodeck (any browser) | none, read-only |
| Admin page (`/admin`) | operators | password, session cookie |

What step 1 does not need: the Pi. Canva talks to the VPS service directly (section 7).

Out of scope for step 1 (stays in the SiSSi roadmap): device enrolment, tenants, review/approval, schedules, design systems, native clients, OpenAPI-generated CLI. The data model is chosen so it can grow into the prototype's scene/playlist/assignment model (section 9).

## 3. Concepts

- **Screen**: a player page. `id` (slug, `[a-z0-9-]{1,40}`, chosen by the operator), `name`, `orientation` (`landscape` | `portrait`), optional `width`/`height` hint for the Canva export size, `defaultImageSeconds` (default 10), `maxVideoSeconds` (optional, set on the admin page; `null` = no limit; a longer video fails the push with `VIDEO_TOO_LONG`).
- **Media**: a stored file, content-addressed by SHA-256. Kind `image` (PNG, JPEG, WebP) or `video` (MP4, H.264/AAC expected). Video duration is read from the MP4 header (`mvhd` box) in Node, no ffmpeg.
- **Entry**: one line in a screen's playlist: `{ entryId, mediaId, kind, seconds, title, pushId, addedAt }`. For an image, `seconds` is the time on screen. For a video, `seconds` is the video's own duration (informational; the player moves on at the video's `ended` event).
- **Playlist**: ordered entries of one screen plus a `version` (increments on every change). One playlist per screen.
- **Push**: one publish from Canva. Its pages become entries; `pushId` groups them so the admin page can show and remove a publish as a unit.

## 4. API contract (v1)

Base: `<SISSI_BASE_URL>/api/v1`. JSON, UTF-8. Errors always look like:

```json
{ "error": { "code": "SCREEN_NOT_FOUND", "message": "Unknown screen: lobby" } }
```

### 4.1 Auth for the Canva app

`Authorization: Bearer <token>` where the token is the Canva user token from `auth.getCanvaUserToken()`. The service verifies it the same way pigateway does today: RS256, keys from Canva's JWKS for the app, audience = the app id, and `brandId` must be on `SISSI_CANVA_ALLOWED_BRANDS`. No key is shipped in the plugin bundle.

A static `SISSI_PUSH_KEY` (Bearer) is also accepted, for curl tests and scripts. Unset = only Canva tokens.

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | missing, bad or expired token |
| 403 | `TEAM_NOT_ALLOWED` | genuine token, team not on the list |
| 503 | `AUTH_NOT_CONFIGURED` | neither Canva app id + teams nor push key set |

CORS: only origins in `SISSI_CORS_ORIGINS` (the Canva app's origin) get CORS headers; other preflights get 403.

### 4.2 `GET /api/v1/screens`

What the plugin shows in its screen picker.

```json
{
  "screens": [
    {
      "id": "lobby",
      "name": "Lobby",
      "orientation": "landscape",
      "width": 1920,
      "height": 1080,
      "defaultImageSeconds": 10,
      "maxVideoSeconds": null,
      "entryCount": 7,
      "playlistVersion": 12
    }
  ]
}
```

### 4.3 `POST /api/v1/push` → 202

```json
{
  "screenId": "lobby",
  "mode": "append",
  "title": "Joulukonsertti",
  "pages": [
    { "pageNumber": 1, "kind": "image", "url": "https://export-download.canva.com/...", "seconds": 8 },
    { "pageNumber": 2, "kind": "image", "url": "https://...", "seconds": 12 },
    { "pageNumber": 3, "kind": "video", "url": "https://..." }
  ]
}
```

- `screenId` required, must exist (the plugin cannot create screens).
- `mode`: `append` (default, add to the end) or `replace` (the push becomes the whole playlist).
- `title`: 1-200 chars, shown on the admin page.
- `pages`: 1-100, in play order (`pageNumber` only labels them).
  - `kind`: `image` or `video`, **optional**. Omitted = the service sniffs the bytes (PNG, JPEG, WebP = image; MP4 = video). Given = the bytes must match, otherwise the push fails with `KIND_MISMATCH`.
  - A Canva design whose pages are video may arrive as **one MP4 for the whole design**; that is one `video` entry. Nothing in the contract assumes one file per page.
  - `seconds` (images only): whole number 1-3600. Missing = the screen's `defaultImageSeconds`. Ignored for video.
  - `url`: https only, host must end with one of `SISSI_DOWNLOAD_HOSTS` (default `canva.com, canva.dev, canva-apps.com`), no credentials in the URL, redirects re-checked on every hop (max 4).
- Limits: image 40 MB, video 500 MB, whole push 1 GB (env-tunable).

The playlist is changed only when every page has downloaded and checked: a failed push, in either mode, leaves the screen exactly as it was (`replace` removes nothing until it succeeds).

**Concurrent pushes:** a second push to the same screen while one runs is accepted (202). Pushes are applied to a screen one at a time in the order they **finish**, each on the playlist as it is then (so a later `replace` wins over an earlier `append`). `429 BUSY` is returned only when more than 3 pushes are running in total on the service; the plugin shows it and lets the user retry.

Response:

```json
{ "pushId": "push_3f9a1c2b", "taskId": "push_3f9a1c2b", "state": "queued", "screenId": "lobby" }
```

with `Location: /api/v1/push/push_3f9a1c2b`.

| Status | Code | When |
|---|---|---|
| 404 | `SCREEN_NOT_FOUND` | unknown `screenId` |
| 422 | `INVALID_MODE`, `INVALID_TITLE`, `INVALID_PAGES`, `INVALID_KIND`, `INVALID_SECONDS`, `PAGE_URL_NOT_ALLOWED`, `TOO_MANY_PAGES` | body checks |
| 429 | `BUSY` | more than 3 pushes running on the service |

Failures found after the 202 end the push as `failed` with `error.code`: `DOWNLOAD_FAILED`, `TOO_LARGE`, `UNSUPPORTED_TYPE`, `KIND_MISMATCH`, `VIDEO_TOO_LONG`.

### 4.4 `GET /api/v1/push/:pushId`

```json
{
  "pushId": "push_3f9a1c2b",
  "screenId": "lobby",
  "state": "downloading",
  "progress": 0.4,
  "pages": { "done": 2, "total": 5 },
  "error": null,
  "playlistVersion": null
}
```

`state`: `queued` → `downloading` → `ready` | `failed`. On `ready`, `playlistVersion` is the version that now contains the push. Kept for 24 h. `error` is `null` or `{ code, message }`. Failure messages are readable and never contain the signed export URL's query string.

### 4.5 Player (public, read-only)

- `GET /s/:screenId` — the HTML page Yodeck shows.
- `GET /s/:screenId/playlist.json` — `{ screenId, version, orientation, entries: [{ entryId, kind, url, seconds }] }`, `Cache-Control: no-cache`.
- `GET /media/:sha256.:ext` — immutable, `Cache-Control: public, max-age=31536000, immutable`, Range support for video.
- Unknown screen: 404 page, the player shows a neutral black screen and retries.

### 4.6 Admin (password)

`/admin` page plus `/api/v1/admin/*` (session cookie, HMAC of `SISSI_ADMIN_PASSWORD`, `HttpOnly`, `SameSite=Strict`, `Secure`): create, rename and delete screens; reorder, remove and set seconds on entries; remove a whole push; preview a screen. Not available to the Canva token.

### 4.7 Ops

- `GET /health` → `{ ok: true }` (container healthcheck, Traefik check).
- `GET /metrics` → Prometheus text, Bearer `METRICS_BEARER_TOKEN`.

## 5. Player behaviour

- Plain HTML + JS, no framework. Full-screen, black background, `object-fit: contain` (cover optional per screen later).
- Images: shown for `seconds`, cross-fade 0.5 s. Videos: `muted autoplay playsinline`, next entry on `ended`, or after `seconds + 5` as a safety net, or immediately on `error`.
- Preloads the next entry before switching.
- Polls `playlist.json` every 60 s (and on any load error). A new `version` takes effect at the next entry boundary, not mid-slide.
- **Offline**: a service worker (scope `/s/`) caches the player, the last playlist and its media. If the VPS or the network is down, the screen keeps looping the last good playlist. The last playlist is also kept in `localStorage` as a fallback when the service worker is not available. Whether Yodeck's web page player keeps a service worker across reboots must be tested on the real player.
- Empty playlist: black screen (no error text on public screens).

## 6. Storage and deployment

Deployed as a **Docker image** with **Traefik routes** (Juha, 2026-11-19), following the riksunsrk deployment conventions:

- Image `ghcr.io/jsilvanus/sissi`, built and pushed by this repository's own workflow on `main` and `vX.Y.Z` tags. Container and service name `sissi`.
- Deploy-side `docker-compose.yml` in this repository: networks `traefik-public` + `shared_multi_network` (external) + `default`; no published host port; Traefik labels (`traefik.enable=true`, `Host(...)` + `PathPrefix(...)` rule from env, `entrypoints=websecure`, `tls.certresolver=letsencrypt`, `loadbalancer.server.port=3000`, StripPrefix middleware when served under a path); a real `healthcheck` on `/health`.
- The app's own deploy workflow runs as the `appdeploy` user on the VPS and writes the `.env` from the repository's GitHub environment secrets. Host names and secrets live there and in the private deployment repository, never in this repository.
- `/health`, bearer-gated `/metrics` (`METRICS_TOKEN_SISSI` in infra).

- **Media**: behind one storage interface, `SISSI_STORAGE=local|s3`. Production uses the shared S3 gateway (bucket from `add-app-storage.sh`); local disk for development.
- **State** (screens, playlists, push records): one JSON document per screen in the same storage, written atomically, versioned. Small enough that Postgres is not needed in step 1; the module boundary allows moving it to the shared Postgres later without API changes.
- Node 24 ESM, no build step. Dependencies kept to the Canva token verifier (the same `@canva/app-middleware` pin as pigateway) and the S3 client.
- Env: `SISSI_BASE_URL`, `SISSI_CANVA_APP_ID`, `SISSI_CANVA_ALLOWED_BRANDS`, `SISSI_PUSH_KEY`, `SISSI_CORS_ORIGINS`, `SISSI_DOWNLOAD_HOSTS`, `SISSI_ADMIN_PASSWORD`, `SISSI_STORAGE`, S3 settings, `METRICS_BEARER_TOKEN`, size limits.
- Tests: `node:test`, a fake Canva JWKS, a fake download host, a fake S3; the player is checked with Playwright (image timing, video end, offline after server stop).

## 7. The VPS gateway question

**Today:** the Canva app has one base URL, `https://<vps-host>/canva`. On the VPS that is a socat container behind Traefik, forwarding through the radio ssh tunnel to pigateway's Canva-only listener on the Pi. Everything Canva does goes to the Pi.

**Signage does not need the Pi.** Options:

| | How | For | Against |
|---|---|---|---|
| **A (recommended)** | Signage service gets its own Traefik route on the VPS (own path, for example `/signage`, or own host). Plugin keeps `/canva` for Pi targets and gets a second base URL for signage. | No tunnel, works when the Pi is down; least privilege (signage token check is separate from Pi control); no change to the existing tunnel. | Two base URLs in the plugin settings. |
| B | One VPS "Canva gateway" in front of both: `/canva/signage/*` goes to the signage service, the rest to the tunnel. | One base URL in the plugin. | A new routing component to own; Pi routes and signage share a path, and the socat proxy has to become a real HTTP router. |
| C | Signage through pigateway (Pi pushes to VPS). | Pi stays the source of truth. | Pi becomes a single point of failure for screens outside the church network; more moving parts. Juha ruled this out on 2026-11-19. |

Recommendation: **A** now. B can come later without breaking A: if a single base URL is wanted, a Traefik path rule on the same host (`/canva/signage` → signage service, priority above `/canva`) does it with labels only, no new code.

The Canva app's CORS origin has to be allowed by both services (`SISSI_CORS_ORIGINS` and pigateway's tunnel CORS list).

## 8. What the Canva app needs (contract for the canva-pieco-app plan)

- New publish target `signage` ("Signage (VPS)"), enabled only when the signage base URL is set.
- Settings for that target: **screen** (picker from `GET /screens`, refreshed when opened), **mode** (Add to end / Replace playlist), **title** (existing name field).
- **Per-image seconds**: shown **only when the signage target is selected**: one number field per image page (default = the screen's `defaultImageSeconds`, plus a "set all" field). Video pages show their duration read-only (taken from the export / video) and no seconds field.
- Export size and orientation follow the chosen screen (`width`/`height`/`orientation`); images as PNG, video pages as MP4.
- The date (`useAt`) and permanent-asset fields of other targets do not apply to signage and are hidden for it.
- Publish: `POST /push`, then poll `GET /push/:id` every second until `ready` or `failed`; show progress and the error message.
- Auth: Canva user token as Bearer (no key in the bundle).

## 9. How this grows into SiSSi

| Step 1 | SiSSi concept |
|---|---|
| Screen (public player URL) | Screen / display without enrolment |
| Entry with image or video | Simple media scene |
| Playlist per screen | Playlist + single assignment |
| Content-addressed media | Immutable published bytes (MVP asset library later) |
| Canva push | First import path into the asset library |

The next step after this is enrolment (verification number, approval) for the web client, which replaces public slugs with device credentials.

## 10. Open items to decide before building

1. Path (`/signage` on the existing host) or a separate host for the service. Recommendation: path on the existing host, so Canva's allowed-domains list does not grow.
2. Whether Yodeck's web page player keeps the service worker cache across reboots (test on the real player in the first deploy).
3. Video export from Canva may be one MP4 for the whole design (canva-pieco-app #21); the contract accepts that as one video entry.

## 11. Decisions and hardening (review of 2026-11-19; these override anything above)

Terminology: the Canva token check is by **brand** (`brandId`, `SISSI_CANVA_ALLOWED_BRANDS`). The error code stays `TEAM_NOT_ALLOWED` for compatibility with the Canva app; its message says "Canva team". Both documents call it "team" in user text.

Machine-readable contract: [`openapi/sissi-v1.yaml`](../../openapi/sissi-v1.yaml) is the single source of truth for the `/api/v1` push, screens and admin surfaces and the error codes. If prose and OpenAPI disagree, OpenAPI wins and the prose is fixed.

1. **Path prefix.** The service is served at `https://<host>/signage` (open item 1 resolved: path on the existing host). Traefik strips the prefix. Therefore: the player, service worker and admin page use **only relative URLs**; the app reads `SISSI_PUBLIC_PATH` (default `/signage`) only to build the root-relative URLs it hands out (`Location` header, media `url` in `playlist.json`); the service worker is served from `/s/sw.js` and its scope is the directory it is served from, so it works under any prefix.
2. **Service worker and video.** The Cache API does not serve Range requests reliably and has quota limits. Rule: images and the player shell are cached by the service worker. Videos are cached only when smaller than `SISSI_SW_MAX_VIDEO_MB` (default 100); the worker answers Range requests for cached videos itself by slicing the cached body. Larger videos are streamed from the network, and the offline loop skips an uncached video instead of stalling. `localStorage` keeps the last playlist as before. Yodeck behaviour is tested on a real player (open item 2) and documented in the operator notes whatever the result.
3. **SSRF.** The download client resolves the host itself and refuses private, loopback, link-local, multicast and unspecified addresses (IPv4 and IPv6, including IPv4-mapped); it connects to the resolved address (no second lookup) and re-checks on every redirect hop. A test server on `127.0.0.1` is allowed only when `SISSI_ALLOW_PRIVATE_DOWNLOADS=1` (tests only; refused when `NODE_ENV=production`).
4. **MP4 handling.** Duration comes from `mvhd`; when `mvhd` duration is 0 (fragmented MP4) the `mvex/mehd` duration is used; when neither exists the push fails with `UNSUPPORTED_TYPE` ("cannot read video length"). The brand must be `isom`/`mp42`/`avc1`-compatible; the codec is not inspected in step 1, and the operator notes say H.264/AAC is required by Yodeck players.
5. **Garbage collection.** Media is reference-counted from the screens' state documents. A media object with no references is deleted by a sweep that runs after every successful push and every admin removal, and only if the object is older than `SISSI_GC_GRACE_MINUTES` (default 60), so an in-flight push is never hurt. The sweep is a plain function with tests.
6. **Single instance.** The per-screen lock and the 3-push limit are in-process. Step 1 runs exactly one container; compose sets `deploy.replicas: 1` and the README says so. State writes also use a version check (compare-and-swap) so a second instance would fail loudly instead of corrupting a playlist.
7. **Admin hardening.** Cookie `Path` is `SISSI_PUBLIC_PATH`, login is rate-limited (5 failures per IP per 10 minutes, then 429), password compared in constant time, all admin writes need a CSRF header (`X-Sissi-Admin: 1`) in addition to `SameSite=Strict`.
8. **Push record retention.** Push records live 24 h in storage, a sweep removes expired ones. A restart mid-push marks the push `failed` with code `INTERRUPTED` and leaves the playlist untouched.
9. **Player data.** `playlist.json` entries carry `url` as a root-relative path including the prefix (`<SISSI_PUBLIC_PATH>/media/<sha256>.<ext>`) and `sha256`, so the worker can cache by content. The player page itself fetches `playlist.json` with a relative URL.

## 12. Build tasks for Sonnet-class agents

Each task is one agent with: this plan, `openapi/sissi-v1.yaml`, and the files its dependencies produced. Every task ends with passing `node --test` and a short note in `docs/plans/step-1-progress.md` (what was done, what is left). Phases are gates: the next phase starts only after the previous one is green and reviewed. Tasks inside a phase run in parallel and own **disjoint files**.

| Phase | Task | Owns (files) | Needs |
|---|---|---|---|
| 0 | OpenAPI file, repo skeleton, config, `/health`, `/metrics`, CI | `openapi/`, `package.json`, `src/server.mjs`, `src/config.mjs`, `.github/workflows/ci.yml`, `test/helpers/` | - |
| 1 | A. Storage interface, local and S3 drivers, content-addressed writes | `src/storage/` | 0 |
| 1 | B. State store: screens, playlists, push records, CAS versioning, per-screen lock, GC sweep | `src/state/` | 0 |
| 1 | C. Download client: SSRF guard, limits, sniffing, MP4 duration, scrubbed errors | `src/download/` | 0 |
| 1 | D. Auth: Canva token (JWKS), push key, CORS, fake JWKS test helper | `src/auth/` | 0 |
| 2 | E. Push API and push runner (apply on success, finish order, 429, interrupted) | `src/api/push.mjs`, `src/push/` | 1 |
| 2 | F. Read API: screens, `playlist.json`, `/media` with Range | `src/api/read.mjs` | 1 |
| 2 | G. Admin auth and admin API | `src/api/admin.mjs`, `src/admin-auth/` | 1 |
| 3 | H. Player page and service worker (+ Playwright tests) | `public/player/` | 2 (F) |
| 3 | I. Admin page | `public/admin/` | 2 (G) |
| 3 | J. Dockerfile, GHCR workflow, compose with Traefik labels | `Dockerfile`, `docker-compose.yml`, `.github/workflows/release.yml` | 0 |
| 4 | K. End-to-end test, README, operator notes (including the Yodeck test procedure) | `test/e2e/`, `README.md`, `docs/operations.md` | 3 |

After each phase an independent reviewer agent checks the diff against this plan and the OpenAPI file, and writes findings to `docs/plans/step-1-review-phase-N.md`.
