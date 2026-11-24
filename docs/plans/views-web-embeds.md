# Views: Sissi content for web pages

Status: plan, nothing built. Date: 2026-11-24. Requested by Juha.
Deployment (VPS, Traefik, Tunnus client setup) belongs to the "Seurakunnan appit" project and is out of scope here.

## 1. Idea

A **view** is a screen for a web page. A screen is played by a player on a TV; a view is played by a small embed on a web page (for example the church website's "Aikuistyö" page). The content model is the same: a view has a playlist of entries (images, videos, later text cards) with seconds, enabled/disabled, push modes `append`/`replace`. The Canva app pushes to a view exactly as it pushes to a screen, so the web page updates without anyone editing the page.

Reuse, do not fork: a view is a row in the same state store as a screen with `kind: "view"` and an `embed` block instead of power/orientation settings. Push, entry edit, enable/disable, thumbnails and storage code stay shared.

## 2. Embed delivery

Each view has a public, read-only address (no secret; a view shows only what is enabled and is meant to be public):

| Address | Use |
|---|---|
| `/v/<viewId>/playlist.json` | Data: enabled entries, seconds, media URLs, `version`. Cacheable, `ETag`. |
| `/v/<viewId>/frame` | Ready page for an `<iframe>`. Renders the view with its embed type. |
| `/v/<viewId>/embed.js` | `<script>` embed: finds `<div data-sissi-view="aikuistyo">` (or injects after itself), renders into a shadow root, so site CSS cannot break it. |

Copy-paste snippets are shown on the admin page per view. Iframe is the safe default; script is for sites that want the content to flow with the page.

Security:
- `playlist.json` and media are public by design. Disabled entries never appear.
- `frame` sends `Content-Security-Policy: frame-ancestors <view.allowedOrigins>` (per-view list, default: none, so a view must be configured before it can be embedded). `embed.js` and JSON send CORS for the same origins.
- No scripts from content; only images, video and escaped text are rendered.
- Polling: JSON re-fetched every 60 s with `If-None-Match`; no websockets in v1.

## 3. Embed types (renderers)

A view has one `embed.type`, chosen in the admin page; the renderer is a small module shared by `frame` and `embed.js`.

| Type | Behaviour | v1 |
|---|---|---|
| `carousel` | Slides in order, entry seconds, arrows and dots, swipe, pauses on hover/focus, respects `prefers-reduced-motion` (then no autoplay). | yes |
| `single` | Shows the first enabled entry only (a banner or "this week's poster"). | yes |
| `gallery` | Grid of thumbnails, click opens a larger view. | yes |
| `cards` | Entries with title and text (needs a text entry kind). | later |
| `list` | News-like list, newest first. | later |

Options per type (aspect ratio, fit contain/cover, show dots, alt text source) live in `embed.options`. Entry `alt` text becomes a field on push (Canva page title is the default) so embeds are accessible.

## 4. Data model and API

Screen record gains:

```
kind: "screen" | "view"          // default "screen"
embed: { type, options, allowedOrigins[] }   // views only
```

Routes (all exist for screens already, views reuse them):
- `POST /api/v1/push` takes `screenId` for either kind (id namespace is shared, so no clash); `mode`, `enabled` unchanged.
- `GET /api/v1/screens` gets `?kind=view|screen` and returns `kind`; the Canva app lists screens and views separately.
- Admin: create/rename/delete view, edit `embed` (password or `sissi:admin`, see below). Power routes reject views.

## 5. Rights per screen and per view

Today rights are global: `sissi:read|write|operate` from Tunnus groups. Needed: write on one view without operate on it, different people for different views and screens.

Proposal: keep the three levels, add an optional **scope** to the group mapping:

```
SISSI_TUNNUS_GROUP_RIGHTS=
  parish=sissi:read;
  aikuistyo=sissi:write@aikuistyo,sissi:operate@aikuistyo;
  toimisto=sissi:write@*,sissi:operate@screen:*;
  kanslia=sissi:write@view:*
```

- A right without `@` means every screen and view (today's behaviour, so existing config keeps working).
- `@<id>` is one screen or view; `@screen:*` / `@view:*` all of that kind; `@*` all.
- Checks happen on the target id of the request (push body `screenId`, entry routes, push routes) in addition to the existing level checks: write and operate stay independent, operate on an id never implies write on it.
- `GET /api/v1/screens` returns only targets where the caller has at least read-level on that id, plus a `rights` list per target (`["write"]`, `["write","operate"]`) so the Canva app can disable "Show now" where the user may only submit drafts.
- Screen/view **setup** (create, delete, embed settings, power) stays password-only, as now. A scoped `sissi:admin@id` is not proposed.
- Group names stay in the private deploy repo. Tests: unit tests for scope parsing and the matrix level x scope x route.

## 6. Canva app

Current targets (`src/intents/publish-targets.mjs`): PiProgram to ATEM, PiProgram to vertical projector, PiGraphics stream, Saarnavideo (disabled), Signage (Sissi). New first export format list, in this order:

1. **Keskuskirkko (piprogram)**: the piprogram projector feed (today `piprogram-vertical-projector`).
2. **Keskuskirkko (ATEM)**: today `piprogram-atem`.
3. **Infonäytöt (Sissi)**: Sissi targets of kind `screen` (today `signage`).
4. **Verkkosivut (Sissi)**: Sissi targets of kind `view`; same publish form (name, seconds, enable now), the picker lists views from `GET /api/v1/screens?kind=view`; export is PNG/MP4 sized from the view's aspect ratio.

Target ids stay stable (labels only change), so saved publish settings keep working. i18n: the labels need fi/en/sv, with fi as shown above. Rights from section 5 drive which screens/views are listed and whether "enable now" is available. Tunnus sign-in in the app is PR #24.

## 7. Build tasks (after Juha's go)

1. Sissi: `kind` and `embed` in state, view admin CRUD, validation (Haiku-sized).
2. Sissi: `playlist.json`, `frame`, `embed.js` with carousel and single; CSP/CORS from `allowedOrigins`.
3. Sissi: scoped rights parser, route checks, `rights` in the screen list, tests.
4. Sissi: gallery renderer, admin snippet panel.
5. Canva: new target labels and view targets, list views, honour `rights`.
6. Docs: `docs/tunnus-sign-in.md`, API/OpenAPI, README.

Tasks 1-3 and 5 are independent enough to run as separate cheap threads. Nothing needs a Pi or the VPS; the church web page snippet is pasted by whoever edits the site.

## 8. Open decisions

See the thread summary: scope syntax, public vs token-protected embeds, which target the label "Keskuskirkko (piprogram)" replaces, and v1 embed types.
