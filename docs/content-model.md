# Content and playback model

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Playlist-first programming, with reusable scenes and independent timing/availability rules.

## Core hierarchy

```text
Display assignment / schedule
└── Playlist
    ├── Playlist item ──> Scene revision
    ├── Playlist item ──> Scene revision
    └── Playlist item ──> Scene revision
                             ├── HTML / CSS / JavaScript presentation
                             ├── Referenced media assets
                             ├── Logical pages / views
                             ├── Internal presentation timeline
                             └── Scene-owned time guards
```

### Playlist

The playlist is the primary unit an administrator programs and assigns. It defines an ordered sequence of playlist items and an overall repeat/advance policy.

### Playlist item

A playlist item references a scene and defines how that scene is used in this playlist: effective playback duration, transition, and playback/end behavior. The same scene can appear multiple times, including with different durations and transitions.

### Scene and scene revision

A scene is a reusable unit of presentation content. It is created in SiSSi's AI-assisted frontend authoring environment and may combine uploaded assets, MCP-created artifacts or data, and custom frontend code using the SiSSi design system. A scene can be a static layout, animated presentation, data-driven page, video composition, or other supported presentation behavior. One scene may contain multiple logical pages or views.

The default AI-editable source contract consists of `index.html`, `style.css`, and `script.js`. Assets are managed separately. Navigation among logical pages in a scene belongs to the scene's own frontend, not to the playlist. An advanced multi-file scene mode may be defined separately.

A scene revision identifies an immutable version of its frontend, presentation definition, design-system/runtime contract, and references to versioned assets. Content identity is separate from where and when it is used.

A scene may suggest a default playback duration. The playlist item determines the effective duration for a particular use.

### Source assets and generated artifacts

Images, PDFs, MP4 videos, and other supported uploads are managed as reusable source assets. An asset can be shown directly where supported or used inside a scene's frontend. MCP-connected tools may create or retrieve artifacts and data for incorporation into a scene. Imported material must be validated before it is used or published.

Source assets, editable scene workspace files, published scene revisions, and device-side caches are distinct concepts. Updating a source asset or workspace must not silently mutate an already published revision.

### Scene timeline

The scene's internal timeline governs behavior inside the presentation: animation, revealing or replacing elements, and timed media. It is distinct from the playlist item's playback slot. A scene may loop, play once and hold, remain static, or signal completion; exact supported modes and completion semantics require an explicit runtime contract.

### Scene-owned time guards

Time guards are part of the scene's own presentation logic. A scene may use them to decide when to show, hide, replace, or advance particular elements, or when the scene itself is appropriate to run. Examples include revealing a service-time panel only before a service, hiding an expired notice, or restricting the entire scene to weekday mornings. A scene's internal timeline and its time guards belong to the scene; they are not playlist timing.

A scene may therefore contain multiple time guards at different scopes: element-level guards affect only parts of its presentation, while scene-level availability guards determine whether the scene is eligible to be selected at all. Guards should use an explicit time zone when based on local wall-clock time. Exact rule composition, exceptions, overnight windows, daylight-saving transitions, clock uncertainty, and behavior when a guard cannot be evaluated must be specified before implementation.

A playlist item may add contextual restrictions, but must not silently bypass a scene's own guards. If a scene-level availability guard becomes false while the scene is playing, the runtime should stop presenting the scene and advance to eligible content. An element-level guard should only affect the element it governs. The runtime should avoid blanking the display while preparing a replacement.

### Schedule, display assignment, and screen groups

A schedule/assignment determines which playlist is active on a display or display group and during which calendar periods. It does not own the internal timeline of a scene or the duration of an individual playlist item. Screen groups are reusable publishing targets: administrators can assign a playlist to a group (for example, all foyer screens) rather than configuring each display separately. Group membership and playlist assignment are distinct, and precedence between group assignments, per-screen overrides, schedules, and overlapping assignments must be defined explicitly.

### Special broadcasts and multi-region composition

A **special broadcast** is a temporary second playlist presented concurrently with the normal/base playlist on a display or screen group. The base playlist continues in its own playback position while the secondary playlist is rendered in a separate region: for example, corner picture-in-picture (PiP), a vertical left/right split, or a horizontal top/bottom split. This is a display composition assignment, not an ordinary playlist item and not a mutation of either playlist.

The composition should define its target display/group, base and secondary playlist references, layout preset/region geometry, priority, activation and expiry rules, and fallback behavior. Initially, support one secondary broadcast per display while keeping the model extensible. Prepare the secondary content before showing it; when it ends, remove that region without restarting the base playlist. Special broadcasts can be activated manually or by the external conditions described below.

PiP and split-screen must be implemented by the SiSSi client compositor; do not assume the television itself provides a usable PiP function. Define per-device capability support, content/media combinations, region scaling, and audio focus. By default, avoid two simultaneous audible sources. If a client cannot support the selected layout, apply a configured fallback and report it rather than silently claiming success. See [D-029](decisions/D-029-special-broadcast-composition.md).

### Conditional playlist activation

A playlist assignment, playlist-selection rule, or special-broadcast composition may also have an external condition. Examples include selecting a live-service playlist only while a YouTube Live broadcast is active, or selecting a playlist when a configured API returns a JSON field with a particular value or URL. This is server-side conditional activation, separate from calendar schedules and scene-owned time guards; it never edits a playlist or immutable scene revision.

Use the planned `varfetch` package (`varfetch@^0.3.0` as of 2026-10-15) as the server-side HTTP connector primitive for configured requests, safe variable interpolation, SSRF protections, and JSON-path response mapping. The repository does not yet contain an application package manifest, so the actual npm dependency is to be added when the server application is scaffolded. See [D-028](decisions/D-028-conditional-playlist-activation.md).

Conditions must have explicit predicates, evaluation cadence, timeout and response limits, last-success/freshness tracking, and a configured policy for unknown or failed evaluations. Never implicitly interpret a timeout or malformed/missing response as either true or false. Keep API credentials and connector configuration on the server; signage clients receive only the resolved desired configuration. Private-network targets are blocked by default, with exceptions allowed only through trusted server-side configuration. Any response-derived URL must be validated against the intended use before it can be fetched or displayed.

## Time ownership

| Time concept | Owner | Purpose |
|---|---|---|
| Internal timeline | Scene revision/runtime | Animation and timed changes within the presentation |
| Scene time guards | Scene | Element visibility and scene eligibility |
| Playback slot | Playlist item | How long this playlist occurrence is shown |
| Playlist activation | Schedule/assignment | When a playlist is active on a display |

## Authoring and delivery

The authoring environment uses an isolated Vite development server on the SiSSi server, started with `npm run dev` and exposed through an authenticated UUID-addressed reverse proxy. It is for editing and live preview; signage clients do not run Vite.

Publishing builds an immutable scene revision and serves it from a stable SiSSi URL based on the scene UUID, with an explicit private/restricted or public/embed-enabled access policy. A versioned bundle is also the preferred basis for verified, cacheable offline playback. The authoring and publishing contract is specified in [Content creation and authoring](creation-system.md).

Hosted URL and bundle scenes should share a defined display lifecycle contract: prepare, ready, start, stop, and optionally completion. A bundle should be downloaded and verified before activation and should support offline playback to the extent that its declared dependencies permit. Failed downloads or preparation must not displace the last known-good content.

This document records the accepted domain model, not a finished API schema or implemented feature. Phase 1 must define exact schemas, conflict rules, lifecycle events, validation, and error behavior before implementation.
