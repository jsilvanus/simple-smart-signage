# Tunnus sign-in

Status: built and unit-tested with a fake provider; never run against a real Tunnus. Off by default. Plan: the Tunnus plan in the piecosystem repo (`docs/plans/tunnus-sign-in-plan.md`).

The Canva app signs in once with Tunnus (one client, a fixed audience list). Its access token reaches Sissi directly, because Sissi content goes from Canva to the server, not through pigateway. Sissi verifies the token itself.

## What Sissi checks

1. RS256 signature against the issuer's JWKS (discovered from `<issuer>/.well-known/openid-configuration`, or `SISSI_TUNNUS_JWKS_URL`). Keys are cached; an unknown `kid` refreshes at most every 30 s. Sissi starts and serves without Tunnus being reachable; sign-in just fails until it is.
2. `iss` equals `SISSI_TUNNUS_ISSUER`.
3. `aud` (string or array) contains `SISSI_TUNNUS_AUDIENCE`. Sissi's own name must be in the list; being in the Pi gateway's audience is not enough.
4. `exp` / `nbf` (30 s leeway), `sub` present.
5. Rights come **only** from the `groups` claim through `SISSI_TUNNUS_GROUP_RIGHTS`. A person with no mapped group gets `403 FORBIDDEN`.

## Rights

| Right | Allows |
|---|---|
| `sissi:read` | Read only: `GET /api/v1/screens`, `GET /api/v1/push/:id` (push status) and the admin screen list. Write and operate also satisfy these reads. |
| `sissi:write` | Publish content: `POST /api/v1/push` with `enabled: false` (the default), reorder entries, change an entry's seconds, remove **disabled** entries and pushes. |
| `sissi:operate` | Make content live: push with `enabled: true` or `mode: replace` (these also need `sissi:write`, because they publish content), enable or disable an entry or a push, remove **live** entries and pushes. |

The two are independent: `operate` does not imply `write`. `GET /api/v1/screens`, the push status and the admin screen list need either one. Screen setup (create, rename, delete, power) stays on the admin password and never accepts a Tunnus token. The `/admin` page signs in with the password, or with Tunnus: `GET /admin/login` runs OIDC authorization code + PKCE against the issuer, and `GET /admin/callback` verifies the access token like an API token and sets a signed session cookie (12 h). The browser session has the same `sissi:*` rights as an API token, but setup routes (screens, power) stay password-only. Needs `SISSI_OIDC_CLIENT_SECRET` (the `sissi` confidential client, redirect `<origin><SISSI_PUBLIC_PATH>/admin/callback`); `SISSI_OIDC_CLIENT_ID` defaults to `sissi`.

## Configuration

```
SISSI_AUTH_MODE=legacy|both|tunnus     # default legacy: nothing below is read
SISSI_TUNNUS_ISSUER=<issuer URL>
SISSI_TUNNUS_AUDIENCE=<the resource URI the Canva client requests for Sissi>
SISSI_TUNNUS_GROUP_RIGHTS=<group>=sissi:read;<group2>=sissi:write,sissi:operate
SISSI_TUNNUS_JWKS_URL=                 # optional
SISSI_TUNNUS_LEEWAY_SECONDS=30
```

Only `sissi:read`, `sissi:write` and `sissi:operate` are ever granted. Wildcards (`*`), Pi modules and presets such as `@operator` in this value are ignored, so a mapping written for the Pi gateway can not give a Sissi right; a mapping that grants nothing is a startup error. Real group names belong in the private deploy repo, not here.

Modes: `legacy` is today's behaviour. `both` accepts Tunnus tokens next to the push key, the Canva token and the admin password (use while rolling out). `tunnus` refuses the push key, Canva tokens and the password.

## Public URL

Compose routes ``Host(`${SISSI_HOST}`) && PathPrefix(`${SISSI_PUBLIC_PATH:-/signage}`)``; the default path is **`/signage`**, not `/sissi`. So the URL is `https://<SISSI_HOST>/signage` unless the deploy sets `SISSI_PUBLIC_PATH`. `SISSI_TUNNUS_AUDIENCE` must equal what Tunnus puts in `aud` for Sissi (the `allowed_resources` entry), which need not be the URL but conventionally is.

## Service discovery

Sissi can also register its screens and web views in the Tunnus service catalogue (`SISSI_DISCOVERY=1`). See [tunnus-discovery.md](tunnus-discovery.md).
