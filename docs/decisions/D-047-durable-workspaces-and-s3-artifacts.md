# D-047 — Durable development workspaces and S3 artifact storage

- **Status:** Accepted architectural direction; checkpoint and recovery mechanics remain open
- **Date:** 2026-10-16

## Context

SiSSi needs persistent authoring workspaces for AI-assisted and manual scene development, while preview containers and validation/build executions are disposable. fffleet is the preferred candidate for suitable background jobs and may provide reusable execution infrastructure, but SiSSi retains ownership of workspaces, authorization, publication, and user-visible status.

## Decision

- Use PostgreSQL for authoritative session/workspace metadata and S3-compatible object storage for durable workspace snapshots and execution artifacts.
- Keep the live writable workspace on a filesystem suitable for interactive development. S3 is durable object storage, not the live working directory or a filesystem mounted directly into a running development container.
- For managed workspaces, create a durable checkpoint when a project is imported, periodically during an active session, and during planned shutdown. Checkpoint intervals, retention, and failure behavior remain configurable implementation details.
- **Ephemeral execution containers receive no durable host bind mounts or persistent host volumes and must not use the fffleet host as workspace storage.** Their writable layer/scratch is disposable and cleaned up with the execution environment; if the deployment requires that plaintext job data never touch host disks, use tmpfs or equivalent encrypted ephemeral scratch.
- A host-directory mount, if supported for a separate interactive development workflow, is an application-owned, separately authorized mode—not a feature to assume for fffleet's ephemeral job containers. The host directory remains the live source of truth in that separate mode, while S3 checkpoints are recovery copies.
- Use trusted services or short-lived, narrowly scoped object-storage transfer grants for uploads and downloads. Do not place permanent, broadly privileged S3 credentials inside an untrusted development or build container. Transfers must be authenticated, bounded, checksum-verified, and retryable. Inputs and outputs move through explicit transfers; durable host mounts/volumes are not a transfer mechanism.
- Keep container lifetime independent of workspace lifetime. Stopping, replacing, or losing a preview container must not delete a managed workspace. Reconcile session/container state after controller restarts and recover from the latest valid checkpoint when the live workspace is unavailable.
- Run validation and production builds as separate disposable isolated executions from controlled workspace snapshots. A successful preview or build is not, by itself, authorization to publish. Publication remains a separate review and permissioned workflow producing immutable scene revisions.
- Keep scene bundles separate from managed media assets as specified by D-036. Workspace snapshots, build outputs, bundles, and managed media assets are distinct object classes with explicit ownership, retention, and references.
- Treat PostgreSQL records and S3 objects as a coordinated recovery domain. Define and test backup/restore procedures that account for database point-in-time recovery, object availability, immutable artifact references, and consistency between metadata and objects.

## Rationale

This preserves interactive filesystem performance while enabling container replacement, restart recovery, controlled build inputs, and durable artifact handoff. It also avoids coupling SiSSi's application semantics to a specific container runtime or making the development container a storage authority.

## Open implementation details

- Checkpoint interval, debounce/coalescing, maximum checkpoint duration, and behavior when a checkpoint fails or overlaps shutdown.
- Snapshot consistency for active workspaces, including atomicity or a manifest/commit protocol for multi-file snapshots.
- S3 bucket/key layout, encryption, tenant isolation, versioning/immutability, quotas, retention, and lifecycle policies.
- Checksum and manifest format; incomplete-upload cleanup; multipart upload/resume; idempotency keys; retry and timeout policy.
- Restore selection and validation, recovery-point objectives, restore ordering with PostgreSQL PITR, orphan detection/garbage collection, and scheduled recovery drills.
- How host-mounted workspaces are checkpointed safely without implying that an ordinary live directory snapshot is atomic.
- Behavior during S3 outages, low storage quota, lost credentials, corrupt snapshots, and shutdown deadlines.
- Whether workspace snapshots use a full archive each time or a content-addressed/incremental object layout; choose based on measured size, cost, and recovery complexity.

## References

- [D-034 — Pluggable execution provider](D-034-pluggable-execution-provider.md)
- [D-035 — Preview lifecycle and staged scene MVP](D-035-preview-lifecycle-and-staged-scene-mvp.md)
- [D-036 — Separate scene bundles from managed assets](D-036-separate-scene-bundles-from-managed-assets.md)
- [D-046 — Shared job execution and SaarnaVideo export](D-046-shared-job-execution-and-saarnavideo-export.md)
- [fffleet](https://github.com/jsilvanus/fffleet)
