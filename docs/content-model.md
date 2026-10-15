# Content and playback model

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Playlist-first programming, with reusable scenes and independent timing/availability rules.

## Core hierarchy

```text
Display assignment / schedule
Screen / screen-group assignment queue
├── Eligible playlist assignment ──> Playlist
├── Eligible playlist assignment ──> Playlist
└── Eligible playlist assignment ──> Playlist
                                    └── Scene entries ──> Scene revisions
```

### Playlist

A **playlist** is a reusable ordered sequence of scene entries. A **programme** can be a conditional sequence of reusable playlists, each referenced with an explicit order and eligibility policy. A screen or screen group has an assignment queue that selects which programme is active. This separates target assignment from programme composition. See [D-031 — Screen assignment queues and conditional playlist sequences](decisions/D-031-playlist-composition.md).

### Playlist item

A playlist entry references a scene revision and defines its effective playback duration, transition, and playback/end behavior. Each entry may have its own time window and condition policy; when ineligible, that entry is skipped. These are playlist-level selection rules, not guards owned by the scene. The same scene can appear multiple times with different settings.

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

### Playlist and entry eligibility

Time and condition rules belong to the **playlist** or to an individual **playlist entry**, not to the scene's own guards. The scene independently handles its internal guards and presentation behavior.

- **Playlist eligibility** determines whether the playlist as a whole may be selected or run.
- **Scene-entry eligibility** determines whether that particular occurrence of a scene is selectable within the playlist. Rules may use date ranges, local time windows, weekdays, or external conditions.
- **Scene-owned guards** remain independent runtime behavior inside the scene; playlist selection must not duplicate or take ownership of them.
- **Element-level guards** affect parts of a scene and remain internal to its presentation.
- **Assignments and schedules** determine where and when a playlist is assigned. They are distinct from playlist-level and entry-level eligibility.

If an entry is ineligible, the player skips it and considers the next eligible entry. If no entry is eligible, behavior follows an explicit fallback/empty-state policy rather than showing ineligible content or looping indefinitely. Exact timing semantics, rule composition, and behavior when a condition is unknown, stale, or unavailable must be defined before implementation.

### Schedule, display assignment, and screen groups

A schedule/assignment determines which playlist is active on a display or display group and during which calendar periods. It does not own the internal timeline of a scene or the duration of an individual playlist item. Screen groups are reusable publishing targets: administrators can assign a playlist to a group (for example, all foyer screens) rather than configuring each display separately. Group membership and playlist assignment are distinct, and precedence between group assignments, per-screen overrides, schedules, and overlapping assignments must be defined explicitly.

### Special broadcasts and temporary display overrides

A **special broadcast** is a temporary display override that can operate in one of two modes:

- **WITH current content:** compose a secondary playlist in a separate region (PiP, left/right split, top/bottom split, etc.) while the normal/base programme continues independently in the remaining region.
- **REPLACE current content:** temporarily take over the entire display, replacing the current composition—for example, show a Eucharistic peace image during the Eucharist. The underlying base programme retains its playback position and state, and resumes when the override ends.

A special broadcast references a playlist or supported content payload; it does not mutate the base playlist. It may be activated manually, by time, or by conditions. It defines target display/group, mode, layout if composited, priority, activation/expiry/stop rules, and fallback. Prepare and validate its content before activation. When it ends, restore the prior composition and base playback state without restarting the base programme. Initially, one active special broadcast per display is sufficient; define deterministic priority/conflict behavior and leave room for later stacking or multiple regions.

PiP and split-screen must be implemented by the SiSSi client compositor; do not assume the television itself provides a usable PiP function. Define per-device capability support, content/media combinations, region scaling, and audio focus. By default, avoid two simultaneous audible sources. If a client cannot support the selected layout, apply a configured fallback and report it rather than silently claiming success. See [D-029](decisions/D-029-special-broadcast-composition.md).

### Shared condition evaluation

Conditions can be referenced by playlist-level eligibility, individual scene-entry eligibility, programme playlist-entry eligibility, screen/group programme assignments, and special-broadcast activation. Examples include selecting a live-service playlist only while a YouTube Live broadcast is active, or making a scene eligible when a configured API returns a JSON field with a particular value. Time windows and condition rules are combined according to the policy's explicit rule composition; this never edits a playlist or immutable scene revision.

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
| Programme playlist order and eligibility | Programme sequence entry | Whether/when a referenced playlist runs and its order in the sequence |
| Assignment queue | Screen / screen group | Which eligible programme is selected for the target |
| Playback slot | Playlist item | How long this playlist occurrence is shown |
| Playlist activation | Schedule/assignment | When a playlist is active on a display |

## Authoring and delivery

The authoring environment uses an isolated Vite development server on the SiSSi server, started with `npm run dev` and exposed through an authenticated UUID-addressed reverse proxy. It is for editing and live preview; signage clients do not run Vite.

Publishing builds an immutable scene revision and serves it from a stable SiSSi URL based on the scene UUID, with an explicit private/restricted or public/embed-enabled access policy. A versioned bundle is also the preferred basis for verified, cacheable offline playback. The authoring and publishing contract is specified in [Content creation and authoring](creation-system.md).

Hosted URL and bundle scenes should share a defined display lifecycle contract: prepare, ready, start, stop, and optionally completion. A bundle should be downloaded and verified before activation and should support offline playback to the extent that its declared dependencies permit. Failed downloads or preparation must not displace the last known-good content.

This document records the accepted domain model, not a finished API schema or implemented feature. Phase 1 must define exact schemas, conflict rules, lifecycle events, validation, and error behavior before implementation.
