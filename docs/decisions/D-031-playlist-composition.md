# D-031 — Screen and screen-group assignment queues

- **Status:** Accepted architectural direction; exact schema and selection semantics remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi needs to choose which reusable playlist should run on a screen or screen group based on schedules, conditions, priority, and fallback behavior. A separate playlist-of-playlists content type would duplicate responsibilities that naturally belong to the target's playlist assignments.

## Decision

A **screen or screen group has an assignment queue** that selects an active programme. A programme may itself be a **conditional sequence of reusable playlists**. This is a composition structure within the target's assignment, not a separate competing assignment queue. There is no need to treat the component playlists as independent screen assignments when they are intended to form one ordered programme.

- A playlist remains a reusable, ordered sequence of scene entries.
- A programme sequence contains playlist references, each with its own eligibility rules and explicit order. It evaluates these entries in order, skips ineligible playlists, and plays eligible playlists sequentially.
- A playlist reference can define a time window (for example, 09:00–18:00) and a run policy: loop continuously or complete a configured number of runs.
- When a finite run limit is reached, that playlist entry becomes ineligible for the remainder of that scheduled occurrence, even if its time window remains open. The sequence continues to the next eligible entry or follows its explicitly configured no-eligible-content behavior.
- Run counts are scoped to a defined schedule/sequence occurrence and reset behavior must be explicit. A new scheduled occurrence may reset the count; time-window boundaries, restart/reconnect, and manual intervention must not accidentally reset or increment it.
- Time/condition eligibility and ordering are separate: eligibility decides whether an entry can run; its order value decides where it sits in the sequence.
- Use an explicit integer order/sort key (for example, 10, 20, 30) with a deterministic tie-breaker or validation requiring unique order within a sequence.
- Each screen/group assignment can select a programme and can itself have time windows, conditions, priority, and explicit fallback/selection behavior.
- The assignment queue selects which programme is active for the target. It does not copy, merge, or mutate playlists.
- Screen groups are reusable targets. Per-screen assignments may override or refine group assignments according to explicit precedence rules.
- Playlist-level eligibility and assignment-level eligibility are distinct: the assignment says whether this playlist is a candidate for this target now; the playlist's own policy says whether the playlist itself may run.

## Evaluation and behavior

- Selection among multiple eligible screen/group assignments must be deterministic and observable, with reasons for selection and rejection.
- Each screen or screen group resolves one effective assignment schedule for a given local calendar date. A calendar-date schedule, when configured for that target and date, takes precedence over the weekday schedule; otherwise the applicable weekday schedule is used. The two schedules are exclusive and are never merged.
- A weekday schedule supplies the normal recurring pattern for its weekday. A calendar-date schedule is an exception for that date, useful for holidays and special services. Provide an explicit “copy schedule to date” operation that creates an independent copy; later edits to either schedule do not affect the other.
- The selected schedule represents the full 24-hour day. Uncovered time is off time unless an explicit assignment says otherwise. If a calendar-date schedule exists but contains gaps, those gaps remain off time; do not fill them from the weekday schedule.
- Within a conditional playlist sequence, evaluate entries in configured order; when multiple entries are eligible, the order defines which runs first. After a playlist completes, continue to the next eligible entry.
- Support a continuous-loop run policy and a finite run-count policy. Reaching the configured count makes the entry ineligible for the rest of that schedule/sequence occurrence, regardless of remaining time in its window.
- Define explicit behavior when multiple assignments match, none match, condition results are unknown/stale/errors, a playlist becomes ineligible while playing, a finite run limit is reached, or the sequence reaches its end. Off time must not be silently converted into fallback content.
- Preserve current playback state only where the applicable switching/override policy says to do so; ordinary playlist switching and special-broadcast interruption have distinct semantics.
- Evaluate external API conditions server-side; display clients receive resolved state, not credentials.
- Enforce tenant and display permissions independently of eligibility.

## Consequences

The content model, APIs, and editor should distinguish the 24-hour screen/group assignment schedule from conditional playlist sequences. Playlist-entry time windows and run limits determine eligibility; finite run limits exhaust an entry for the current occurrence. A playlist is authored and maintained once and can be referenced from many programmes.

## References

- [Content and playback model](../content-model.md)
- [Conditional playlist activation](D-028-conditional-playlist-activation.md)
- [Shared playlist and entry eligibility](D-030-scene-and-playlist-eligibility.md)

This decision records the intended model, not an implemented feature.
