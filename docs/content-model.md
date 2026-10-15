# Content and playback model

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Playlist-first programming, with reusable scenes and independent timing/availability rules.

## Core hierarchy

```text
Display assignment / schedule
└── Playlist
    ├── Playlist item ──> Scene revision
    ├── Playlist item ──> Scene revision
    └── Playlist item ──> Scene revision
                             ├── Content: hosted URL or bundle
                             ├── Internal presentation timeline
                             └── Availability rules
```

### Playlist

The playlist is the primary unit an administrator programs and assigns. It defines an ordered sequence of playlist items and an overall repeat/advance policy.

### Playlist item

A playlist item references a scene and defines how that scene is used in this playlist: effective playback duration, transition, and playback/end behavior. The same scene can appear multiple times, including with different durations and transitions.

### Scene and scene revision

A scene is a reusable unit of presentation content. It may be a hosted URL or a packaged bundle, and it may contain a static layout, animations, timed content changes, video, or other supported presentation behavior. A scene revision identifies an immutable version of its content and presentation definition. Content identity is separate from where and when it is used.

A scene may suggest a default playback duration. The playlist item determines the effective duration for a particular use.

### Scene timeline

The scene's internal timeline governs behavior inside the presentation: animation, revealing or replacing elements, and timed media. It is distinct from the playlist item's playback slot. A scene may loop, play once and hold, remain static, or signal completion; exact supported modes and completion semantics require an explicit runtime contract.

### Scene availability

A scene may have availability restrictions, such as weekdays between 07:00 and 11:00 in the Europe/Helsinki time zone. Availability determines whether the scene is eligible for selection; it is not the same as its internal timeline or playback duration.

Availability may be defined on the scene and further narrowed by a playlist item. A playlist item must not silently override a scene's restrictions. Exact rule composition, exceptions, overnight windows, daylight-saving transitions, clock uncertainty, and no-eligible-scene fallback must be specified before implementation.

If a scene becomes unavailable during playback, the runtime should stop presenting it at the boundary and advance to eligible content. The runtime should avoid blanking the display while preparing a replacement.

### Schedule and display assignment

A schedule/assignment determines which playlist is active on a display or display group and during which calendar periods. It does not own the internal timeline of a scene or the duration of an individual playlist item.

## Time ownership

| Time concept | Owner | Purpose |
|---|---|---|
| Internal timeline | Scene revision/runtime | Animation and timed changes within the presentation |
| Playback slot | Playlist item | How long this playlist occurrence is shown |
| Calendar eligibility | Scene availability rule | When a scene may be selected |
| Playlist activation | Schedule/assignment | When a playlist is active on a display |

## Delivery and offline behavior

Hosted URL and bundle scenes should share a defined lifecycle contract: prepare, ready, start, stop, and optionally completion. A hosted scene may depend on network resources; a bundle should be downloaded and verified before activation and should support offline playback to the extent that its declared dependencies permit. Failed downloads or preparation must not displace the last known-good content.

This document records the accepted domain model, not a finished API schema or implemented feature. Phase 1 must define exact schemas, conflict rules, lifecycle events, validation, and error behavior before implementation.
