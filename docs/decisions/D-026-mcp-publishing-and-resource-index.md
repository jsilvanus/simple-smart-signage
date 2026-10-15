# D-026 — Scene resource index and MCP publishing/deployment tools

- **Status:** Accepted architectural direction; exact schemas and tool names remain to be specified
- **Date:** 2026-10-15

## Decision

Expose a read-only scene resource index at `sissi://tenants/{tenantId}/scenes/{sceneId}/resources`. It lists every scene-linked resource URI the caller may discover, grouped by purpose, with type/relation, mutable-versus-immutable status, current version where relevant, and a short description. Include metadata, content schema/values, source files, template/design-system/palette references, assets, history, proposals, revisions, previews, and publication/deployment status where available. It complements the focused resources and full scene dump. Never disclose inaccessible URIs or cross-tenant resource existence.

Keep publishing and deployment separate from authoring. Provide explicit permission-checked MCP operations to:
- Publish a scene revision after required validation, editorial review, and target-screen review; pin exact source, design-system/overlay, and asset versions/hashes.
- Search/list and read playlists; create/edit playlists and ordered items, durations/transitions, playback policies, and time windows.
- Assign a playlist to a screen or screen group.
- Push/reconcile a selected playlist/assignment as desired state for clients, returning an operation ID and affected target summary.
- Inspect rollout state, per-client acknowledgement/synchronization, failures, last-seen revision, and diagnostics.
- Roll back to a known-good immutable scene, playlist, or assignment revision with explicit confirmation and audit history.

Keep permissions distinct for scene editing, editorial review, scene publication, playlist editing, target assignment, and deployment. Creating a scene does not imply publishing or changing playback. Re-check authorization and tenant isolation on every operation. A published revision, an accepted deployment request, and a client that has synchronized are distinct states; never claim that a push means every client has applied it.

Exact schemas, tool names, rollout state machine, confirmation policy, and rollback semantics remain to be specified.

## References

- [MCP v2 content creation](D-025-mcp-content-creation.md)
- [Content creation system](../creation-system.md)
- [Roadmap](../plan.md)
