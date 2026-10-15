# D-045 — Complex-scene security enforcement requirements

- **Status:** Accepted requirements; implementation details remain open
- **Date:** 2026-10-16
- **Scope:** Enforcement and release requirements supplementing D-044 for AI- or user-authored HTML/CSS/JavaScript scenes.
- **Relationship to D-044:** This document refines implementation-facing requirements without replacing or weakening D-044's accepted security architecture. D-044 remains authoritative for the trust model, isolation strategy, layered authorization, risk-based publication review, hybrid networking, resource recovery, and MVP violation responses.

## Accepted requirements

1. **Direct scene network access:** Use a per-scene destination allowlist bounded by tenant policy. Direct access is limited to approved public/browser-accessible resources; privileged or credentialed operations use server-side SiSSi connectors. A scene cannot broaden either its own allowlist or the tenant's policy.
2. **Content Security Policy:** Generate the scene's CSP from approved scene requirements and policy. The generated policy must be restrictive by default; scene-authored requirements are inputs to validation, not authority to weaken the policy. CSP generation does not replace iframe sandboxing or server-side authorization.
3. **Scene-to-player bridge:** Use typed message schemas with a generic extension payload for forward-compatible or product-specific data. The generic payload remains untrusted data and must not bypass schema validation, capability checks, operation allowlists, revision checks, or server authorization.
4. **Scene-instance binding:** Bind bridge messages to the actual iframe/window relationship and active scene instance, and include a per-instance nonce and sequence number. Reject messages that do not match the current instance or fail freshness/order validation; do not treat a nonce or sequence as a substitute for validating message content and authority.
5. **Bundle integrity and publication:** Bind content hashes for the scene bundle and required assets to the exact approved publication revision. The player must verify the locally cached content against the approved revision before treating it as a verified playable revision; a version label or HTTPS transport alone is insufficient.
6. **Offline playback and policy expiry:** Support a policy-based offline grace period. The grace policy determines whether an already verified, approved cached revision may continue to play while the server is unreachable; offline operation must not grant new permissions or silently extend approval beyond the configured policy.
7. **Connector SSRF protection:** Permit allowlisted connector hosts with validated dynamic paths. Validation must constrain the effective destination after URL parsing and redirects and must defend against private, loopback, link-local, and other prohibited destinations; host allowlisting alone is not sufficient if a path or redirect can change the destination.
8. **Runtime budgets:** Use platform-specific budgets and watchdogs because Android, Tizen, browser and WebView capabilities differ. The runtime must monitor enforceable limits and recover from hung or runaway scenes; exact budgets and mechanisms may differ by supported platform.
9. **Security logging:** For the MVP, keep minimal operational logs rather than detailed forensic telemetry. Logs should still record enough to diagnose denied privileged operations, scene termination, failed integrity/policy checks, and security-gate failures without recording secrets or unnecessary scene/user data.
10. **Release gate:** Require automated security tests plus a platform security matrix for every supported browser/WebView/runtime combination before enabling untrusted authored-scene execution. The matrix must include evidence for iframe isolation and opaque-origin behavior, CSP enforcement, bridge validation, cache integrity, network/connector controls, offline policy and runtime recovery.

## Implementation details still open

- The representation and matching rules for per-scene network destinations, including permitted schemes, ports, subdomains, resource types and how tenant policy intersects with a scene's requested destinations.
- The CSP generator's input schema, directive-merging rules, handling of inline scripts/styles and hashes/nonces, and how generated policies are tested against required scene features without weakening defaults.
- The exact bridge schema/versioning strategy and the safe shape, size limits and validation rules for the generic extension payload.
- The nonce generation and lifecycle, sequence-number semantics, duplicate/replay handling, and behavior when a scene is reloaded, prepared in the background, resumed or replaced.
- The manifest format, hash algorithm, canonicalization rules, asset inventory, revision binding and behavior when a cached asset is missing or mismatched.
- The offline grace-period configuration model, clock assumptions, renewal behavior, and handling of revocation or permission reduction while a device is offline.
- Connector URL canonicalization, DNS resolution/rebinding defenses, redirect policy, IP-range classification, proxy behavior and revalidation at connection time.
- Per-platform resource budgets, available measurement APIs, watchdog thresholds, termination behavior and last-good-frame/fallback behavior.
- The minimum event fields, retention period, access controls and redaction rules for operational security logs.
- The supported-platform test matrix, test harness, required evidence and owner/sign-off process for the security release gate.

## Related decisions

- [D-044 — Complex-scene security model](D-044-complex-scene-security-model.md)
- [D-033 — Declared scene actions and host-mediated runtime API](D-033-scene-actions-and-runtime-api.md)
- [D-038 — Tenant API connectors and scene variable bindings](D-038-tenant-connectors-and-scene-variable-bindings.md)
- [D-041 — Cache-first publication and scene readiness](D-041-scene-readiness-and-start-lifecycle.md)
- [D-042 — Scene SDK and API versioning](D-042-scene-sdk-and-api-versioning.md)
