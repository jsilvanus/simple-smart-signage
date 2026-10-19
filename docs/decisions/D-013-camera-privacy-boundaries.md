# D-013 — Camera privacy boundaries

- **Status:** Accepted (binding product constraint)
- **Date:** 2026-10-15
- **Specification:** Complete for the prohibitions. The narrow allowed use is defined, but no camera feature is authorised.
- **Full text:** [privacy-and-camera.md](../privacy-and-camera.md)

## Decision

SiSSi must never identify a person, or attempt to identify one, through a camera. It must never link camera images, frames or derived observations to identity or other personal data. Camera use is off by default. Any future use is limited to transient on-device processing with no storage or transmission of frames.

This is a product-level rule. Configuration, content assignment, app permissions and administrators cannot relax it. Changing it requires a new accepted decision and a documented privacy review.

## Consequences

- Camera capability is a separate, explicit permission and is never granted by a general web-app permission.
- Camera-based features (D-032 hand pointer, the research items in `plan.md`) must be designed within this constraint and must not sustain a persistent person or hand track across sessions without a revised decision.
- Logs and diagnostics must not contain frames, image URLs, biometric templates or person-level camera observations.

## References

- [Privacy and camera boundaries](../privacy-and-camera.md)
- [Display runtime](../display-runtime.md)
- [D-032 Playlist layouts and concurrent scenes](D-032-playlist-layouts-and-concurrent-scenes.md)
