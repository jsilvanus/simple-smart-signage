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

### Scene and playlist display eligibility

Scenes and playlists both have first-class **display-eligibility policies**, and each policy can combine time windows with condition rules. Eligibility is separate from a scene's internal timeline, a playlist item's playback slot, and a display assignment's schedule. See [D-030 — Shared scene and playlist display eligibility](decisions/D-030-scene-and-playlist-eligibility.md).

- **Scene eligibility** determines whether a particular scene occurrence may be displayed now. It can restrict a scene to date ranges, local time windows, weekdays, or conditions such as an event/API state.
- **Playlist eligibility** determines whether a playlist may be selected or played now. It can combine time windows and conditions, such as a service playlist being eligible only during a service and while its livestream is active.
- **Element-level guards** remain presentation logic: they show/hide parts of an otherwise eligible scene and do not make the whole scene ineligible.
- **Assignments and schedules** determine where and when a playlist is assigned; they do not override playlist or scene eligibility.
- **Playlist-item restrictions** may narrow the context for one occurrence, but must never bypass the referenced scene's own eligibility policy.

A scene that becomes ineligible during playback should be stopped and replaced by the next eligible item without unnecessarily blanking the display. If no scene in a playlist is eligible, the player follows an explicit fallback/empty-state policy instead of showing ineligible content or looping indefinitely. An ineligible playlist must not displace another eligible assignment. If no eligible assignment remains, use the configured display fallback.

Time rules need explicit time zones for local wall-clock windows and deliberate handling of overnight windows, exceptions, daylight-saving transitions, and uncertain clocks. Rule composition must be explicit (for example, all rules must match versus any rule may match). A condition that is unknown, stale, times out, or errors must follow a configured policy; never silently coerce it to true or false. Eligibility is not an authorization boundary: publishing, tenant access, and display permissions are enforced separately.

### Schedule, display assignment, and screen groups

A schedule/assignment determines which playlist is active on a display or display group and during which calendar periods. It does not own the internal timeline of a scene or the duration of an individual playlist item. Screen groups are reusable publishing targets: administrators can assign a playlist to a group (for example, all foyer screens) rather than configuring each display separately. Group membership and playlist assignment are distinct, and precedence between group assignments, per-screen overrides, schedules, and overlapping assignments must be defined explicitly.

### Special broadcasts and multi-region composition

A **special broadcast** is a temporary second playlist presented concurrently with the normal/base playlist on a display or screen group. The base playlist continues in its own playback position while the secondary playlist is rendered in a separate region: for example, corner picture-in-picture (PiP), a vertical left/right split, or a horizontal top/bottom split. This is a display composition assignment, not an ordinary playlist item and not a mutation of either playlist.

The composition should define its target display/group, base and secondary playlist references, layout preset/region geometry, priority, activation and expiry rules, and fallback behavior. Initially, support one secondary broadcast per display while keeping the model extensible. Prepare the secondary content before showing it; when it ends, remove that region without restarting the base playlist. Special broadcasts can be activated manually or by the external conditions described below.

PiP and split-screen must be implemented by the SiSSi client compositor; do not assume the television itself provides a usable PiP function. Define per-device capability support, content/media combinations, region scaling, and audio focus. By default, avoid two simultaneous audible sources. If a client cannot support the selected layout, apply a configured fallback and report it rather than silently claiming success. See [D-029](decisions/D-029-special-broadcast-composition.md).

### Shared condition evaluation

Conditions can be referenced by scene and playlist eligibility policies, playlist assignments/selections, and special-broadcast compositions. Examples include selecting a live-service playlist only while a YouTube Live broadcast is active, or making a scene eligible when a configured API returns a JSON field with a particular value. Time windows and condition rules are combined according to the policy's explicit rule composition; this never edits a playlist or immutable scene revision.

Use the planned `varfetch` package (`varfetch@^0.3.0` as of 2026-10-15) as the server-side HTTP connector primitive for configured requests, safe variable interpolation, SSRF protections, and JSON-path response mapping. The repository does not yet contain an application package manifest, so the actual npm dependency is to be added when the server application is scaffolded. See [D-028](decisions/D-028-conditional-playlist-activation.md).

Conditions must have explicit predicates, evaluation cadence, timeout and response limits, last-success/freshness tracking, and a configured policy for unknown or failed evaluations. Never implicitly interpret a timeout or malformed/missing response as either true or false. Keep API credentials and connector configuration on the server; signage clients receive only the resolved desired configuration. Private-network targets are blocked by default, with exceptions allowed only through trusted server-side configuration. Any response-derived URL must be validated against the intended use before it can be fetched or displayed.

## Time ownership

| Time concept | Owner | Purpose |
|---|---|---|
| Internal timeline | Scene revision/runtime | Animation and timed changes within the presentation |
| Scene eligibility policy | Scene | Whether the whole scene may be displayed now |
| Element-level guards | Scene presentation | Visibility of individual elements within an eligible scene |
| Playlist eligibility policy | Playlist | Whether the playlist may be selected/played now |
| Playback slot | Playlist item | How long this playlist occurrence is shown |
| Playlist activation | Schedule/assignment | When a playlist is active on a display |

## Authoring and delivery

The authoring environment uses an isolated Vite development server on the SiSSi server, started with `npm run dev` and exposed through an authenticated UUID-addressed reverse proxy. It is for editing and live preview; signage clients do not run Vite.

Publishing builds an immutable scene revision and serves it from a stable SiSSi URL based on the scene UUID, with an explicit private/restricted or public/embed-enabled access policy. A versioned bundle is also the preferred basis for verified, cacheable offline playback. The authoring and publishing contract is specified in [Content creation and authoring](creation-system.md).

Hosted URL and bundle scenes should share a defined display lifecycle contract: prepare, ready, start, stop, and optionally completion. A bundle should be downloaded and verified before activation and should support offline playback to the extent that its declared dependencies permit. Failed downloads or preparation must not displace the last known-good content.

This document records the accepted domain model, not a finished API schema or implemented feature. Phase 1 must define exact schemas, conflict rules, lifecycle events, validation, and error behavior before implementation.
