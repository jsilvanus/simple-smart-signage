# D-031 — Playlist composition and nested playlists

- **Status:** Accepted architectural direction; exact schemas and playback semantics remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi needs reusable playlists that can be composed into higher-level programmes. A church may have separate playlists for announcements, worship, events, and livestreams, then define a programme that selects or sequences those playlists according to time and conditions. Copying their scene entries into a new playlist would duplicate content and make maintenance harder.

## Decision

Support a **playlist of playlists** as a first-class composition. A playlist may contain scene entries and/or child-playlist entries, with the item type explicit. Child playlists remain independently managed and reusable; composition does not copy or mutate their contents.

- A scene entry may have its own time window and condition policy. If it is ineligible, the player skips it and considers the next eligible entry. The referenced scene retains its own internal guards, which it handles independently.
- A child-playlist entry may have its own time window and condition policy controlling whether that child playlist is eligible for selection within its parent.
- A playlist may also define eligibility conditions for the playlist as a whole. This is distinct from eligibility on any one of its entries.
- Parent composition modes must be explicit. At minimum, support sequential sequencing of child playlists and conditional selection among eligible child playlists. Do not infer the mode from entry order.
- Define behavior for nested composition, loops/cycles, empty child playlists, no eligible entries, child completion/return, and whether child playback resumes or restarts when selected again. Prevent cycles or detect and reject them at validation time.
- Keep display assignment/scheduling distinct from playlist composition and from item-level eligibility. The same playlist can be reused in multiple parent programmes and assigned to different screen groups.

## Evaluation

- Evaluate time windows and external conditions server-side where they require connectors; clients receive resolved playback configuration, not secrets (see [D-028](D-028-conditional-playlist-activation.md)).
- Define explicit AND/OR rule composition, time-zone and daylight-saving behavior, freshness, and unknown/error handling.
- Make selection deterministic and observable: status should explain why an entry or child playlist was selected, skipped, or unavailable.
- Eligibility must not be confused with authorization. Access and publication permissions remain independently enforced.

## Consequences

The content model must distinguish playlist-level eligibility from per-entry eligibility and from playlist composition mode. Scene guards remain entirely scene-owned runtime behavior and are not duplicated as playlist eligibility rules.

## References

- [Content and playback model](../content-model.md)
- [Conditional playlist activation](D-028-conditional-playlist-activation.md)
- [Shared scene and playlist eligibility](D-030-scene-and-playlist-eligibility.md)

This decision records the intended model, not an implemented feature.
