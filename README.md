# SiSSi — Simple Smart Signage

SiSSi is a centrally managed digital-signage system for televisions and other displays.

- **Server:** Next.js / TypeScript, with PostgreSQL planned.
- **Clients:** Android TV first; Samsung Tizen is a possible additional target.
- **Display:** Full-screen web apps (including Vite builds), with hosted-URL and packaged/offline modes planned.
- **Connectivity:** Outbound HTTPS, Server-Sent Events (SSE), and HTTPS heartbeats.
- **Enrollment:** Devices self-register but require administrator approval before receiving trusted access.
- **Reliability:** Local content cache, offline playback, and automatic reconnection.

## Step 1: Web signage service (quickstart)

Step 1 is a lightweight Node 24 ESM service that receives slide/video pushes from Canva, manages screen playlists via a built-in admin UI, and serves a full-screen offline-capable web player for Yodeck (and any browser).

### Local development

- **Runtime:** Node.js `>= 24`
- **Install & test:**
  ```bash
  npm ci
  npm test
  ```
- **Run locally:**
  ```bash
  cp .env.example .env
  # Edit .env (set SISSI_ADMIN_PASSWORD, SISSI_PUSH_KEY or Canva settings, etc.)
  npm start
  ```
  By default the service listens on `PORT=3000` with `SISSI_PUBLIC_PATH=/signage`:
  - Admin UI: `http://localhost:3000/signage/admin`
  - Player page: `http://localhost:3000/signage/s/<screenId>`
  - Push & Read API: `http://localhost:3000/signage/api/v1` (see [`openapi/sissi-v1.yaml`](openapi/sissi-v1.yaml))
  - Health & Metrics: `/health`, `/metrics`

### Key environment variables

See [`.env.example`](.env.example) for the complete list and defaults:

- `SISSI_BASE_URL`, `SISSI_PUBLIC_PATH` (default `/signage`)
- `SISSI_CANVA_APP_ID`, `SISSI_CANVA_ALLOWED_BRANDS`, `SISSI_CORS_ORIGINS`, `SISSI_DOWNLOAD_HOSTS`
- `SISSI_PUSH_KEY` (optional static Bearer token for scripts/curl)
- `SISSI_ADMIN_PASSWORD` (admin UI & `/api/v1/admin/*` session cookie)
- `METRICS_BEARER_TOKEN` (Bearer token for `GET /metrics`)
- `SISSI_STORAGE` (`local` or `s3`), `SISSI_LOCAL_DIR`, `SISSI_S3_*`
- `SISSI_SW_MAX_VIDEO_MB` (default `100` MB service-worker cache cap for videos)

### Docker & Traefik deployment

[`Dockerfile`](Dockerfile) builds `ghcr.io/jsilvanus/sissi` on `node:24-slim` (non-root `node` user, `/health` healthcheck). [`docker-compose.yml`](docker-compose.yml) runs the `sissi` container behind Traefik on `traefik-public` and `shared_multi_network` using a `Host(...) && PathPrefix(/signage)` rule with `stripprefix`.

> **Single-instance requirement:** Step 1 keeps per-screen mutation locks and the concurrent push limit (`SISSI_MAX_CONCURRENT_PUSHES=3`) in-process. Run **exactly one replica** (`deploy.replicas: 1` in `docker-compose.yml`).

For full deployment, admin, media, Yodeck verification, and monitoring instructions, see [`docs/operations.md`](docs/operations.md).

## Project docs

- [API contract (OpenAPI 3.0)](openapi/sissi-v1.yaml)
- [Operator guide](docs/operations.md)
- [Step 1 plan](docs/plans/step-1-web-signage.md)
- [Plan index](docs/plan.md)
- [Architecture planes and concepts](docs/architecture/planes-and-concepts.md)
- [Device handshake and enrollment](docs/handshake.md)
- [Display runtime and camera capabilities](docs/display-runtime.md)
- [Decision register](docs/decisions/README.md)

## Licence

Licensed under the European Union Public Licence 1.2 (EUPL-1.2). See [LICENSE](LICENSE).
