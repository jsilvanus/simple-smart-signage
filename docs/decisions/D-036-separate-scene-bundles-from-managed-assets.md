# D-036 — Separate scene bundles from managed assets

- **Status:** Accepted
- **Date:** 2026-10-15

## Decision

A published scene bundle contains the built scene application and a manifest of its dependencies; it does **not** embed the payloads of managed media assets. The manifest references managed assets by stable asset identity and an exact immutable version and/or content hash.

Scene bundles and managed assets have independent cache lifecycles. The same cached asset may be reused by multiple scenes and bundle revisions. Updating an asset creates a new version and must not mutate any published scene revision that pins an earlier version.

## Preparation and activation

When a client receives a new scene revision, it must:

1. Download and validate the bundle and its manifest.
2. Resolve and verify the pinned dependency list.
3. Download any missing required managed-asset versions, reusing verified cached versions where possible.
4. Activate the new revision only after the bundle and all required dependencies are verified and ready.

If any required step fails, the client retains its last-known-good active revision. Required and optional dependencies must be distinguishable in the manifest: required dependencies gate activation; optional dependencies may be deferred only where the scene has a defined fallback.

Managed assets are served through SiSSi's authorised asset-delivery mechanism. A URL alone is not a stable asset identity or version pin. External URLs, if supported, are declared separately as external dependencies and are not treated as managed, immutable assets; their availability and mutability must be considered in offline and reliability expectations.

## Rationale

This separates application code from reusable media, avoids duplicating large files in every scene bundle, supports cache reuse across scenes, and preserves deterministic publication, offline playback, and safe rollback.

## Consequences

- The bundle manifest records exact asset references, versions/hashes, and required/optional status.
- Bundle integrity and asset integrity are verified independently.
- Cache eviction must not remove dependencies still needed by active or retained rollback revisions, subject to an explicit retention policy.
- The precise manifest schema, cache-eviction algorithm, asset authorization flow, and external-dependency policy remain to be specified.

## References

- [Asset library and provenance](../asset-library.md)
- [Content creation and authoring](../creation-system.md)
- [Display runtime](../display-runtime.md)
- [Architecture planes and concepts](../architecture/planes-and-concepts.md)
