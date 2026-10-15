# D-041 — Cache-first publication and scene readiness

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Publishing a timeline pushes its scene bundles and required managed assets to assigned screens ahead of playback, potentially well in advance. The device caches and verifies the bundle first, then caches and verifies its required assets. Playback should normally use this prepared local content rather than fetch dependencies at transition time. A loading indicator is a fallback for cases where preparation or activation cannot proceed immediately.
- **Lifecycle contract:** This decision extends, and does not replace, the lifecycle and invocation contract in [D-033](D-033-scene-actions-and-runtime-api.md). Every scene must implement the **ready** contract and signal readiness after it has initialized enough to be presented; bundle and asset caching alone do not make it ready. The host transitions only after readiness. **start is optional**: after the transition, the host invokes it when the scene declares it and has work that must explicitly begin at that point, such as starting a timeline or animation. A scene that does not declare start can begin its ordinary presentation without that hook. Scene-specific functions remain declared by the scene; this does not establish a separate universal action list. Static scenes need not have a timeline.
- **Timeout policy:** The playlist configuration determines which policy wins when readiness or scene completion conflicts with the item's effective duration. Runtime behavior must follow that explicit playlist policy rather than imposing one universal rule.
- **Safety:** Never activate incomplete or invalid content. If readiness fails or times out, apply the configured playlist policy and the fallback behavior in [D-040](D-040-hybrid-playback-fallback-policy.md), preserving the last good display where possible.
- **Rationale:** Pre-caching makes playback reliable and transitions smooth, while explicit readiness and an optional start hook let static and time-driven scenes behave predictably.
- **Reference:** [D-033 — Declared scene actions and host-mediated runtime API](D-033-scene-actions-and-runtime-api.md) · [D-036 — Separate scene bundles from managed assets](D-036-separate-scene-bundles-from-managed-assets.md) · [D-037 — Minimal native media scenes and AI-authored templates](D-037-minimal-native-media-scenes-and-ai-authored-templates.md) · [D-039 — Background preparation and hybrid activation](D-039-background-preparation-and-hybrid-activation.md) · [D-040 — Hybrid playback fallback policy](D-040-hybrid-playback-fallback-policy.md) · [Display runtime](../display-runtime.md)



## Readiness timeout configuration

- The host provides a general default preparation/readiness timeout.
- A scene may declare a predefined scene-specific timeout profile when it needs more preparation time. The effective timeout is resolved from the applicable host/runtime and scene configuration; a scene cannot extend or reset its deadline dynamically while running.
- Preparation may take longer for scenes that genuinely need it. Their declared timeout should allow the expected preparation period plus an appropriate grace period for readiness to be reported. The expected preparation duration and the hard readiness deadline are conceptually distinct, even if the initial implementation exposes them as one configured timeout value.
- The host enforces the effective hard deadline. If the scene has not signalled `ready` by then, readiness fails and the existing playlist policy and D-040 fallback behavior apply. A scene must never block playback indefinitely.
- The readiness deadline ends when readiness is accepted. Hangs or failures after readiness belong to separate runtime-health and active-playback handling, not the preparation timeout.
- Exact timeout fields, allowed values, and precedence rules remain implementation details to specify.

## Implementation notes

- Specify the callable interface and timing for the existing lifecycle signals/requests and host-controlled activation, including duplicate calls and error reporting.
- Define how the host distinguishes scene initialisation readiness from bundle/asset preparation readiness in status reporting.
- Define playlist policy options for duration expiry, scene completion, readiness timeout, and any maximum-runtime guard.
- Ensure prefetch/push scheduling can happen well ahead of playback and that asset cache pressure or a missed push is handled through the fallback policy.
