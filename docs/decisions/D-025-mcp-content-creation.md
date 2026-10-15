# D-025 — MCP v2 content creation, discovery, and edit proposals

- **Status:** Accepted architectural direction; exact schemas and tool/resource names remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi needs MCP-based content creation that works across tenants, supports both structured content and source editing, preserves provenance, and makes the difference between applied edits and unaccepted proposals unambiguous. MCP clients need both focused resources and a convenient way to inspect a complete scene context.

## Decision

### Tenant-aware discovery and identifiers

Provide search tools for scenes, templates, assets, and other relevant catalogue items. Search may span all tenants in which the signed-in user has access, but results must include the tenant's short human-readable code and enough identity information to disambiguate the result. Search must return only resources the caller is authorised to discover; knowing an ID or tenant code never grants access.

Each tenant has a case-insensitively unique short code of 1–6 lowercase alphanumeric characters. The code is for display and discovery, not authentication or authorization. Use an immutable internal tenant ID for canonical resource identity and authorization. If tenant codes can ever be changed, retain uniqueness and manage changes explicitly without changing resource identity. The six-character limit is a product constraint, not an assumption that a Git commit abbreviation is globally unique.

### Scene metadata and search

Scenes support rich searchable metadata, including a human-readable title and description, tags, intended use/purpose, relevant event or occasion, seasonal relevance or date window, optional event URL, and other useful contextual fields. Exact metadata schema and controlled vocabularies remain to be defined. Distinguish descriptive metadata from operational scheduling/time guards: metadata helps creators find and understand a scene and does not by itself determine playback eligibility.

Search tools support relevant filters and free-text queries, return tenant code and stable IDs, and use pagination/limits for large result sets. Search and metadata reads are permission-checked and tenant-isolated.

### Resources and URI strategy

Use MCP resources primarily for canonical readable state, with resource templates for parameterized object URIs. Use canonical URIs for mutable working objects and explicit versioned URIs for immutable released versions, published revisions, and fixed snapshots. Canonical URIs use stable internal identifiers rather than the short tenant code, so display-code changes do not break references. URI examples are a proposed convention, not an external API promise:

- `sissi://tenants/{tenantId}/scenes/{sceneId}`
- `sissi://tenants/{tenantId}/scenes/{sceneId}/content-schema`
- `sissi://tenants/{tenantId}/scenes/{sceneId}/content`
- `sissi://tenants/{tenantId}/scenes/{sceneId}/source/{file}`
- `sissi://tenants/{tenantId}/scenes/{sceneId}/history`
- `sissi://tenants/{tenantId}/scenes/{sceneId}/proposals`
- `sissi://tenants/{tenantId}/scenes/{sceneId}/proposals/{proposalId}`
- `sissi://tenants/{tenantId}/scenes/{sceneId}/revisions/{revisionId}`
- `sissi://tenants/{tenantId}/scenes/{sceneId}/dump`
- `sissi://tenants/{tenantId}/templates/{templateId}`
- `sissi://tenants/{tenantId}/assets/{assetId}`

Provide a read-only scene resource index at `sissi://tenants/{tenantId}/scenes/{sceneId}/resources` that lists all scene-linked resource URIs visible to the caller. Group entries by purpose and include type/relation, mutable or immutable status, current revision/version where relevant, and a concise description. Cover metadata, content schema/values, source files, template/design-system/palette references, assets, history, proposals, revisions, previews, and publication/deployment state where available. It is the one discovery point for scene-linked resources and must not disclose inaccessible resources.

Provide a scene-dump resource as a revision-stamped, read-only snapshot of the scene context, including its metadata, content schema and values, source-file summaries or source when requested and permitted, selected design-system/template references, relevant assets, current revision, and a summary of pending proposals. The dump must distinguish canonical working state from unaccepted proposals, respect permissions and size limits, and offer a way to retrieve large sections separately rather than silently truncating data. Reading a resource never mutates content.

### Tools and capabilities

Tools perform actions and queries. At minimum, define search tools for scenes, templates, and assets; scene creation (optionally from a released template version); structured content updates and repeatable-item management; asset upload/attachment; source editing; validation and preview requests; proposal review/application/discard; and human provenance correction. Prefer semantic operations over a tool per database CRUD endpoint. Structured content editing and HTML/CSS/JavaScript source editing are equally first-class capabilities, with the default scene source contract remaining `index.html`, `style.css`, and `script.js`. Publishing, design-system release, template release, and display assignment remain separate permissioned workflows.

### Editing mode and proposal stack

The scene editor exposes two modes: **MCP edits** and **MCP proposes**. The default is MCP edits. In MCP edits mode, authorized MCP changes are applied to the working draft immediately and recorded in history. In MCP proposes mode, MCP changes create proposal records and do not change canonical working state until explicitly accepted.

Proposals form an inspectable stack/list of separate change sets. Each proposal records its author/actor, creation time, base scene revision, intended targets, patch/change set, provenance, validation/preview status where available, and lifecycle status. Proposals may overlap. They must not silently overwrite one another or the canonical scene. A proposal can explicitly supersede or replace another selected proposal, but this relationship must be visible in the history. Otherwise proposals remain separate and are reviewed independently.

When a proposal is accepted, SiSSi checks whether its base revision and affected fields/source still match the current working state. If they do not, report a conflict and require explicit rebase/resolve or regeneration; never silently apply a stale patch. Applying a proposal creates a normal auditable edit transaction and a new working revision. Rejected, discarded, superseded, and applied proposals remain represented in the audit history according to retention policy. Acceptance applies edits to the draft only; it does not approve editorial review or publish to displays.

The effective editing mode is selected in the scene editor and is visible to the MCP workflow. The server must enforce the selected mode for the relevant authoring session/context; a caller must not be able to bypass proposal mode by merely changing a tool argument. The initial default is MCP edits unless the creator changes it.

### Provenance, permissions, and history

Every content mutation records provenance and a recoverable change transaction. Preserve origin categories and transformation lineage defined by D-021. Missing or unverifiable provenance remains unknown. Human correction of provenance is an explicit audited operation. Every resource read, search, and tool operation is tenant-scoped and authorization-checked; results include tenant codes for cross-tenant disambiguation without using the code as a security boundary.

## Consequences

- Clients can search across accessible tenants without conflating similarly named scenes.
- Canonical resource reads remain stable and distinct from proposed changes.
- The full scene dump supports clients that need one consolidated context while keeping focused resources available.
- Direct edits remain the default, but the author can switch the scene editor to proposal mode.
- Proposal conflicts, provenance, and auditability are first-class rather than hidden side effects.
- Exact schemas, paging semantics, resource MIME types, error codes, and the full MCP v2 contract still need specification.

## References

- [Content creation and authoring](../creation-system.md)
- [Tenancy, identity, authorization, and MCP OAuth](../access-control.md)
- [Asset library and provenance](../asset-library.md)
- [Decision register](README.md)
- [Roadmap](../plan.md)
