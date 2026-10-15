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
                             ├── Frontend presentation
                             ├── Referenced media assets
                             ├── Internal presentation timeline
                             └── Scene-owned time guards
```

### Playlist

The playlist is the primary unit an administrator programs and assigns. It defines an ordered sequence of playlist items and an overall repeat/advance policy.

### Playlist item

A playlist item references a scene and defines how that scene is used in this playlist: effective playback duration, transition, and playback/end behavior. The same scene can appear multiple times, including with different durations and transitions.

### Scene and scene revision

A scene is a reusable unit of presentation content. It is created in SiSSi's AI-assisted frontend authoring environment and may combine uploaded assets, MCP-created artifacts or data, and custom frontend code using the SiSSi design system. A scene can be a static layout, animated presentation, data-driven page, video composition, or other supported presentation behavior.

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

### Schedule and display assignment

A schedule/assignment determines which playlist is active on a display or display group and during which calendar periods. It does not own the internal timeline of a scene or the duration of an individual playlist item.

## Time ownership

| Time concept | Owner | Purpose |
|---|---|---|
| Internal timeline | Scene revision/runtime | Animation and timed changes within the presentation |
| Scene time guards | Scene | Element visibility and scene eligibility |
| Playback slot | Playlist item | How long this playlist occurrence is shown |
| Playlist activation | Schedule/assignment | When a playlist is active on a display |

## Authoring and delivery

The authoring environment uses an isolated Vite development server per scene workspace, started with `npm run dev` and exposed through a UUID-addressed reverse proxy. This URL is for authenticated editing and live preview, not a permanent production address.

Publishing creates an immutable scene revision and a versioned delivery artifact, initially a static web bundle plus a manifest. The authoring and publishing contract is specified in [Content creation and authoring](creation-system.md).

Hosted URL and bundle scenes should share a defined display lifecycle contract: prepare, ready, start, stop, and optionally completion. A bundle should be downloaded and verified before activation and should support offline playback to the extent that its declared dependencies permit. Failed downloads or preparation must not displace the last known-good content.

This document records the accepted domain model, not a finished API schema or implemented feature. Phase 1 must define exact schemas, conflict rules, lifecycle events, validation, and error behavior before implementation.
