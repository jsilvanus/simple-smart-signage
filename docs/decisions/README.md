# Decision register

This directory records architectural decisions for SiSSi. Keep entries short, explicit, and dated. Use `Proposed`, `Accepted`, `Superseded`, or `Rejected` as the status.

## Accepted

### D-044 — Complex-scene security model

- **Status:** Accepted architectural direction
- **Date:** 2026-10-16
- **Decision:** Use sandboxed authored scenes with explicit per-capability allowlists, layered authorization, risk-based publication review, profile-based resource budgets, and hybrid network access. Direct requests are limited to explicitly approved public/browser-accessible resources; privileged or credentialed requests use server-side SiSSi connectors. Enforce security in depth across browser, trusted display runtime and server. The MVP prioritizes browser sandboxing/CSP, host-validated bridge messages and server authorization; violation handling initially denies and continues or terminates, with severity-based escalation planned for 2.0. Serve scenes from the SiSSi server in an iframe sandbox without `allow-same-origin`, producing an opaque origin; validate this across supported runtimes before release. If reliable isolation cannot be demonstrated, use a dedicated scene origin without application session cookies. Do not ship untrusted scene execution before this security gate passes.
- **Rationale:** Keep AI-authored scenes useful without granting them authority over the player, tenant data or privileged services.
- **Reference:** [D-044](D-044-complex-scene-security-model.md) · [D-033](D-033-scene-actions-and-runtime-api.md) · [D-038](D-038-tenant-connectors-and-scene-variable-bindings.md)

### D-043 — First-class caption services and persistent caption layers

- **Status:** Accepted architectural direction
- **Date:** 2026-10-16
- **Decision:** Model caption services as reusable first-class objects, initially integrating LCYT through a provider-neutral caption-source contract. Keep source configuration separate from caption presentation and display target. Captions form a persistent auxiliary layer that survives main-playlist scene transitions, supporting overlays or reserved regions and per-display language/styling. Source outages must not interrupt base playback; credentials stay out of scenes and display-visible configuration. Exact schemas and LCYT connection semantics remain open.
- **Rationale:** Captions are essential on often-muted signage displays and have a lifecycle independent of ordinary playlist entries; separating source, presentation and target enables reuse and different languages/layouts across screens.
- **Reference:** [D-043](D-043-caption-services-and-persistent-caption-layer.md) · [LCYT](https://github.com/jsilvanus/live-captions-yt)

### D-033 — Declared scene actions and host-mediated runtime API

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Authored scenes run in an isolated iframe and communicate with the trusted player through a typed `postMessage` bridge exposed by `@sissi/scene-sdk`. The host validates message schemas, frame/source identity, scene revision, active occurrence, allowed operations, and authorization. The player retains authority over playback and privileged actions; iframe sandbox and origin configuration must be deliberately secured. Exact schemas and sandbox details remain to be specified.
- **Rationale:** Supports AI- and user-authored scenes without placing their code in the player's JavaScript environment, while preserving one versioned contract for lifecycle and permitted actions.
- **Reference:** [D-033](D-033-scene-actions-and-runtime-api.md) · [D-042](D-042-scene-sdk-and-api-versioning.md)


### D-042 — Scene SDK and API versioning

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Maintain `@sissi/scene-sdk` as a dedicated workspace package in the SiSSi monorepo. Use semantic versioning for the SDK and a separate `sceneApi` version for the scene-to-host contract. Pin the SDK for builds and bundle its implementation into published scenes; record SDK version for diagnostics and API version for host compatibility checks. The host remains authoritative and validates runtime messages.
- **Rationale:** Gives authored scenes one maintained contract and reproducible offline playback without forcing old scenes to be rebuilt for compatible SDK changes.
- **Reference:** [D-042](D-042-scene-sdk-and-api-versioning.md) · [D-033](D-033-scene-actions-and-runtime-api.md) · [D-041](D-041-scene-readiness-and-start-lifecycle.md)


### D-041 — Cache-first publication and scene readiness

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Push scene bundles and required assets to screens ahead of playback and cache/verify them locally. Every scene signals readiness after initialization; the host transitions only after that signal. The `start` hook is optional and is invoked after transition only for scenes that declare it and need explicit startup, such as a timeline or animation. The host provides a general preparation/readiness timeout, while a scene may declare a predefined longer timeout profile. The host enforces the effective hard deadline; scenes cannot reset it dynamically. On timeout, apply playlist policy and D-040 fallback. This extends the existing lifecycle/invocation contract in D-033. The playlist configuration determines which policy wins when duration, readiness, and scene completion conflict.
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
