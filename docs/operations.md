# SiSSi Step 1 — Operator Guide

This guide covers deploying, administering, and verifying the Step 1 web signage service (`sissi`).

Site-specific secrets, hostnames (`SISSI_HOST`), and Canva brand/team IDs live in the private deployment repository and GitHub environment secrets — never commit them to this repository.

---

## 1. Deployment on the church VPS

### Image and Compose

- **Image:** `ghcr.io/jsilvanus/sissi:${SISSI_IMAGE_TAG:-latest}` (built and pushed by [`.github/workflows/release.yml`](../.github/workflows/release.yml) on `main` and `v*` tags after `npm test` passes).
- **Container / service name:** `sissi` (non-root `node` user, port `3000`, no published host ports).
- **Compose file:** [`docker-compose.yml`](../docker-compose.yml) attaches `sissi` to external networks `traefik-public` and `shared_multi_network`, plus `default`.

### Single-replica requirement

`docker-compose.yml` sets `deploy.replicas: 1`. **Do not scale `sissi` above 1 replica.**

- Per-screen playlist mutation locks and the concurrent push limit (`SISSI_MAX_CONCURRENT_PUSHES`, default `3`) are in-process.
- State JSON writes use compare-and-swap (`ifMatch` ETags), so an accidental second instance will fail loudly with `BUSY` rather than silently corrupting playlists, but Step 1 is designed for a single container.

### Traefik `/signage` route

Traefik routes `https://<host>/signage/*` to the container on port `3000` and strips the `/signage` prefix before forwarding:

- Rule: ``Host(`${SISSI_HOST}`) && PathPrefix(`${SISSI_PUBLIC_PATH:-/signage}`)``
- Entrypoint & TLS: `websecure`, `tls.certresolver=letsencrypt`
- Middleware: `sissi-stripprefix` (`stripprefix.prefixes=${SISSI_PUBLIC_PATH:-/signage}`)

Because Traefik strips `SISSI_PUBLIC_PATH`, the service registers routes without the prefix while using `SISSI_PUBLIC_PATH` (default `/signage`) to build root-relative `Location` headers, media URLs in `playlist.json`, and `<base href>` in the admin UI.

### Environment variables (`SISSI_*` and ops)

All supported variables are listed in [`.env.example`](../.env.example). Key production settings:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Must be `production` in Compose (`SISSI_ALLOW_PRIVATE_DOWNLOADS=1` is refused in production). |
| `SISSI_BASE_URL` | Public base URL including prefix, e.g. `https://example.org/signage`. |
| `SISSI_PUBLIC_PATH` | Path prefix served by Traefik (default `/signage`; empty or `/` for root). |
| `SISSI_CANVA_APP_ID` | Canva app ID used as JWT `aud` when verifying Canva user tokens via Canva JWKS. |
| `SISSI_CANVA_ALLOWED_BRANDS` | Comma-separated allow-list of Canva `brandId` values. Tokens from other brands fail with `403 TEAM_NOT_ALLOWED`. |
| `SISSI_CORS_ORIGINS` | Comma-separated bare origins (e.g. `https://app-xxxx.canva-apps.com`) allowed to call `/api/v1/*` from the Canva app. Disallowed preflights return `403`. |
| `SISSI_DOWNLOAD_HOSTS` | Comma-separated allowed export download host suffixes (default `canva.com,canva.dev,canva-apps.com`). |
| `SISSI_PUSH_KEY` | Optional static Bearer token for curl/scripted pushes. Leave unset if only Canva tokens should be accepted. |
| `SISSI_ADMIN_PASSWORD` | Password for `/signage/admin` and `/api/v1/admin/*`. Required for admin access (`503 AUTH_NOT_CONFIGURED` if unset). |
| `SISSI_AUTH_MODE` | `legacy` (default: push key, Canva token, admin password), `both` (Tunnus sign-in next to them) or `tunnus` (Tunnus only; push key, Canva token and password are refused). See [tunnus-sign-in.md](tunnus-sign-in.md). |
| `SISSI_TUNNUS_ISSUER`, `SISSI_TUNNUS_AUDIENCE`, `SISSI_TUNNUS_GROUP_RIGHTS`, `SISSI_TUNNUS_JWKS_URL` | Required when the mode is not `legacy` (JWKS URL optional, discovered otherwise). |
| `METRICS_BEARER_TOKEN` | Bearer token required for `GET /metrics` (`503 AUTH_NOT_CONFIGURED` if unset). |

### S3 storage

Production uses the shared S3 gateway (bucket provisioned via `add-app-storage.sh`):

```env
SISSI_STORAGE=s3
SISSI_S3_ENDPOINT=https://<s3-gateway-host>
SISSI_S3_REGION=us-east-1
SISSI_S3_BUCKET=<bucket-name>
SISSI_S3_ACCESS_KEY_ID=<key-id>
SISSI_S3_SECRET_ACCESS_KEY=<secret>
SISSI_S3_FORCE_PATH_STYLE=1
SISSI_S3_PREFIX=
```

Both content-addressed media (`media/<sha256>.<ext>`) and JSON state documents (`state/screens/<id>.json`, `state/pushes/<pushId>.json`) are stored in this bucket. Conditional writes (`If-Match` / `If-None-Match`) protect state updates.

---

## 2. Admin usage (`/signage/admin`)

Open `https://<host>/signage/admin` in a browser and sign in with `SISSI_ADMIN_PASSWORD`.

