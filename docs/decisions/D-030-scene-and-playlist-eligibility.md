# D-030 — Shared scene and playlist display eligibility

- **Status:** Accepted architectural direction; exact schemas and evaluation semantics remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi needs content to become eligible or ineligible based on both time and external or internal conditions. A schedule that assigns a playlist to a screen is not the same as the playlist being eligible to run, and neither is the same as an individual scene being eligible for display.

## Decision

**Playlists and playlist entries have time/condition eligibility policies.** Scene entries and child-playlist entries can each be eligible or ineligible in the context of their containing playlist. The scene itself independently evaluates its own guards; playlist eligibility does not replace, duplicate, or configure scene-owned guards.

- **Playlist eligibility** answers whether a playlist may be selected/played now. Example: a service playlist is eligible during the service window and only while the livestream is active.
- **Scene-entry eligibility** answers whether a particular occurrence of a scene may be selected by its playlist now. Example: an announcement entry is selectable only between two dates, on weekdays, or while an API condition is true.
- **Element-level scene guards** remain distinct: they hide/show parts of a scene without making the whole scene ineligible.
- **Assignments and schedules** determine where and when a playlist is assigned. Assignment does not itself override playlist or scene eligibility.
- **Child-playlist-entry eligibility** controls whether a nested playlist may be selected by its parent. Playlist entries never bypass or take ownership of the scene's own guards.

## Evaluation and playback behavior

- Eligibility should use a shared policy/evaluation model so scenes and playlists can refer to the same reusable condition definitions where appropriate. External HTTP/API checks run on the server (see [D-028](D-028-conditional-playlist-activation.md)); clients receive resolved state, not connector credentials.
- Where a policy has multiple rules, define explicit AND/OR composition and time-zone semantics. Time windows must handle overnight ranges, daylight-saving transitions, and exceptions deliberately.
- If a scene entry is ineligible, skip it and consider the next eligible entry. The scene independently handles its own runtime guards. If no entry is eligible, follow an explicit playlist fallback/empty-state policy rather than looping forever.
- An ineligible playlist assignment must not displace a currently eligible assignment. Selection among multiple eligible playlists remains governed by explicit assignment precedence, priority, and schedule rules.
- A condition that is unknown, stale, times out, or errors must follow a configured policy; never silently coerce it to true or false. Record enough evaluation status to explain why content was or was not eligible.
- Eligibility is not a security boundary. Tenant/resource authorization, publishing/review permissions, and display-target permissions remain enforced independently.

## Consequences

- Playlist-level and entry-level eligibility must be distinct from scene-owned guards, which the scene evaluates independently.
- Playlist activation conditions from D-028 become part of playlist-level or playlist-entry eligibility, as appropriate.
- Exact schemas, shared condition references, fallback precedence, client/server responsibilities, and tests remain to be defined before implementation.

## References

- [Content and playback model](../content-model.md)
- [Conditional playlist activation](D-028-conditional-playlist-activation.md)
- [Special broadcast composition](D-029-special-broadcast-composition.md)
