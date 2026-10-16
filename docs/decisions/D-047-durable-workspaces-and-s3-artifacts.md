# D-047 — Durable development workspaces and S3 artifact storage

- **Status:** Accepted architectural direction; checkpoint and recovery mechanics remain open
- **Date:** 2026-10-16

## Context

SiSSi needs persistent authoring workspaces for AI-assisted and manual scene development, while preview containers and validation/build executions are disposable. fffleet is the preferred candidate for suitable background jobs and may provide reusable execution infrastructure, but SiSSi retains ownership of workspaces, authorization, publication, and user-visible status.

## Decision

- Use PostgreSQL for authoritative session/workspace metadata and S3-compatible object storage for durable workspace snapshots and execution artifacts.
- Keep the live writable workspace on a filesystem suitable for interactive development. S3 is durable object storage, not the live working directory or a filesystem mounted directly into a running development container.
- For managed workspaces, create a durable checkpoint when a project is imported, periodically during an active session, and during planned shutdown. Checkpoint intervals, retention, and failure behavior remain configurable implementation details.
- A checkpoint is valid only after its complete object set and manifest have been uploaded and verified. A partial or failed checkpoint must never replace the last known-valid checkpoint. Restore a complete, internally consistent snapshot; do not reconstruct a workspace by mixing files from different checkpoints. The UI and APIs must distinguish edits that are durably checkpointed from edits that are still pending or whose checkpoint failed.
- **Ephemeral execution containers receive no durable host bind mounts, persistent host volumes, or other durable storage backed by the fffleet host, and must not use the fffleet host as workspace storage.** Job scratch is disposable and must be destroyed with the execution environment. Encryption alone does not make disk-backed scratch ephemeral. If a deployment requires job data not to persist on host disks, use a verified memory-backed scratch mechanism (such as tmpfs) or another mechanism whose non-persistence properties have been demonstrated; do not treat encrypted disk storage as equivalent.
- A persistent authoring workspace is a separate, explicitly managed resource. It must not become persistent merely because a disposable builder or worker happens to retain a writable layer, cache, bind mount, or volume.
- A host-directory mount, if supported for a separate interactive development workflow, is an application-owned, separately authorized mode—not a feature to assume for fffleet's ephemeral job containers. The host directory remains the live source of truth in that separate mode, while S3 checkpoints are recovery copies.
- Use trusted services or short-lived, narrowly scoped object-storage transfer grants for uploads and downloads. Do not place permanent, broadly privileged S3 credentials inside an untrusted development or build container. Transfers must be authenticated, bounded, checksum-verified, and retryable. Scope authorization to the owning tenant and workspace/artifact. Treat uploaded archives and file trees as untrusted: reject path traversal and handle symlinks without allowing writes or reads outside the authorized workspace. Inputs and outputs move through explicit transfers; durable host mounts/volumes are not a transfer mechanism.
- Keep container lifetime independent of workspace lifetime. Stopping, replacing, or losing a preview container must not delete a managed workspace. Reconcile session/container state after controller restarts and recover from the latest valid checkpoint when the live workspace is unavailable.
- Run validation and production builds as separate disposable isolated executions from controlled workspace snapshots. A successful preview or build is not, by itself, authorization to publish. Publication remains a separate review and permissioned workflow producing immutable scene revisions.
- Keep scene bundles separate from managed media assets as specified by D-036. Workspace snapshots, build outputs, bundles, and managed media assets are distinct object classes with explicit ownership, retention, and references.
- Treat PostgreSQL records and S3 objects as a coordinated recovery domain. Define and test backup/restore procedures that account for database point-in-time recovery, object availability, immutable artifact references, and consistency between metadata and objects. PostgreSQL PITR and S3 versioning alone do not guarantee a mutually consistent recovery point; define and test the recovery procedure, including how incomplete uploads and orphaned objects are handled.

## Rationale

This preserves interactive filesystem performance while enabling container replacement, restart recovery, controlled build inputs, and durable artifact handoff. It also avoids coupling SiSSi's application semantics to a specific container runtime or making the development container a storage authority.

## Open implementation details

- Checkpoint interval, debounce/coalescing, maximum checkpoint duration, and behavior when a checkpoint fails or overlaps shutdown.
- Snapshot consistency for active workspaces, including the atomic snapshot mechanism or manifest/commit protocol for multi-file snapshots.
- Exact user-visible checkpoint states and retry behavior after a checkpoint failure.
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