- **Auth & security:** Login sets an `HttpOnly`, `SameSite=Strict` (`Secure` in production) `sissi_admin` cookie scoped to `SISSI_PUBLIC_PATH` (12-hour lifetime). Failed logins are rate-limited to 5 attempts per IP per 10 minutes (`429 RATE_LIMITED`). All write requests require the `X-Sissi-Admin: 1` header (sent automatically by the admin UI). Canva/push Bearer tokens are never accepted on `/api/v1/admin/*`.
- **Creating & editing screens:**
  - `id`: lowercase slug matching `^[a-z0-9-]{1,40}$` (e.g. `lobby`, `outdoor-east`), set on creation.
  - `name`: display name (1–100 chars) shown in the Canva app screen picker.
  - `orientation`: `landscape` or `portrait`.
  - `width` / `height`: optional export size hints for Canva.
  - `defaultImageSeconds`: default slide duration in seconds (`1`–`3600`, default `10`).
  - `maxVideoSeconds`: optional maximum video duration in seconds (`null` = no limit).
- **Managing playlists, entries, and pushes:**
  - Reorder entries up/down (increments `playlistVersion`; active players switch at the next slide boundary).
  - Edit per-image display duration (`1`–`3600` seconds). Video durations are read-only from the MP4 header.
  - Delete a single entry or remove an entire push (`pushId`) as a unit.
  - Click **Preview** to open `/signage/s/<screenId>` in a new tab.
  - Unreferenced media objects are deleted automatically by the background GC sweep once they are older than `SISSI_GC_GRACE_MINUTES` (default `60`).

---

## 3. Media requirements

- **Images:** PNG, JPEG, or WebP, up to `SISSI_MAX_IMAGE_MB` (default `40` MB).
- **Videos:** MP4 container (`isom`/`mp42`/`avc1`-compatible) with readable `mvhd` (or fragmented `mvex`/`mehd`) duration, up to `SISSI_MAX_VIDEO_MB` (default `500` MB) per file and `SISSI_MAX_PUSH_MB` (default `1024` MB) per push.
  - **Codec requirement:** **H.264 video + AAC audio** is expected by Yodeck players. Step 1 does not transcode or inspect codecs; non-H.264 MP4s may fail to decode on Yodeck hardware.
  - **`maxVideoSeconds`:** If set on a screen, any pushed video whose duration exceeds `maxVideoSeconds` fails the entire push with `VIDEO_TOO_LONG` without modifying the screen's current playlist.
  - **Offline video caching (`SISSI_SW_MAX_VIDEO_MB`):** Default `100` MB. The player service worker caches images and videos smaller than `SISSI_SW_MAX_VIDEO_MB`, answering `Range` requests (`206 Partial Content`) from the cached `ArrayBuffer` when offline. Videos at or above this threshold stream from the network while online and are skipped cleanly (without stalling) when offline.

---

## 4. Yodeck Web Page player setup & first-deploy verification

### Yodeck setup

1. Create the screen in `/signage/admin` (e.g. `lobby`).
2. In Yodeck, create a **Web Page** media item with URL:
   ```text
   https://<host>/signage/s/lobby
   ```
3. Assign the Web Page item full-screen to the target Yodeck player/layout.

### First-deploy verification procedure (open item 2)

The Step 1 plan flags one open operational question: **whether Yodeck's Web Page player preserves the Service Worker registration and Cache Storage across player reboots.** Verify this on a real Yodeck player during the first deploy:

1. **Seed a test screen:** Create a screen (e.g. `test-lobby`) and push 2 images and 1 short H.264/AAC MP4 smaller than `SISSI_SW_MAX_VIDEO_MB`.
2. **Initial load:** Point the Yodeck Web Page item to `https://<host>/signage/s/test-lobby` and let it play through at least one full loop so the service worker (`/signage/s/sw.js`) activates and caches the player shell, `playlist.json`, and all media.
3. **Online reboot check:** Reboot the Yodeck player with network connected. Confirm it resumes full-screen playback with smooth 0.5 s cross-fades and video `ended` transitions, and no error text.
4. **Mid-session offline check:** Disconnect the player's network (or temporarily block access to `/signage`) while the playlist is running. Confirm the player keeps looping both images and the cached video indefinitely.
5. **Offline-across-reboot check:** With the network still disconnected, reboot the Yodeck player and observe:
   - **If Service Worker cache persists across reboots:** The player boots directly from the cached shell and loops the `localStorage` + Cache Storage playlist offline until connectivity returns.
   - **If Service Worker cache is cleared on reboot:** The Web Page will fail to load while offline on cold boot and will recover automatically once network connectivity returns. Record the Yodeck player model/firmware result so operators know whether cold-boot offline playback is supported or offline resilience applies only to mid-session outages.

---

## 5. Health and Prometheus metrics

### `GET /health`

- Unauthenticated (`200 OK`, `{"ok":true}`).
- Works with or without the `SISSI_PUBLIC_PATH` prefix.
- Used by Docker `HEALTHCHECK` (`http://127.0.0.1:3000/health`) and Traefik.

### `GET /metrics`

- Returns Prometheus text format (`text/plain; version=0.0.4; charset=utf-8`).
- Requires `Authorization: Bearer <METRICS_BEARER_TOKEN>` (`401 UNAUTHORIZED` if missing/wrong; `503 AUTH_NOT_CONFIGURED` if `METRICS_BEARER_TOKEN` is unset).
- Exported metrics:
  - `sissi_http_requests_total{method,route,status}` (counter)
  - `sissi_http_request_seconds_total{route}` (counter)
