# D-046 — Shared job execution and SaarnaVideo export

- **Status:** Accepted architectural direction; integration contracts and implementation details remain open
- **Date:** 2026-10-16

## Decision

### Operations and infrastructure

- Reuse the existing Prometheus, Grafana, and Loki infrastructure for SiSSi metrics, dashboards, logs, and alerts; do not design a separate observability stack for the application.
- Plan for PostgreSQL with point-in-time recovery (PITR) and S3-compatible object storage. Recovery planning must cover the relationship between database records, immutable published artifacts, and object storage, and restoration must be tested.
- Keep SiSSi a modular application by default. Isolate expensive or risky work behind bounded background-job execution rather than splitting the application into microservices prematurely.

### Background work and fffleet

- Treat [fffleet](https://github.com/jsilvanus/fffleet) as the preferred existing candidate for dispatching and running suitable background work, beginning with media thumbnails and other FFmpeg/media transformations.
- Evaluate extending its use to other bounded jobs, including validation/build orchestration, rather than creating a second independent queue and worker system by default.
- Preserve D-034's execution-provider and isolation boundary: fffleet is a job-dispatch/worker substrate, not permission to run authored scene code with ordinary worker privileges. Untrusted scene validation/builds must run inside the approved isolated execution provider (Podman first), with constrained resources, filesystem access, and network access. A fleet worker may launch/manage that isolated job through a trusted wrapper; it must not execute arbitrary scene code directly in the worker's own security context.
- Keep application-owned job records, authorization, cancellation, audit, and user-visible status authoritative. Worker/fleet state is execution detail that SiSSi reconciles, including after worker or controller restarts.
- Use stable idempotency keys, bounded retries/timeouts, cancellation, and explicit artifact handoff. Publish validated immutable artifacts, not worker containers or temporary workspaces.

### SaarnaVideo integration

- Plan a first-party integration from [SaarnaVideo](https://github.com/jsilvanus/saarnavideo) to SiSSi so a user can export selected generated outputs directly into SiSSi's managed asset library.
- Candidate export types include rendered video, thumbnail, and caption sidecars where useful. Preserve relevant source/project provenance and metadata when supplied.
- Use authenticated server-to-server authorization or short-lived object-storage transfer grants; do not require assets to be publicly accessible and do not share application databases.
- Importing an output creates a managed SiSSi asset with verified content identity and normal tenant ownership/permissions. It does not automatically publish a scene, change a playlist, or assign a screen. Those remain explicit SiSSi workflows.
- Make transfers retryable and idempotent so interrupted exports do not create duplicate assets. The exact user experience, supported formats, metadata mapping, and API contract remain open.

## Rationale

Reuse proven infrastructure and existing media/job tooling, avoid duplicating worker orchestration, and connect SaarnaVideo to signage through a clear asset-import boundary. Keep trust, publication, and playback authority inside SiSSi.

## Open implementation details

- Which fffleet job types and pools SiSSi will use first, and how job ownership/status maps to SiSSi's application-level jobs.
- The trusted wrapper and exact resource/network policy for isolated scene builds and validation.
- S3 bucket/key layout, retention, immutable artifact manifests, and backup/restore procedures across PostgreSQL and object storage.
- SaarnaVideo-to-SiSSi authentication, tenant selection, export UI, supported output types, metadata/provenance mapping, upload/transfer protocol, retry semantics, and audit events.
- The initial metrics, dashboards, alerts, and log-retention policy using the existing Prometheus/Grafana/Loki stack.

## Related decisions

- [D-034 — Pluggable execution provider](D-034-pluggable-execution-provider.md)
- [D-035 — Preview lifecycle and staged scene MVP](D-035-preview-lifecycle-and-staged-scene-mvp.md)
- [D-036 — Separate scene bundles from managed assets](D-036-separate-scene-bundles-from-managed-assets.md)
- [D-043 — Caption services and persistent caption layer](D-043-caption-services-and-persistent-caption-layer.md)
