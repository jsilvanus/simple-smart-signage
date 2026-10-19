# D-058 — Private asset access in sandboxed scenes

- **Status:** Accepted
- **Date:** 2026-10-19
- **Specification:** Partial. The mechanism is decided. Lifetimes, signing keys and revocation timing are open.

## Decision

1. **Short-lived signed URLs.** Managed assets, scene bundles and their dependencies reach a sandboxed scene only through URLs signed by the server. Each URL is bound to one asset version or bundle revision and expires quickly.
2. **No cookies or bearer tokens inside the scene.** A scene runs in an iframe without `allow-same-origin`, so it has an opaque origin and receives no cookies. Credentials are never passed to scene code (D-044, D-045).
3. **Authorisation at signing time.** The server checks tenant, resource and display grants before it signs a URL. It does not sign URLs for a revoked device or grant.
4. **Public embeds** use the same signing path with a separate, explicitly configured public policy. A UUID is never the access control.

## Open

- Signed-URL lifetime for playback. It must outlast a scene's readiness and playback window, and it must be refreshable without reloading the scene.
- Signing-key rotation and how old keys are retired.
- Revocation timing. A revoked grant should stop new URL issuance immediately. Behaviour for URLs already issued is to be specified.
- The packaged kiosk case, where bundles are cached offline and URLs have expired.

## Consequences

- Scene bundles that must work offline are verified by hash on the device (D-036), and the signed URL is only needed to fetch them.
- The security gate for untrusted scenes (1.1) includes tests that a scene cannot read a cookie or a device credential and cannot use an expired or foreign URL.

## References

- [D-044 Complex-scene security model](D-044-complex-scene-security-model.md)
- [D-045 Complex-scene security enforcement](D-045-complex-scene-security-enforcement.md)
- [Creation system](../creation-system.md)
- [D-036 Separate scene bundles from managed assets](D-036-separate-scene-bundles-from-managed-assets.md)
