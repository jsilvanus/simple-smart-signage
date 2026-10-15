# Decision register

This directory records architectural decisions for SiSSi. Keep entries short, explicit, and dated. Use `Proposed`, `Accepted`, `Superseded`, or `Rejected` as the status.

## Accepted

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
