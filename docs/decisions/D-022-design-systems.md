# D-022 — Shared design systems and hybrid version pinning

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15

## Context

SiSSi scenes need reusable visual rules that can be edited by humans and MCP-connected tools, shared across scenes, and changed over time without making already published signage change unexpectedly. A single unstructured global CSS file would make it difficult to support several visual identities, structured editing, and deterministic published output.

## Decision

Treat a design system as a shared, versioned resource containing structured visual tokens, CSS rules, optional component conventions, and versioned asset references. Multiple systems may coexist, and each scene explicitly selects one primary system. The initial model does not combine multiple full design systems in a single scene; scene-specific CSS may deliberately extend or override the selected system.

The design-system model distinguishes SiSSi platform defaults, the selected design system, and scene-specific styles. CSS is the implementation layer for much of the design system, but the system is not merely a single global CSS file.

**Editing model:** support both structured editing and advanced CSS editing. Both edit the same underlying resource. Structured controls cover common tokens and supported assets; advanced CSS handles custom styling. CSS custom properties should be used for shared tokens where practical. Changes that cannot be parsed or represented safely must be preserved as advanced rules, and conflicts must be surfaced rather than silently discarding either side. Validate changes and record meaningful edits in the Action log.

**Scene update model:** use hybrid versioning. Draft scenes follow the selected design system's current working version and show its changes in preview. Publishing resolves that mutable reference to a specific immutable released version and pins the exact design-system version and asset versions/hashes in the published scene revision. Published revisions and cached bundles do not change when the design system is edited. To apply an update to a published scene, create and review a new scene revision, then publish it.

Design systems are independent of scene internals. The scene builder owns the scene's markup, logical pages, navigation, and behavior; the design-system layer supplies visual rules and assets.

## Consequences

- The authoring UI and MCP tools need design-system discovery, structured inspection/editing, CSS access, preview, validation, and release/version operations.
- Scene authoring must display the selected system and its version-following or pinning state.
- System changes must be traceable and affected drafts/revisions identifiable.
- Publishing must record exact immutable design-system and asset dependencies in the scene manifest.
- Retired systems cannot be deleted while retained published revisions still depend on their released versions.
- Exact token schemas, CSS conflict handling, release permissions, and retention rules remain implementation details to specify.

## Alternatives considered

- **One global CSS file:** rejected because multiple design systems need independent identity, scope, assets, and versions.
- **Structured controls only:** rejected because advanced creators need direct CSS control.
- **CSS-only editing:** rejected because common design changes should be accessible without requiring code editing.
- **Live design-system reference in published scenes:** rejected because it would make released signage change unpredictably and undermine deterministic/offline playback.
- **Pin every version during draft authoring:** rejected as the default because it would make iterative design-system work cumbersome; published revisions still pin exact versions.
- **Multiple full systems layered into one scene:** deferred because token precedence and component conflicts would be ambiguous for the initial contract.

## References

- [Design systems](../design-systems.md)
- [Content creation and authoring](../creation-system.md)
- [Asset library and provenance](../asset-library.md)
- [Roadmap](../plan.md)
