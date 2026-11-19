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

- **Screen**: a player page. `id` (slug, `[a-z0-9-]{1,40}`, chosen by the operator), `name`, `orientation` (`landscape` | `portrait`), optional `width`/`height` hint for the Canva export size, `defaultImageSeconds` (default 10).
- **Media**: a stored file, content-addressed by SHA-256. Kind `image` (PNG, JPEG, WebP) or `video` (MP4, H.264/AAC expected). Video duration is read from the MP4 header (`mvhd` box) in Node, no ffmpeg.
- **Entry**: one line in a screen's playlist: `{ entryId, mediaId, kind, seconds, title, pushId, addedAt }`. For an image, `seconds` is the time on screen. For a video, `seconds` is the video's own duration (informational; the player moves on at the video's `ended` event).
- **Playlist**: ordered entries of one screen plus a `version` (increments on every change). One playlist per screen.
- **Push**: one publish from Canva. Its pages become entries; `pushId` groups them so the admin page can show and remove a publish as a unit.

## 4. API contract (v1)

Base: `<SIGNAGE_BASE_URL>/api/v1`. JSON, UTF-8. Errors always look like:

```json
{ "error": { "code": "SCREEN_NOT_FOUND", "message": "Unknown screen: lobby" } }
```

### 4.1 Auth for the Canva app

`Authorization: Bearer <token>` where the token is the Canva user token from `auth.getCanvaUserToken()`. The service verifies it the same way pigateway does today: RS256, keys from Canva's JWKS for the app, audience = the app id, and `brandId` must be on `SIGNAGE_CANVA_ALLOWED_BRANDS`. No key is shipped in the plugin bundle.

A static `SIGNAGE_PUSH_KEY` (Bearer) is also accepted, for curl tests and scripts. Unset = only Canva tokens.

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | missing, bad or expired token |
| 403 | `TEAM_NOT_ALLOWED` | genuine token, team not on the list |
| 503 | `AUTH_NOT_CONFIGURED` | neither Canva app id + teams nor push key set |

CORS: only origins in `SIGNAGE_CORS_ORIGINS` (the Canva app's origin) get CORS headers; other preflights get 403.

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
  - `kind`: `image` or `video`. The service checks the downloaded bytes and rejects a mismatch.
  - `seconds` (images only): whole number 1-3600. Missing = the screen's `defaultImageSeconds`. Ignored for video.
  - `url`: https only, host must end with one of `SIGNAGE_DOWNLOAD_HOSTS` (default `canva.com, canva.dev, canva-apps.com`), no credentials in the URL, redirects re-checked on every hop (max 4).
- Limits: image 40 MB, video 500 MB, whole push 1 GB (env-tunable).

The playlist is changed only when every page has downloaded and checked: a failed push leaves the screen as it was.

Response:

```json
{ "pushId": "push_3f9a1c2b", "taskId": "push_3f9a1c2b", "state": "queued", "screenId": "lobby" }
```

with `Location: /api/v1/push/push_3f9a1c2b`.

| Status | Code | When |
|---|---|---|
| 404 | `SCREEN_NOT_FOUND` | unknown `screenId` |
| 422 | `INVALID_MODE`, `INVALID_TITLE`, `INVALID_PAGES`, `INVALID_KIND`, `INVALID_SECONDS`, `PAGE_URL_NOT_ALLOWED`, `TOO_MANY_PAGES` | body checks |
| 429 | `BUSY` | more than 3 pushes running |

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

`state`: `queued` → `downloading` → `ready` | `failed`. On `ready`, `playlistVersion` is the version that now contains the push. Kept for 24 h. Failure messages are readable and never contain the signed export URL's query string.

### 4.5 Player (public, read-only)

- `GET /s/:screenId` — the HTML page Yodeck shows.
- `GET /s/:screenId/playlist.json` — `{ screenId, version, orientation, entries: [{ entryId, kind, url, seconds }] }`, `Cache-Control: no-cache`.
- `GET /media/:sha256.:ext` — immutable, `Cache-Control: public, max-age=31536000, immutable`, Range support for video.
- Unknown screen: 404 page, the player shows a neutral black screen and retries.

### 4.6 Admin (password)

`/admin` page plus `/api/v1/admin/*` (session cookie, HMAC of `SIGNAGE_ADMIN_PASSWORD`, `HttpOnly`, `SameSite=Strict`, `Secure`): create, rename and delete screens; reorder, remove and set seconds on entries; remove a whole push; preview a screen. Not available to the Canva token.

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

Follows the riksunsrk deployment conventions (Docker image on GHCR, Traefik labels, no published host port, `/health`, bearer-gated `/metrics`, `traefik-public` + `shared_multi_network`).

- **Media**: behind one storage interface, `SIGNAGE_STORAGE=local|s3`. Production uses the shared S3 gateway (bucket from `add-app-storage.sh`); local disk for development.
- **State** (screens, playlists, push records): one JSON document per screen in the same storage, written atomically, versioned. Small enough that Postgres is not needed in step 1; the module boundary allows moving it to the shared Postgres later without API changes.
- Node 24 ESM, no build step. Dependencies kept to the Canva token verifier (the same `@canva/app-middleware` pin as pigateway) and the S3 client.
- Env: `SIGNAGE_BASE_URL`, `SIGNAGE_CANVA_APP_ID`, `SIGNAGE_CANVA_ALLOWED_BRANDS`, `SIGNAGE_PUSH_KEY`, `SIGNAGE_CORS_ORIGINS`, `SIGNAGE_DOWNLOAD_HOSTS`, `SIGNAGE_ADMIN_PASSWORD`, `SIGNAGE_STORAGE`, S3 settings, `METRICS_BEARER_TOKEN`, size limits.
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

The Canva app's CORS origin has to be allowed by both services (`SIGNAGE_CORS_ORIGINS` and pigateway's tunnel CORS list).

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
3. Video export from Canva: one MP4 per video page or one for the whole design; the canva-pieco-app plan answers this.
