# D-041 — Scene readiness and start lifecycle

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Publishing a timeline pushes its scene bundles and required managed assets to assigned screens ahead of playback, potentially well in advance. The device caches and verifies the bundle first, then caches and verifies its required assets. Playback should normally use this prepared local content rather than fetch dependencies at transition time. A loading indicator is a fallback for cases where preparation or activation cannot proceed immediately.
- **Lifecycle:** Every scene must signal readiness to the host by invoking its `ready` function once it has initialised enough to be displayed. The host waits for that signal before transitioning to the scene. After the transition, the host invokes `start` for scenes that define it; scenes with timelines or other start-dependent behaviour use this hook to begin playback. Simple static scenes may need no start hook.
- **Timeout policy:** The playlist configuration determines which policy wins when readiness or scene completion conflicts with the item's effective duration. Runtime behavior must follow that explicit playlist policy rather than imposing one universal rule.
- **Safety:** A scene is not ready merely because its bundle and assets are cached; it must also initialise and signal readiness. Never activate incomplete or invalid content. If readiness fails or times out, apply the configured playlist policy and the fallback behavior in [D-040](D-040-hybrid-playback-fallback-policy.md), preserving the last good display where possible.
- **Rationale:** Pre-caching makes playback reliable and transitions smooth, while an explicit lifecycle contract lets both static and time-driven scenes behave predictably.
- **Reference:** [D-036 — Separate scene bundles from managed assets](D-036-separate-scene-bundles-from-managed-assets.md) · [D-037 — Minimal native media scenes and AI-authored templates](D-037-minimal-native-media-scenes-and-ai-authored-templates.md) · [D-039 — Background preparation and hybrid activation](D-039-background-preparation-and-hybrid-activation.md) · [D-040 — Hybrid playback fallback policy](D-040-hybrid-playback-fallback-policy.md) · [Display runtime](../display-runtime.md)

## Implementation notes

- Define the exact callable interface and timing for `ready` and optional `start`, including error reporting and duplicate calls.
- Define how the host distinguishes scene initialisation readiness from bundle/asset preparation readiness in status reporting.
- Define playlist policy options for duration expiry, scene completion, readiness timeout, and any maximum-runtime guard.
- Ensure prefetch/push scheduling can happen well ahead of playback and that asset cache pressure or a missed push is handled through the fallback policy.
