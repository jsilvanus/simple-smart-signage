# D-032 — Playlist layouts and concurrent scene playback

- **Status:** Accepted architectural direction; exact schema and runtime contract remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi signage is primarily intended for static or slowly changing content such as announcements, event information, notices, and advertisements. Such content often benefits from showing several scenes at once. Concurrent composition should be part of playlist authoring, not a separate user-facing playback-lane concept.

## Decision

A playlist may define a **layout** that displays one or multiple scene entries concurrently. The layout belongs to the playlist. A playlist can use a single-scene full-screen layout or a multi-region layout.

Supported layout presets should include:

- Full screen / one region
- Picture-in-picture (PiP)
- Side-by-side
- Up to four regions
- Free split, with configurable region positions and sizes

These are presets over a common region-composition model, not separate playback engines. Regions may have unequal sizes. The model must not hardcode four equal quadrants as the only four-scene arrangement. Exact supported region counts and device limits remain capability-dependent.

Each region references a scene occurrence and its playback behavior. Regions ordinarily advance independently; one scene must not block another region. Scene content is mainly static or slowly changing, but the lifecycle contract must support scenes that signal completion/closure.

## Scene completion and closure

A scene reporting completion/closure must not have an implicit global meaning. The playlist layout or individual region defines the response. Supported policies should include:

- **Hold:** keep the last rendered frame visible.
- **Advance:** replace the completed scene with the next eligible scene for that region.
- **Clear:** leave the region empty or show a configured empty-state placeholder.
- **Collapse/reflow:** remove the region and apply a defined layout adjustment, if the layout permits it.
- **End composition:** finish the playlist occurrence or request a higher-level selection, where explicitly configured.

The selected policy must be validated for the layout type. For example, collapse/reflow is not assumed for a fixed four-region layout. If no policy is configured, use a safe documented default rather than silently ending the whole playlist; the default is to be finalized in the runtime contract.

Completion/closure is distinct from a runtime error. Errors use the player recovery policy, report diagnostics, and must not be treated as a successful completion unless an explicit error policy says to advance.

## Runtime and composition requirements

- Scene regions have defined bounds, stacking order, fit/scaling, clipping, and optional transition behavior.
- PiP permits overlap and therefore needs explicit z-order and placement rules.
- A scene closing in one region must not automatically stop other regions.
- Playlist schedule eligibility and finite/loop run policies remain distinct from the layout's region-level scene completion behavior.
- Special broadcasts can compose with or replace the whole current playlist layout according to their own explicit mode and scope.
- The client compositor is responsible for rendering the layout; it must not assume the display hardware provides native PiP.
- Device capability checks and fallback behavior are required when a target cannot render a selected layout.
- Keep audio focus explicit; default to avoiding simultaneous audible sources.
- Layout definitions and published scene revisions must be versioned so a published composition is reproducible.

This decision records the intended model, not an implemented feature or final API schema.

## References

- [Content and playback model](../content-model.md)
- [Screen and screen-group assignment queues](D-031-playlist-composition.md)
- [Special broadcast composition](D-029-special-broadcast-composition.md)
