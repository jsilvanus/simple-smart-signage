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
| `carousel` | Slides in order, entry seconds, arrows and dots, swipe, pauses on hover/focus, respects `prefers-reduced-motion` (then no autoplay). | yes |
| `single` | Shows the first enabled entry only (a banner or "this week's poster"). | yes |
| `gallery` | Grid of thumbnails, click opens a larger view. | yes |
| `cards` | Entries with title and text (needs a text entry kind). | later |
| `list` | News-like list, newest first. | later |

Options per type (aspect ratio, fit contain/cover, show dots, alt text source) live in `embed.options`. Entry `alt` text becomes a field on push (Canva page title is the default) so embeds are accessible.

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

**Tunnus compatibility.** Tunnus currently accepts neither `:` nor probably `@` in the strings it manages, and the `groups` claim is what Sissi maps today (`SISSI_TUNNUS_GROUP_RIGHTS` maps group to right, so Tunnus itself only holds plain group names). Two ways, both supported by the plan:
1. **Preferred, no Tunnus change:** Tunnus keeps plain group names such as `sissi-aikuistyo-write`; Sissi maps them to scoped rights. Mapping lives in Sissi, in env and in the rights UI below.
2. **Extend Tunnus** (riksunsrk/infra) to accept `:`, `@`, `*`, `.` in group/scope names, so a Tunnus group can literally be `sissi:write@aikuistyo`; Sissi would then also accept a group that already is a right. Needs a change in Tunnus validation and a check of what its UI/OIDC claim encoding does with these characters. This is a separate thread in riksunsrk/infra and needs Juha's go (outside this repo).
A third fallback syntax, if Tunnus only takes alphanumerics, `-` and `_`: `sissi-write-aikuistyo`, `sissi-operate-screen-all`. The parser accepts all three forms and normalises internally.

**Rights UI** (admin page, on each screen, view and aggregate): a small panel "Who can do what" listing the Tunnus groups with a right on this target as rows (group, write, operate checkboxes), plus add/remove group. It edits the Sissi-side mapping stored in state (not env), so it is manageable without redeploy; env mapping stays as the global base. Only the admin password may edit it (a person with write rights cannot grant themselves more). Shows the effective result for a given group name.

`GET /api/v1/screens` returns only targets where the caller has at least read, with `rights` (`["write"]` or `["write","operate"]`) so Canva can show the symbol and disable "enable right away" without operate. Tests: scope parsing in all three forms, matrix level x scope x route x kind, aggregate rules.

## 6. Canva app

Targets, in this order (labels only; saved settings keep working through stable ids, with one merge noted below):

1. **Keskuskirkko (piprogram)**: one target for both vertical and landscape (piprogram handles the images itself, so the user need not choose). Merges `piprogram-vertical-projector` and the landscape use; the export size is whatever piprogram's contract wants (to check in the thread that builds it; the old ids are mapped to the new one).
2. **Keskuskirkko (ATEM)**: the PiGraphics target (`pigraphics-stream`). Adds a dropdown to choose the animation, the DVE (list from the PiGraphics/pigateway API, "none" default).
3. **Infonäytöt (Sissi)**: lists the screens the user has rights to, each with a symbol for write or operate. Existing form (name, seconds, enable now; enable only with operate).
4. **Verkkosivut (Sissi)**: lists the views the user may send to (aggregates not listed, since they take no items). Form: name, `alt`, `title`, `text`, `link`, seconds, and "enable right away" (needs operate; otherwise the item arrives disabled). Export PNG/MP4 sized from the view's aspect ratio.

`piprogram-atem` (the old "PiProgram to ATEM") goes away as a separate choice; if it is still needed it is one question for Juha (see section 8). Tunnus sign-in in the app is PR #24. i18n fi/en/sv.

## 7. Build tasks (after Juha's go)

1. Sissi: `kind`, `embed`, `members`, entry text fields in state; view/aggregate admin CRUD.
2. Sissi: `playlist.json`, `frame`, `embed.js`, carousel and single; aggregate join; CSP/CORS from `allowedOrigins`.
3. Sissi: scoped rights parser (three forms), route checks, state-stored mapping, rights panel, `rights` in the screen list.
4. Sissi: gallery renderer, admin snippet panel.
5. Canva: new targets, DVE dropdown, screen/view pickers with rights symbols, text and link fields.
6. riksunsrk/infra: Tunnus accepts `:` `@` `*` in group names (only if option 2 is chosen; Juha's go first).
7. Docs: `docs/tunnus-sign-in.md`, OpenAPI, README.

Tasks 1-3 and 5 are separate cheap threads. Nothing needs a Pi or the VPS; the church web page snippet is pasted by whoever edits the site.

## 8. Open questions

- Tunnus: option 1 (plain group names, mapping in Sissi) or option 2 (extend Tunnus)? Plan builds the parser for both.
- Does `piprogram-atem` (PiProgram to ATEM) stay anywhere, now that "Keskuskirkko (ATEM)" is PiGraphics?
- Where does the list of DVE animations come from (PiGraphics API?), and what does the dropdown send?
- Rights UI edits a mapping stored in Sissi state; OK that only the admin password can edit it?
