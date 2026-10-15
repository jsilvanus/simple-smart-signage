# D-032 — Scene-first content model and layout composition

- **Status:** Accepted architectural direction; exact schema and runtime contract remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi signage is primarily intended for static or slowly changing content such as announcements, event information, notices, and advertisements. Content authoring and playback orchestration are separate concerns. Scenes are the primary reusable content units; layouts compose scenes visually, while playlists and schedules govern playback.

## Decision

A **scene** is the primary reusable content unit. A **layout** is a reusable visual composition that groups one or more scenes and defines their regions and relationships. Layouts support free split all the way: users define region count, position, size, overlap and stacking order. PiP, split and 4-split are convenient starting templates, not restrictions on the layout model.

**Playlists, programmes, assignments and schedules are playback concepts.** A playlist references scenes and/or layouts as ordered playback entries; it does not own the definition of the layout. Concurrent playlist playback, where configured, remains distinct from a layout grouping scenes: each playlist retains its own playback sequence and state.

Within a layout, each region references a scene occurrence or an explicitly supported scene instance. A layout is content composition; it does not own playlist sequencing or schedule eligibility.

## Scene completion, closure and scene-callable functions

A scene reporting completion/closure inside a layout must not have an implicit global meaning. The layout or region defines the response. Playback policies remain owned by the playlist/player layer.

Scenes need a small, documented runtime API for signaling lifecycle and interaction events to the host player. For example, `close()` requests that the current scene occurrence close. It does not directly remove DOM, stop a playlist, or decide what replaces the scene; the host applies the configured end-of-scene policy for that region. A distinct `complete()` signal may be provided for normal completion, while `close()` can represent a request to dismiss/exit an interactive scene. Exact names and payloads remain to be finalized.

The API should also support safe, scoped interaction needs such as reporting interaction state or requesting a supported action, without granting arbitrary access to the player, other scenes, cameras, or tenant resources. Calls must be validated against the scene's runtime context and permissions. The host should ignore or safely reject unsupported calls and record useful diagnostics. Supported policies should include:

- **Hold:** keep the last rendered frame visible.
- **Advance:** replace the completed scene with the next eligible scene for that region.
- **Clear:** leave the region empty or show a configured empty-state placeholder.
- **Collapse/reflow:** remove the region and apply a defined layout adjustment, if the layout permits it.
- **End composition:** finish the playlist occurrence or request a higher-level selection, where explicitly configured.

The selected policy must be validated for the layout type. For example, collapse/reflow is not assumed for a fixed four-region layout. If no policy is configured, use a safe documented default rather than silently ending the whole playlist; the default is to be finalized in the runtime contract.

Completion/closure is distinct from a runtime error. Errors use the player recovery policy, report diagnostics, and must not be treated as a successful completion unless an explicit error policy says to advance.

## Runtime and composition requirements

- Scene regions have defined bounds, stacking order, fit/scaling, clipping, and optional transition behavior.
- Scene-callable lifecycle functions signal intent to the host; the host remains responsible for applying configured behavior.
- Camera-based interaction (for example, tracking a person's hand as a pointer) is an input source, not a special layout. It may send pointer/gesture events to an authorized scene, and the scene may call `close()` when the interaction is finished. Camera access and event delivery must be permissioned, explicitly enabled, and fail safely when unavailable.
- PiP permits overlap and therefore needs explicit z-order and placement rules.
- - A scene closing in one region must not automatically stop other regions in the layout.
- Playlist sequencing, eligibility, scheduling and end behavior remain separate from layout composition.
- Playlist schedule eligibility and finite/loop run policies remain distinct from the layout's region-level scene completion behavior.
- Special broadcasts can compose with or replace the whole current playlist layout according to their own explicit mode and scope.
- The client compositor is responsible for rendering the layout; it must not assume the display hardware provides native PiP.
- Device capability checks and fallback behavior are required when a target cannot render a selected layout.
- Keep audio focus explicit; default to avoiding simultaneous audible sources.
- Layout definitions and published scene revisions must be versioned so a published composition is reproducible.

Free split is the general layout model for grouping scenes; PiP, split and 4-split are starting templates. Concurrent playlists are a separate playback composition capability. This decision records the intended model, not an implemented feature or final API schema.

## References

- [Content and playback model](../content-model.md)
- [Screen and screen-group assignment queues](D-031-playlist-composition.md)
- [Special broadcast composition](D-029-special-broadcast-composition.md)
