# D-030 — Shared scene and playlist display eligibility

- **Status:** Accepted architectural direction; exact schemas and evaluation semantics remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi needs content to become eligible or ineligible based on both time and external or internal conditions. A schedule that assigns a playlist to a screen is not the same as the playlist being eligible to run, and neither is the same as an individual scene being eligible for display.

## Decision

Both **playlists and scenes have first-class display-eligibility policies**. Each policy may include time windows and condition rules. These policies are evaluated independently at their own scope and combined with assignment/schedule rules; they do not mutate playlist contents or immutable scene revisions.

- **Playlist eligibility** answers whether a playlist may be selected/played now. Example: a service playlist is eligible during the service window and only while the livestream is active.
- **Scene eligibility** answers whether a particular scene occurrence may be displayed now. Example: an announcement scene is eligible only between two dates, on weekdays, or while an API condition is true.
- **Element-level scene guards** remain distinct: they hide/show parts of a scene without making the whole scene ineligible.
- **Assignments and schedules** determine where and when a playlist is assigned. Assignment does not itself override playlist or scene eligibility.
- **Playlist-item settings** may add narrower contextual restrictions, but cannot bypass a scene's eligibility policy.

## Evaluation and playback behavior

- Eligibility should use a shared policy/evaluation model so scenes and playlists can refer to the same reusable condition definitions where appropriate. External HTTP/API checks run on the server (see [D-028](D-028-conditional-playlist-activation.md)); clients receive resolved state, not connector credentials.
- Where a policy has multiple rules, define explicit AND/OR composition and time-zone semantics. Time windows must handle overnight ranges, daylight-saving transitions, and exceptions deliberately.
- A scene that becomes ineligible during playback should be stopped and replaced by the next eligible playlist item without unnecessarily blanking the display. If no scene in a playlist is eligible, the player follows an explicit playlist fallback/empty-state policy rather than looping forever or showing ineligible content.
- An ineligible playlist assignment must not displace a currently eligible assignment. Selection among multiple eligible playlists remains governed by explicit assignment precedence, priority, and schedule rules.
- A condition that is unknown, stale, times out, or errors must follow a configured policy; never silently coerce it to true or false. Record enough evaluation status to explain why content was or was not eligible.
- Eligibility is not a security boundary. Tenant/resource authorization, publishing/review permissions, and display-target permissions remain enforced independently.

## Consequences

- Scene-level time guards should be formalized as the time-capable part of scene display eligibility, while element-level guards remain presentation logic.
- Playlist activation conditions from D-028 become one part of playlist eligibility rather than a separate competing mechanism.
- Exact schemas, shared condition references, fallback precedence, client/server responsibilities, and tests remain to be defined before implementation.

## References

- [Content and playback model](../content-model.md)
- [Conditional playlist activation](D-028-conditional-playlist-activation.md)
- [Special broadcast composition](D-029-special-broadcast-composition.md)
