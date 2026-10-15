# D-032 — Playlist layouts and concurrent playlist composition

- **Status:** Accepted architectural direction; exact schema and runtime contract remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi signage is primarily intended for static or slowly changing content such as announcements, event information, notices, and advertisements. Such content benefits both from grouping scenes within one playlist and from displaying multiple playlists concurrently. These are separate concepts.

## Decision

A playlist owns a **layout** that groups one or more scene occurrences into one composed presentation. Separately, SiSSi supports **concurrent playlist composition**, which displays multiple independently running playlists together. Do not conflate a layout inside one playlist with a composition of multiple playlists.

Layouts inside a playlist support free split all the way: the user can define region count, position, size, overlap and stacking order rather than being limited to fixed presets. PiP, split and 4-split may be offered as convenient starting templates, but are not hard limits or a separate layout model.

Concurrent playlist composition is a separate level. It can display independent playlists together using PiP, split, 4-split or free split. The user can configure the regions rather than being restricted to equal quadrants. Device capability and resource limits still apply.

Within a playlist layout, each region references a scene occurrence. In a concurrent-playlist composition, each region references a distinct playlist, which retains its own sequence, eligibility and playback state. Each region advances independently; one scene or playlist must not block another.

## Scene completion, closure and scene-callable functions

A scene reporting completion/closure inside a playlist layout must not have an implicit global meaning. The layout or region defines the response. A playlist ending inside a concurrent-playlist composition follows the composition's explicit end-of-playlist policy and must not implicitly stop other playlists.

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
- A scene closing in one region must not automatically stop other regions within its playlist layout.
- A playlist ending or failing in a concurrent-playlist composition must not automatically stop the other playlists.
- Playlist schedule eligibility and finite/loop run policies remain distinct from the layout's region-level scene completion behavior.
- Special broadcasts can compose with or replace the whole current playlist layout according to their own explicit mode and scope.
- The client compositor is responsible for rendering the layout; it must not assume the display hardware provides native PiP.
- Device capability checks and fallback behavior are required when a target cannot render a selected layout.
- Keep audio focus explicit; default to avoiding simultaneous audible sources.
- Layout definitions and published scene revisions must be versioned so a published composition is reproducible.

Free split is supported for concurrent playlists as well as configurable scene regions within a playlist layout. This decision records the intended model, not an implemented feature or final API schema.

## References

- [Content and playback model](../content-model.md)
- [Screen and screen-group assignment queues](D-031-playlist-composition.md)
- [Special broadcast composition](D-029-special-broadcast-composition.md)
