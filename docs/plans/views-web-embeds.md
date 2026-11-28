# Views: Sissi content for web pages

Status: section 7 items 1-2 built on branch claude/sissi-views-web (data model, text fields, aggregates, public routes, carousel/single/gallery renderer, tests). Not built: scoped rights and the read-only rights panel (section 5), the admin snippet panel (item 4), Canva (item 5). Date: 2026-11-24. Requested by Juha.
Deployment (VPS, Traefik, Tunnus client setup) belongs to the "Seurakunnan appit" project and is out of scope here.
Responsive image size variants for views are planned separately in [`views-image-variants.md`](views-image-variants.md).

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

## 3. Items: text fields and embed types (renderers)

Every entry (screen and view) carries, next to its image or video:
- `alt`: alternative text with everything the image says (accessibility, required for views).
- `title`: rendered on the image by the embed (large).
- `text`: smaller text below it.
- `link`: optional URL (https only); the slide or card is clickable.

All four are optional on screens (players ignore title/text/link unless a layout uses them) and `alt` defaults to the Canva page title. Text is escaped plain text, never HTML. Push body and `PATCH .../entries/:id` accept the four fields.

### Renderers

A view has one `embed.type`, chosen in the admin page; the renderer is a small module shared by `frame` and `embed.js`.

| Type | Behaviour | v1 |
|---|---|---|
| `carousel` | Slides in order. User-browseable (round arrow buttons, dots, swipe). Optional autoplay (`embed.options.autoplay`, entry seconds, pauses on hover/focus, respects `prefers-reduced-motion`). | yes |
| `single` | Rotates through the enabled entries automatically (entry seconds, videos advance when they end), with no buttons, dots or swipe. | yes |
| `gallery` | Grid of thumbnails, click opens a larger view. | yes |
| `cards` | Entries with title and text (needs a text entry kind). | later |
| `list` | News-like list, newest first. | later |

Options per type (aspect ratio, fit contain/cover, show dots, fit to content, alt text source) live in `embed.options`. Entry `alt` text becomes a field on push (Canva page title is the default) so embeds are accessible.

## 4. Data model and API

Screen record gains:

```
kind: "screen" | "view" | "aggregate"
embed: { type, options, allowedOrigins[] }   // views and aggregates
members: [viewId, ...]                        // aggregates only
```

- Access (decided by Juha 2026-11-24): views are **public**; embedding sites are limited by `allowedOrigins`, set per view (CSP `frame-ancestors`, CORS). No token: the page source is visible anyway.
- `POST /api/v1/push` takes `screenId` for any kind (shared id namespace). Pushing to an aggregate is refused (422).
- `GET /api/v1/screens?kind=` lists targets with `kind` and the caller's `rights`.
- Admin: create/rename/delete view, edit `embed`, members and rights (see section 5). Power routes reject views.

### Aggregated views

An aggregate is a view whose content is the automatic join of other views. It holds **no own entries** (no PNG/MP4/text items), only `members`, in order.
- `playlist.json` of an aggregate is computed on read: the enabled entries of each member, in member order (option `interleave` later), each tagged with `sourceView`. Member changes show up on the next poll; there is no copy.
- Members must be plain views (no nesting in v1, which avoids cycles). Deleting a member removes it from aggregates.
- Rights: reading an aggregate is public like any view. Managing members needs write on the aggregate; adding a view as a member needs read on that view. Entry edits go to the member view, with the rights of that view.
- Uses the same renderers (carousel, gallery...).

## 5. Rights per screen and per view

Today rights are global: `sissi:read|write|operate` from Tunnus groups. Needed: write on one view without operate on it, different people for different screens and views.

Rights scheme (colon/at form, as Juha prefers):

```
sissi:read | sissi:write | sissi:operate            all screens and views (today)
sissi:write@aikuistyo                               one screen/view/aggregate
sissi:write@view:*   sissi:operate@screen:*         all of one kind
sissi:write@*                                       all
```

Write and operate stay independent. Admin setup stays password-only.

**Rights live in Tunnus only** (Juha 2026-11-24). Sissi keeps no group-to-rights mapping of its own for scoped rights. Tunnus puts scoped keys such as `sissi:write@aikuistyo` in the token (`groups` claim or scopes, whatever Tunnus uses), and Sissi reads them. Tunnus is being extended (separate Haiku thread, riksunsrk/infra) to accept `:`, `@` and `*` in keys. The old env mapping `SISSI_TUNNUS_GROUP_RIGHTS` keeps working for the global rights it handles today; scoped rights come only from the token. Fallback spelling if Tunnus ends up alphanumeric-only: `sissi-write-aikuistyo`; the parser accepts both and normalises.

**Rights panel (read-only)** on each screen, view and aggregate: shows its id and the ready-to-copy keys to create in Tunnus (`sissi:read@<id>`, `sissi:write@<id>`, `sissi:operate@<id>`), plus the kind-wide forms (`@view:*`). It edits nothing. A list of all ids and keys is also at `GET /api/v1/admin/rights-keys` (admin only) for copy and paste. No push to Tunnus (see below), so admins create the keys and assign people in Tunnus.

