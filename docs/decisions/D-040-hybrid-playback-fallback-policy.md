# D-040 — Hybrid playback fallback policy

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** If the intended next playlist item misses its readiness deadline, the runtime uses a hybrid fallback policy. It may skip to another eligible, ready item when doing so is permitted by playlist and schedule rules. If no such item can be used, show the configured fallback scene. If no fallback scene is available or it cannot be prepared, preserve the last good displayed frame where possible.
- **Scheduling boundary:** A ready item must not displace time-critical or explicitly scheduled content merely because it is available sooner. Eligibility, schedule priority, and skip permission must be evaluated before selecting an alternate item.
- **Safety:** Never activate incomplete or invalid content. Failure of preparation, activation, or fallback must not intentionally replace a good display with a broken scene.
- **Rationale:** Keeps ordinary playback moving while respecting scheduled content and avoiding blank or broken displays during failures.
- **Reference:** [D-039 — Background preparation and hybrid activation](D-039-background-preparation-and-hybrid-activation.md) · [Content and playback model](../content-model.md) · [Display runtime](../display-runtime.md)

## Implementation notes

- Define how a playlist or schedule marks an item as skippable, mandatory, or time-critical.
- Define how the runtime chooses among multiple eligible, ready alternatives without violating order or schedule boundaries.
- A frozen last frame is a best-effort fallback; the runtime should preserve it only while the display surface remains available and should not promise persistence across process/device failure.
