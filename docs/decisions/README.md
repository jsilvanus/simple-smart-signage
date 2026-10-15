# Decision register

This directory records architectural decisions for SiSSi. Keep entries short, explicit, and dated. Use `Proposed`, `Accepted`, `Superseded`, or `Rejected` as the status.

## Accepted

### D-041 — Cache-first publication and scene readiness

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Push scene bundles and required assets to screens ahead of playback and cache/verify them locally. The scene signals readiness after initialization; the host transitions only after that signal, then starts active playback. This extends the existing lifecycle/invocation contract in D-033; exact start-hook mechanics belong in that contract. The playlist configuration determines which policy wins when duration, readiness, and scene completion conflict.
- **Rationale:** Makes playback cache-first and transitions predictable while supporting both static and time-driven scenes.
- **Reference:** [D-041](D-041-scene-readiness-and-start-lifecycle.md) · [D-033](D-033-scene-actions-and-runtime-api.md) · [D-036](D-036-separate-scene-bundles-from-managed-assets.md) · [D-039](D-039-background-preparation-and-hybrid-activation.md) · [D-040](D-040-hybrid-playback-fallback-policy.md) · [Display runtime](../display-runtime.md)


### D-040 — Hybrid playback fallback policy

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** If the intended next item misses its readiness deadline, skip to another eligible, ready item only where playlist/schedule rules permit. Otherwise show the configured fallback scene; if that is unavailable, preserve the last good displayed frame where possible. Time-critical or explicitly scheduled content must not be displaced just because another item is ready.
- **Rationale:** Keeps playback moving while respecting scheduling and avoiding blank or broken displays.
- **Reference:** [D-040](D-040-hybrid-playback-fallback-policy.md) · [D-039](D-039-background-preparation-and-hybrid-activation.md) · [Content and playback model](../content-model.md) · [Display runtime](../display-runtime.md)


### D-039 — Background preparation and hybrid playlist activation

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** The runtime may prepare the next playlist item in the background without disturbing the current scene. Activation follows a hybrid policy: honour mandatory playlist/schedule timing with a configured fallback; otherwise wait for readiness up to a configurable maximum, then use the fallback. Never activate incomplete content; preserve the current/last-known-good display where possible.
- **Rationale:** Reduces transition gaps while preserving time-critical scheduling and safe failure behavior.
- **Reference:** [D-039](D-039-background-preparation-and-hybrid-activation.md) · [Content and playback model](../content-model.md) · [Display runtime](../display-runtime.md)


### D-038 — Tenant API connectors and scene variable bindings

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Use tenant-level API connectors with server-held credentials, configured requests, response mappings, and named variables. Reuse the `varfetch` core and LCYT connector model, adapted to SiSSi tenant permissions. Use `{{var}}` for interpolation, `{{connector.variable}}` for namespaced connector variables, and support `[alias]` as an additional reference form. Each use selects creation-time, build-time, or runtime resolution; variable syntax itself never triggers a fetch.
- **Rationale:** Provides consistent, secure API-backed data for AI-authored scenes, human-edited code, and structured inputs without exposing secrets to scene code.
- **Reference:** [D-038](D-038-tenant-connectors-and-scene-variable-bindings.md) · [LCYT connector model](https://github.com/jsilvanus/live-captions-yt/blob/main/docs/plans/plan_api_connectors_variables.md) · [varfetch](https://github.com/jsilvanus/varfetch)
