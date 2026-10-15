# D-029 — Concurrent playlists and temporary playback overrides

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Model temporary high-priority display behavior as an **override** layered over the normal desired playback state. Overrides use a concurrent-playlist/composition model and have an explicit **override style**:
  - **WITH:** Add an override playlist/content alongside base playback in a separate region, such as PiP or split-screen. Base playback continues independently and retains its playback state.
  - **REPLACE:** Temporarily take over the full display. The base playback state is preserved and resumes when the override ends.
- **Conceptual consolidation:** A special broadcast is not a separate playback/content model. It is a use case or user-facing workflow that creates an override referencing a playlist or supported content. Concurrent playlists retain their own ordered items and playback policies; an override determines how its content relates to the base display state.
- **Activation and policy:** Overrides may be started manually or activated by a condition such as an API/livestream state. Define target screen/group, priority, activation/deactivation, expiry, manual stop, fallback, audit, and deterministic conflict behavior when multiple overrides target the same display.
- **Composition:** WITH may use PiP, vertical split, horizontal split, or another supported layout. These are SiSSi compositor features, not assumptions about hardware TV PiP. The client must negotiate supported layouts/media, region geometry, scaling/cropping, accessibility, performance, and audio focus. Avoid accidental dual audio. If a client cannot support a requested composition, apply an explicit fallback and report the result.
- **Playback independence:** The base and override playlists retain independent sequence and playback state. Prepare and validate override content before activation. Ending a WITH override removes its additional region; ending a REPLACE override restores the prior composition. Neither mode restarts or mutates the base playlist.
- **Initial scope:** One active override per display is sufficient initially. The model should not preclude future multiple regions or more complex concurrent compositions.
- **Authorization and operation:** Activation/deactivation is permissioned and auditable. The client receives only the resolved authorized composition and content references, never connector credentials.
- **Conditions:** Conditions can decide whether an override is active, but condition evaluation is a separate server-side concern; see [D-028](D-028-conditional-playlist-activation.md).
- **References:** [Content and playback model](../content-model.md) · [Architecture planes and concepts](../architecture/planes-and-concepts.md) · [Conditional playlist activation](D-028-conditional-playlist-activation.md)

This decision records the intended behavior, not an implemented feature. Exact schemas, override precedence, layout geometry, compositor API, audio policy, device capability contract, and test matrix remain to be specified.
