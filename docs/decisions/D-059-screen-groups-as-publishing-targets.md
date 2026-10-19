# D-059 — Screen groups as publishing targets

- **Renumbered:** from D-028 on 2026-10-19 (D-028 is now the conditional-playlist decision only).
- **Scope:** 2.0, not MVP (see D-053).

- **Status:** Accepted architectural direction; exact schemas and conflict rules remain to be specified
- **Date:** 2026-10-15

## Context

Publishing should let an authorised operator assign programming to a set of screens in one operation, rather than repeating the same assignment for every device. Screen groups are a publishing/targeting concept, not a scene-authoring construct.

## Decision

Treat screen groups as first-class, tenant-scoped publishing targets with stable IDs, human-readable names, descriptions, and managed membership of individual screens. Example groups include foyer, sanctuary, hall, and all-screens. Names are labels, not identifiers or access credentials.

An authorised operator can assign a playlist to a screen group—for example, assign playlist ABC to the foyer group—and push/reconcile that assignment as desired state. The same publishing model supports assignment to a single screen. Group membership changes and assignment changes must be permission-checked and audited.

Resolve group assignments into effective per-screen desired state. Show which screens are included, excluded, offline, or otherwise ineligible, and report deployment status and client acknowledgement per screen. A successful group-level request must not imply every member has received or activated the playlist.

Define explicit precedence and conflict handling for overlapping group assignments, direct per-screen assignments, and any future scheduling rules before implementation. Do not silently choose a winner when two active assignments conflict. Changes to group membership must trigger reconciliation for affected screens. Tenant boundaries apply to groups, memberships, playlists, screens, and all operations.

## Consequences

- Playlist assignment can be managed centrally by location or function.
- Group membership is independent of playlist content and scene authoring.
- Publishing tools need group discovery, creation/editing of membership, assignment, preview of affected screens, deployment/reconciliation, and per-screen status.
- Exact data schemas, scheduling interactions, assignment precedence, and conflict UX remain to be specified.

## References

- [MCP publishing and scene resource index](D-026-mcp-publishing-and-resource-index.md)
- [Content and playback model](../content-model.md)
- [Access control](../access-control.md)
