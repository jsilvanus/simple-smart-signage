# Tunnus service discovery

Off by default. With `SISSI_DISCOVERY=1`, Sissi registers itself in the Tunnus service catalogue so that other apps (for example a companion app that pushes slides) can find its screens and web views without static configuration. Sign-in for the admin page and API is separate: see [tunnus-sign-in.md](tunnus-sign-in.md).

## What is registered

One Sissi instance registers two services, both under the Tunnus discovery API (`<issuer>/api/v1/discovery/services/{id}`):

| Service id | type | capabilities | auth | Contents |
|---|---|---|---|---|
| `<prefix>-signage` | `signage` | `screen_push`, `playlist_management`, `export_target` | `oidc` (`client_id`, `audience`) | One export target per screen (kind `screen`). `metadata.screens` lists the screen ids. |
| `<prefix>-views` | `webview` | `embed`, `export_target` | `none` | `metadata.views` (kinds `view` and `aggregate`, with frame, embed and playlist URLs). Export targets only for kind `view`: aggregates cannot receive pushes. |

`<prefix>` is `SISSI_DISCOVERY_SERVICE_ID_PREFIX` (default `sissi`). Lists are capped at 200 entries per service, and the metadata is kept under about 80 KB (Tunnus stores up to 100 KB). Names are cut to 100 characters.

Every service carries `endpoint_url` = the public base URL (`SISSI_BASE_URL` plus `SISSI_PUBLIC_PATH`).

## Lifecycle

- Registration starts in the background when the server starts. A Tunnus outage never delays or blocks Sissi. Failures are logged and retried with backoff from 10 s up to 60 s.
- A `401` or `403` from Tunnus stops all requests and is logged as an error. Fix the client id, secret or the client's permissions, then restart.
- The payload is checked every heartbeat interval, and after each screen create, update or delete. When it changed, that service is registered again (PUT overwrites it). Otherwise a heartbeat is sent.
- On `SIGTERM` or `SIGINT`, both services are deregistered (DELETE), with a 3 s bound, before the process exits.

Tunnus needs to allow self-registration for the client: the client's metadata must not contain `allow_discovery_registration: false`, and the client must not be disabled. Otherwise every PUT is refused with `403`.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `SISSI_DISCOVERY` | off | `1` enables registration. |
| `SISSI_TUNNUS_ISSUER` | — | Required. The Tunnus issuer URL. The discovery API is under it, so a path such as `/identity` is kept. |
| `SISSI_TUNNUS_AUDIENCE` | — | Required. Used as `auth.audience` on the signage service. |
| `SISSI_OIDC_CLIENT_ID` | `sissi` | Shared with the admin sign-in. |
| `SISSI_OIDC_CLIENT_SECRET` | — | Required. Basic auth for the discovery API. |
| `SISSI_DISCOVERY_VENUE` | `parish-wide` | Must match `^[a-z0-9_-]{1,32}$`. |
| `SISSI_DISCOVERY_SERVICE_ID_PREFIX` | `sissi` | Lowercase id prefix, at most 41 characters. |
| `SISSI_DISCOVERY_HEARTBEAT_SECONDS` | `60` | 5 to 3600. |

Problems with these are reported at startup. They are only checked when `SISSI_DISCOVERY=1`.

## Payload example

`PUT https://tunnus.example.org/identity/api/v1/discovery/services/sissi-signage` with `Authorization: Basic <base64 client_id:secret>`. The body has no `id`; it comes from the path.

```json
{
  "name": "Sissi signage screens",
  "type": "signage",
  "venue": "parish-wide",
  "endpoint_url": "https://signage.example.org/signage",
  "auth": { "type": "oidc", "client_id": "sissi", "audience": "https://signage.example.org" },
  "capabilities": ["screen_push", "playlist_management", "export_target"],
  "metadata": {
    "screens": ["hall"],
    "export_targets": [
      {
        "id": "hall",
        "name": "Hall",
        "category": "signage",
        "aspect_ratio": "16:9",
        "resolution": { "width": 1920, "height": 1080 },
        "formats": ["png", "jpeg", "mp4"],
        "multi_page": true,
        "ingest": { "path": "/api/v1/push", "method": "POST", "content_type": "application/json" },
        "body_defaults": { "screenId": "hall" }
      }
    ]
  },
  "disabled": false
}
```

`body_defaults` is a Sissi hint, not part of the Tunnus contract: a client that pushes to `ingest` should merge it into the request body, so the push goes to the right screen.

The views service:

```json
{
  "name": "Sissi web views",
  "type": "webview",
  "venue": "parish-wide",
  "endpoint_url": "https://signage.example.org/signage",
  "auth": { "type": "none" },
  "capabilities": ["embed", "export_target"],
  "metadata": {
    "views": [
      {
        "id": "news",
        "kind": "view",
        "name": "News",
        "frame_url": "https://signage.example.org/signage/v/news/frame",
        "embed_script_url": "https://signage.example.org/signage/v/news/embed.js",
        "playlist_url": "https://signage.example.org/signage/v/news/playlist.json"
      }
    ],
    "export_targets": [
      { "id": "news", "name": "News", "category": "signage", "aspect_ratio": "16:9",
        "resolution": { "width": 1920, "height": 1080 }, "formats": ["png", "jpeg", "mp4"],
        "multi_page": true,
        "ingest": { "path": "/api/v1/push", "method": "POST", "content_type": "application/json" },
        "body_defaults": { "screenId": "news" } }
    ]
  },
  "disabled": false
}
```

## Implementation

- `src/discovery/index.mjs` builds the payloads (pure) and runs the lifecycle. HTTP, retries and heartbeats come from the published client `@tunnus/discovery` (dependency in `package.json`, 0.1.0 at the time of writing). Each service has its own client; a changed payload replaces that client.
- `src/config.mjs` (`loadConfig`) gives `config.discovery`, or `null` when off.
- `src/start.mjs` starts the controller after `listen` and deregisters on shutdown. `src/api/admin.mjs` calls `refresh()` after screen create, update and delete.
