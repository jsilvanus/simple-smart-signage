# D-051 — Managed object lifecycle and version history

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

SiSSi manages individual objects such as scenes, layouts, assets, and other reusable definitions. Object lifecycle must remain distinct from the content lifecycle that composes object versions into consumable, published content and distributes it to signage clients.

Objects need stable identity, immutable history, explicit archival, and controlled permanent deletion. API, CLI, MCP, and other interfaces must agree on these semantics.

## Decision

### 1. Object lifecycle is deliberately limited

The managed object lifecycle consists of:

1. **Create** — establish a stable object ID and its initial version.
2. **Version control** — create and retain immutable versions, inspect history, compare versions, and restore earlier contents by creating a new version.
3. **Archive** — mark the logical object as archived and initiate the required rollout/reconciliation of affected operational state.
4. **Garbage collection** — permanently delete eligible archived objects and associated version data only under explicit retention and dependency rules.

Review, content preparation, publication, distribution, activation, and playback belong to separate workflows, not to the core object lifecycle.

### 2. Stable identity and immutable versions

- An object's ID identifies the logical object across its lifetime.
- Every successful save creates a new immutable version; it never mutates an existing version.
- Versions use a monotonically increasing integer sequence scoped to each object, starting at 1. Version numbers are never reused or moved backwards.
- The object exposes its latest saved version. Saving a version does not, by itself, imply review approval, publication, or deployment.
- A restore operation copies the contents of a specified historical version into a newly created next version. Historical versions are never overwritten.
- A version may record the version it was restored from, where applicable.
- Concurrent saves must not silently overwrite newer work. The API should support an expected-base-version/precondition and reject stale writes.

### 3. Version provenance metadata

Every version records the following metadata:

- `version`: its monotonically increasing integer.
- `timestamp`: server-assigned creation time in UTC.
- `user`: the authenticated user or service principal responsible for the operation.
- `tool`: a controlled value identifying the actual entry point: `mcp`, `cli`, `ui`, `api`, or `system`.
- `provenance`: information about the origin and lineage of the version's contents.

Metadata must not be fabricated when unknown; unknown or unavailable values are represented explicitly. The server, not the caller, assigns the timestamp and version number. Version-creation provenance (who/what made the change and through which entry point) is distinct from content provenance (where content originated and how it was transformed). Corrections to content provenance are versioned changes, preserving history.

### 4. Version references and API/MCP responses

- Whenever an API, CLI, or MCP response returns an object reference or object result, it must include both `id` and `version`. The pair identifies the exact version returned; the ID alone identifies the logical object.
- Relationships and published content must pin exact versions wherever reproducibility requires it.
- Historical reads return the requested version and never silently substitute the latest version.
- Expose version history as readable API/MCP resources, using the same canonical API/domain behavior as other interfaces. The resource pattern is:
  - `sissi://<type>/<id>` — latest saved version of the logical object.
  - `sissi://<type>/<id>/versions` — paginated version history and metadata.
  - `sissi://<type>/<id>/versions/<version>` — exact immutable version.
- Version-history entries include the object ID and version plus the required version provenance metadata. Resource reads remain subject to current authorization and tenant boundaries.
- MCP resources are read-only. Restoring a version is an explicit action that creates a new version.
- Version-history listing should support pagination.

### 5. Archival and restoration

- Archival is a reversible lifecycle state of the logical object, not permanent deletion.
- Archiving sets `archived: true` and initiates rollout/reconciliation of the consequences for affected content and operational state. The archive operation does not itself publish a content release or assert that every device has completed the rollout.
- Restoring an archived object clears the archived state and initiates the appropriate reconciliation. Restoration does not bypass any separate validation, review, or publication requirements.
- Reading an object by ID, including an archived object, is permitted when the caller is authorized. Discovery/search supports an explicit archived filter; normal search behavior is defined by the API contract.
- Ordinary CRUD/MCP operations do not permanently delete objects.

### 6. Garbage collection

Permanent deletion is a separate, controlled garbage-collection process, not an ordinary object CRUD operation or MCP tool. Eligibility and execution must respect dependency references, published content that pins historical versions, retention requirements, and required audit/history records. Garbage collection must not remove data still needed to reproduce or consume retained published content.

### 7. Object lifecycle is separate from content lifecycle

Saving an object version does not automatically publish it or roll it out to devices. The content lifecycle composes and prepares specific object versions, validates and reviews the resulting content, publishes immutable consumable releases, and handles distribution/activation. An object archive can trigger reconciliation because it affects availability, but archival and rollout completion are distinct events.

## Consequences

- Object history is auditable and reproducible without destructive rewinds.
- Consumers can identify the exact version returned or referenced.
- Review approval and published releases can bind to exact versions without being confused with the latest saved version.
- API, CLI, and MCP share object semantics; MCP exposes history as resources and uses explicit actions for state changes.
- The exact schemas, retention periods, dependency-aware garbage-collection algorithm, and detailed rollout policies remain implementation/API-contract work.
