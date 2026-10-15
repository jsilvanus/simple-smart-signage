# Content and playback model

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Scene-first content model. Layouts group scenes into a visual composition; playlists, programmes, assignments and schedules determine playback.

## Core hierarchy

```text
CONTENT CONCEPTS                         PLAYBACK CONCEPTS
Scene revisions ──> Layouts              Schedule / assignment queue
       │                │                        │
       └────────────────┘                        v
        reusable content                 Programme / Playlist(s)
                                                  │
                                                  v
                                      Scene or layout references
```

Scenes and layouts describe what can be shown. Playlists, programmes, assignments and schedules describe when and how content is played.

### Scene

A **scene** is the primary reusable content unit: a presentation, page, interactive experience, video composition or other authored content. A scene can have immutable published revisions and can be referenced by multiple layouts or playlists.

### Layout

A **layout** is a visual composition/group of scenes. It defines the regions in which scenes appear, including free split with user-defined region count, placement, size, overlap and stacking order. PiP, split and 4-split are convenient starting templates, not restrictions on the composition model.

The author configures what happens when a scene ends within a layout: hold its last frame, advance/replace that region, clear it or show a placeholder, collapse/reflow where supported, or end the layout when explicitly selected. Scene completion is distinct from runtime failure.

Scenes expose a small host-mediated runtime API. For example, `close()` requests closure of the current scene occurrence; the host applies the configured end behavior rather than letting a scene directly control the playlist or compositor. A separate `complete()` signal may distinguish normal completion from dismissal. Exact names and payloads remain to be finalized. This can support interactive scenes such as a camera-driven hand pointer: authorized pointer/gesture events are delivered to a scene, which can request `close()` when its interaction finishes. Camera access is explicitly enabled and permissioned, and unavailable input must fail safely.

### Playlist

A **playlist** is a playback sequence that references scenes and/or layouts. Its entries define order, effective playback duration, transitions, and end behavior. Entry-level time windows and conditions determine whether an entry is eligible; these are playback rules, not intrinsic properties of the scene or layout.

### Programme and assignment queue

A **programme** can be a conditional, explicitly ordered sequence of reusable playlists. A screen or screen group has an assignment queue that selects the active programme or playback target. Assignment eligibility, programme selection, playlist-entry eligibility, and scene-internal interaction logic are distinct layers. See [D-031 — Screen assignment queues and conditional playlist sequences](decisions/D-031-playlist-composition.md).

### Scene and layout revisions

Published scene and layout revisions are immutable and versioned so playback is reproducible. Editing a draft must not change what is already published to screens. A playlist references a specific published revision or an explicitly defined update policy.

### Special broadcasts and temporary display overrides

A **special broadcast** is a temporary display override that can operate in one of two modes:

- **WITH current content:** compose a secondary playlist in a separate region (PiP, left/right split, top/bottom split, etc.) while the normal/base programme continues independently in the remaining region.
- **REPLACE current content:** temporarily take over the entire display, replacing the current composition—for example, show a Eucharistic peace image during the Eucharist. The underlying base programme retains its playback position and state, and resumes when the override ends.

A special broadcast references a playlist or supported content payload; it does not mutate the base playlist. It may be activated manually, by time, or by conditions. It defines target display/group, mode, layout if composited, priority, activation/expiry/stop rules, and fallback. Prepare and validate its content before activation. When it ends, restore the prior composition and base playback state without restarting the base programme. Initially, one active special broadcast per display is sufficient; define deterministic priority/conflict behavior and leave room for later stacking or multiple regions.

PiP and split-screen must be implemented by the SiSSi client compositor; do not assume the television itself provides a usable PiP function. Define per-device capability support, content/media combinations, region scaling, and audio focus. By default, avoid two simultaneous audible sources. If a client cannot support the selected layout, apply a configured fallback and report it rather than silently claiming success. See [D-029](decisions/D-029-special-broadcast-composition.md).

### Shared condition evaluation

Conditions can be referenced by playlist-level eligibility, individual scene-entry eligibility, programme playlist-entry eligibility, screen/group programme assignments, and special-broadcast activation. Finite run counts are part of a programme playlist entry's eligibility state. Examples include selecting a live-service playlist only while a YouTube Live broadcast is active, or making a scene eligible when a configured API returns a JSON field with a particular value. Time windows and condition rules are combined according to the policy's explicit rule composition; this never edits a playlist or immutable scene revision.

Use the planned `varfetch` package (`varfetch@^0.3.0` as of 2026-10-15) as the server-side HTTP connector primitive for configured requests, safe variable interpolation, SSRF protections, and JSON-path response mapping. The repository does not yet contain an application package manifest, so the actual npm dependency is to be added when the server application is scaffolded. See [D-028](decisions/D-028-conditional-playlist-activation.md).

Conditions must have explicit predicates, evaluation cadence, timeout and response limits, last-success/freshness tracking, and a configured policy for unknown or failed evaluations. Never implicitly interpret a timeout or malformed/missing response as either true or false. Keep API credentials and connector configuration on the server; signage clients receive only the resolved desired configuration. Private-network targets are blocked by default, with exceptions allowed only through trusted server-side configuration. Any response-derived URL must be validated against the intended use before it can be fetched or displayed.

## Time ownership

| Time concept | Owner | Purpose |
|---|---|---|
| Internal timeline | Scene revision/runtime | Animation and timed changes within the presentation |
| Scene-owned guards | Scene runtime | Internal presentation behavior, independently evaluated by the scene |
| Element-level guards | Scene presentation | Visibility of individual elements within an eligible scene |
| Playlist eligibility policy | Playlist | Whether the playlist as a whole may be selected/played now |
| Entry eligibility policy | Playlist entry | Whether this scene occurrence may be selected now |
| Programme playlist order and eligibility | Programme sequence entry | Whether/when a referenced playlist runs, its order, and its run limit |
| Assignment schedule | Screen / screen group | Select one effective 24-hour schedule per date: calendar-date override first, otherwise weekday; uncovered time is off time |
| Assignment queue | Screen / screen group | Which eligible programme is selected for the target |
| Playback slot | Playlist item | How long this playlist occurrence is shown |
| Playlist activation | Schedule/assignment | When a playlist is active on a display |

## Authoring and delivery

The authoring environment uses an isolated Vite development server on the SiSSi server, started with `npm run dev` and exposed through an authenticated UUID-addressed reverse proxy. It is for editing and live preview; signage clients do not run Vite.

Publishing builds an immutable scene revision and serves it from a stable SiSSi URL based on the scene UUID, with an explicit private/restricted or public/embed-enabled access policy. A versioned bundle is also the preferred basis for verified, cacheable offline playback. The authoring and publishing contract is specified in [Content creation and authoring](creation-system.md).

Hosted URL and bundle scenes should share a defined display lifecycle contract: prepare, ready, start, stop, and optionally completion. A bundle should be downloaded and verified before activation and should support offline playback to the extent that its declared dependencies permit. Failed downloads or preparation must not displace the last known-good content.

This document records the accepted domain model, not a finished API schema or implemented feature. Phase 1 must define exact schemas, conflict rules, lifecycle events, validation, and error behavior before implementation.
