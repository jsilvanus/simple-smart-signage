# D-043 — First-class caption services and persistent caption layers

- **Status:** Accepted architectural direction; exact source contract and schemas remain to be specified
- **Date:** 2026-10-16

## Context

SiSSi displays are often muted, so captions may be the only way viewers can follow spoken content. Captions need to continue across ordinary playlist scene transitions and may be presented in different languages or layouts on different screens. Treating captions only as an ordinary sequential playlist item would make their lifetime and connection behavior unnecessarily fragile.

LCYT already provides useful concepts for live caption viewers, language-specific caption feeds, and named output viewports. SiSSi should reuse the architectural separation between live source, presentation, and target without tightly coupling the core model to LCYT.

## Decision

- **Caption service is a first-class SiSSi object.** It represents a configured live caption source and its connection/settings, separately from scenes, layouts, and playlists.
- **LCYT is the initial integration target.** A caption service can reference LCYT configuration and a compatible viewer/feed, including the appropriate stream/viewer identity and language settings. Exact fields and authentication semantics remain to be designed; do not assume every LCYT viewer URL or key is public or suitable for embedding.
- **Caption presentation is independent from the source.** Screens configure language selection, typography, background/contrast, alignment, line handling, and stale/disconnected behavior independently of the caption service.
- **Captions are a persistent auxiliary presentation layer.** They can remain active while the main playlist changes scenes. The layer is not an ordinary sequential playlist item and does not own or reset the main playlist's playback state.
- **Support multiple placement modes:** overlay captions over the current composition, or reserve a dedicated region/strip for captions. Different displays may use different modes, language choices, and styling while consuming the same service.
- **Reuse SiSSi's compositor and region model where practical.** Captions may be rendered by a dedicated trusted runtime component or a constrained caption scene, but the persistent layer must not be accidentally removed or covered by ordinary scene transitions. The implementation must preserve the host/player authority and scene isolation boundary.
- **Keep source, presentation, and target distinct.** One caption service may feed multiple display targets; each target can select its own language and presentation settings.
- **Provider extensibility:** define a provider-neutral caption-source contract, with LCYT implemented first. Do not make LCYT-specific assumptions part of the core caption-service model unless explicitly represented as provider-specific configuration.
- **Live behavior must be resilient.** Define connection/reconnection, event freshness, stale-text clearing, empty/offline indication, and recovery behavior before implementation. A source outage must not interrupt the main playlist.
- **Security:** keep provider credentials and private configuration out of scene bundles and display-visible configuration. Validate service access and any embedding/network requirements. Caption-source permissions are explicit.

## Consequences

- Caption services become manageable and reusable independently of any playlist or scene.
- Live captions can span transitions and can be displayed in different languages or regions across a screen group.
- SiSSi can initially integrate LCYT while retaining a path to other compatible caption providers.
- Exact LCYT fields, event mapping, authentication, buffering, and browser/platform constraints remain open implementation details.

## References

- [D-029 — Concurrent playlists and temporary playback overrides](D-029-special-broadcast-composition.md)
- [D-032 — Scene-first content model and layout composition](D-032-playlist-layouts-and-concurrent-scenes.md)
- [SiSSi content and playback model](../content-model.md)
- [LCYT repository](https://github.com/jsilvanus/live-captions-yt)
- [LCYT viewer API](https://github.com/jsilvanus/live-captions-yt/blob/main/docs/api/viewer.md)
- [LCYT viewport settings plan](https://github.com/jsilvanus/live-captions-yt/blob/main/docs/plans/plan_dsk_viewport_settings.md)