`GET /api/v1/screens` returns only targets where the caller has at least read, with `rights` (`["write"]` or `["write","operate"]`) so Canva can show the symbol and disable "enable right away" without operate. Tests: scope parsing in all three forms, matrix level x scope x route x kind, aggregate rules.

## 6. Canva app

Targets, in this order (labels only; saved settings keep working through stable ids, with one merge noted below):

1. **Keskuskirkko (piprogram)**: one target for both vertical and landscape (piprogram handles the images itself, so the user need not choose). Merges `piprogram-vertical-projector` and the landscape use; the export size is whatever piprogram's contract wants (to check in the thread that builds it; the old ids are mapped to the new one).
2. **Keskuskirkko (ATEM)**: the PiGraphics target (`pigraphics-stream`). Adds a dropdown to choose the animation, the DVE ("none" default). The list is practically fixed: PiGraphics sends it to pigateway at startup, or when pigateway asks for it; pigateway serves it to the Canva plugin (`GET` on the existing `/api/v1/canva/*` side). Canva never talks to PiGraphics directly.
3. **Infonäytöt (Sissi)**: lists the screens the user has rights to, each with a symbol for write or operate. Existing form (name, seconds, enable now; enable only with operate).
4. **Verkkosivut (Sissi)**: lists the views the user may send to (aggregates not listed, since they take no items). Form: name, `alt`, `title`, `text`, `link`, seconds, and "enable right away" (needs operate; otherwise the item arrives disabled). Export PNG/MP4 sized from the view's aspect ratio.

The old `piprogram-atem` target is dropped (Juha 2026-11-24: it was not really used, since the library does not verify the target). Saved settings that name it are mapped to Keskuskirkko (piprogram). Tunnus sign-in in the app is PR #24. i18n fi/en/sv.

### Pushing rights from Sissi into Tunnus

Question from Juha: can Sissi write the rights it holds into Tunnus, as Tunnus rights already reach Sissi?

Assessment (Tunnus' management API was not read; this is from the design, to be checked in the Tunnus thread):
- The other direction is cheap because it is only token verification: Sissi holds no credential for Tunnus. The reverse needs Sissi to **hold a credential that can change the identity provider** (create groups, edit memberships). A bug or leak in a public-facing signage service would then be able to grant rights across the parish, including to Pi modules. That is the main reason not to do it.
- Sissi can only know group names and what they may do; assigning people to groups is Tunnus' job and stays there.
- What can be done safely, in steps:
  1. **v1: no push.** Single place per source: Tunnus holds who is in which group, Sissi holds what each group may do on each screen/view (admin only). The rights panel shows a ready-to-copy list of group names that the mapping uses, so an admin can create them in Tunnus.
  2. **Later, if wanted:** a narrow, separate Tunnus client for Sissi that may only create/delete groups whose names start with `sissi-` (or `sissi:`) and assign no memberships. Needs Tunnus to support such a restricted client; decide after the Tunnus thread shows what its API can do.
  3. **Not planned:** Sissi editing memberships or non-Sissi groups.
- Decided: rights management is entirely in Tunnus; step 1 only (read-only panel with copyable keys). Steps 2-3 are not planned.

## 7. Build tasks (after Juha's go)

Order (Juha: piprogram, Canva and Sissi items first). Haiku-sized unless marked.

1. Sissi: `kind`, `embed`, `members`, entry text fields in state; view/aggregate admin CRUD.
2. Sissi: `playlist.json`, `frame`, `embed.js`, carousel and single; aggregate join; CSP/CORS from `allowedOrigins`.
3. Sissi: scoped rights parser, route checks, read-only rights panel and `rights-keys` list, `rights` in the screen list.
4. Sissi: gallery renderer, admin snippet panel.
5. Canva: new targets, DVE dropdown, screen/view pickers with rights symbols, text and link fields.
6. riksunsrk/infra: Tunnus accepts `:` `@` `*` in group names (only if option 2 is chosen; Juha's go first).
7. Docs: `docs/tunnus-sign-in.md`, OpenAPI, README.

Tasks 1-3 and 5 are separate cheap threads. Nothing needs a Pi or the VPS; the church web page snippet is pasted by whoever edits the site.

## 8. Decided and still open

Built so far (2026-11-24): `src/views/embed.mjs` (validation, aggregate join, CSP/CORS), `src/views/runtime.js` (shared browser renderer; DOM and textContent only), `src/api/views.mjs` (the three public routes), `kind`/`embed`/`members`/text fields in `src/state`, `test/views/`. Checked in headless Chromium: the frame page shows the carousel, and the script embed mounts in a shadow root from a same-origin page. A cross-origin script embed was not checked, because this Chromium blocks public-to-loopback requests.


Decided (Juha 2026-11-24): public views with per-view origins; text fields alt/title/text/link; aggregates; old `piprogram-atem` dropped; DVE list from PiGraphics via pigateway; rights managed entirely in Tunnus, Sissi's rights panel is read-only (ids and copyable keys); Tunnus gets `:`/`@` (separate Haiku thread in riksunsrk/infra), so `sissi:write@id` is the main form.

Still open: what piprogram's single landscape+vertical target exports (size handling is piprogram's; the build thread checks its contract).
