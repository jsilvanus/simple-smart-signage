# D-031 — Screen and screen-group assignment queues

- **Status:** Accepted architectural direction; exact schema and selection semantics remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi needs to choose which reusable playlist should run on a screen or screen group based on schedules, conditions, priority, and fallback behavior. A separate playlist-of-playlists content type would duplicate responsibilities that naturally belong to the target's playlist assignments.

## Decision

A **screen or screen group has an assignment queue** of candidate playlist assignments. There is no separate playlist-of-playlists content type in this model.

- A playlist remains a reusable, ordered sequence of scene entries.
- Each scene entry can have its own time window and condition policy; ineligible entries are skipped. The scene itself independently handles its internal guards.
- Each playlist assignment in a screen/group queue can have time windows, conditions, priority, and explicit selection/fallback behavior.
- The queue selects which eligible playlist is active for the target. It does not copy, merge, or mutate playlists.
- Screen groups are reusable targets. Per-screen assignments may override or refine group assignments according to explicit precedence rules.
- Playlist-level eligibility and assignment-level eligibility are distinct: the assignment says whether this playlist is a candidate for this target now; the playlist's own policy says whether the playlist itself may run.

## Evaluation and behavior

- Selection among multiple eligible assignments must be deterministic and observable, with reasons for selection and rejection.
- Define explicit behavior when multiple assignments match, none match, condition results are unknown/stale/errors, or the selected playlist becomes ineligible while playing.
- Preserve current playback state only where the applicable switching/override policy says to do so; ordinary playlist switching and special-broadcast interruption have distinct semantics.
- Evaluate external API conditions server-side; display clients receive resolved state, not credentials.
- Enforce tenant and display permissions independently of eligibility.

## Consequences

The content model, APIs, and editor should expose assignment queues as a screen/group programming concept, not as nested playlists. A playlist is authored and maintained once and can be referenced from many queues.

## References

- [Content and playback model](../content-model.md)
- [Conditional playlist activation](D-028-conditional-playlist-activation.md)
- [Shared playlist and entry eligibility](D-030-scene-and-playlist-eligibility.md)

This decision records the intended model, not an implemented feature.
