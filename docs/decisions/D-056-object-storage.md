# D-056 — Object storage

- **Status:** Accepted
- **Date:** 2026-10-19
- **Specification:** Partial. The interface and the deployment modes are decided. Bucket layout, retention and encryption are open.

## Decision

1. **One interface, S3-compatible.** Managed assets, scene bundles and workspace artifacts are stored through a single storage adapter that speaks the S3 API. The application does not write managed content to its own local disk. Local disk is only for transient scratch space.
2. **Three deployment modes**, selected by configuration:
   - **Development:** a `versitygw` container in the project's Docker Compose stack, providing an S3 endpoint on localhost.
   - **Production, provided outside the stack:** an S3-compatible endpoint that the operator runs or already has.
   - **Production, managed:** a real S3 service.
3. **Same code path in all three modes.** Tests run against the development container. No mode-specific branches in domain code.

## Open

- Bucket layout, key naming and the checksum and manifest format (D-036, D-047).
- Retention, backup and recovery objectives for buckets, and encryption at rest.
- Whether the MVP needs versioning in the bucket. Immutable versions are already modelled in the database (D-051), so bucket versioning is not assumed.

## Consequences

- The Prototype's first media upload goes through the adapter, so the Compose stack includes `versitygw` from the start.
- Object storage is not a special case in backups. Backup and restore are tested with the development container (plan Phase 5).

## References

- [D-047 Durable workspaces and S3 artifacts](D-047-durable-workspaces-and-s3-artifacts.md)
- [D-036 Separate scene bundles from managed assets](D-036-separate-scene-bundles-from-managed-assets.md)
- [D-051 Managed object lifecycle and version history](D-051-managed-object-lifecycle-and-version-history.md)
- [Asset library](../asset-library.md)
