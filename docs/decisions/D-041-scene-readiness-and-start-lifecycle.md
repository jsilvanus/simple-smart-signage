# D-041 — Cache-first publication and scene readiness

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Publishing a timeline pushes its scene bundles and required managed assets to assigned screens ahead of playback, potentially well in advance. The device caches and verifies the bundle first, then caches and verifies its required assets. Playback should normally use this prepared local content rather than fetch dependencies at transition time. A loading indicator is a fallback for cases where preparation or activation cannot proceed immediately.
- **Lifecycle contract:** This decision extends, and does not replace, the lifecycle and invocation contract in [D-033](D-033-scene-actions-and-runtime-api.md). The existing contract already distinguishes scene readiness and completion signals, close requests, scene-reported errors, and host-owned interruption/runtime outcomes. The scene must signal **Ready** after it has initialized enough to be presented; bundle and asset caching alone do not make it ready. The host transitions only after readiness, then starts the scene's active playback. The exact invocation mechanism and whether this is exposed as a callable `start` hook must be specified as part of the D-033 invocation contract, not treated as a separate universal scene action. Static scenes need not have a timeline.
- **Timeout policy:** The playlist configuration determines which policy wins when readiness or scene completion conflicts with the item's effective duration. Runtime behavior must follow that explicit playlist policy rather than imposing one universal rule.
- **Safety:** Never activate incomplete or invalid content. If readiness fails or times out, apply the configured playlist policy and the fallback behavior in [D-040](D-040-hybrid-playback-fallback-policy.md), preserving the last good display where possible.
- **Rationale:** Pre-caching makes playback reliable and transitions smooth, while explicit readiness and the existing lifecycle contract let static and time-driven scenes behave predictably.
- **Reference:** [D-033 — Declared scene actions and host-mediated runtime API](D-033-scene-actions-and-runtime-api.md) · [D-036 — Separate scene bundles from managed assets](D-036-separate-scene-bundles-and-managed-assets.md) · [D-037 — Minimal native media scenes and AI-authored templates](D-037-minimal-native-media-scenes-and-ai-authored-templates.md) · [D-039 — Background preparation and hybrid activation](D-039-background-preparation-and-hybrid-activation.md) · [D-040 — Hybrid playback fallback policy](D-040-hybrid-playback-fallback-policy.md) · [Display runtime](../display-runtime.md)

## Implementation notes

- Specify the callable interface and timing for the existing lifecycle signals/requests and host-controlled activation, including duplicate calls and error reporting.
- Define how the host distinguishes scene initialisation readiness from bundle/asset preparation readiness in status reporting.
- Define playlist policy options for duration expiry, scene completion, readiness timeout, and any maximum-runtime guard.
- Ensure prefetch/push scheduling can happen well ahead of playback and that asset cache pressure or a missed push is handled through the fallback policy.
