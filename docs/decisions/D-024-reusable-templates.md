# D-024 — Reusable content templates

- **Status:** Accepted architectural direction; detailed schemas and update workflow remain to be specified
- **Date:** 2026-10-15

## Context

Many signage updates are routine: a creator needs a familiar, almost-finished layout, then changes the text, structured details, or an image. Requiring source-code editing for these updates would undermine SiSSi's structured Content panel.

## Decision

Treat a template as a reusable, versioned starting point for a scene. It contains a nearly complete scene structure/layout and behavior, a structured content schema with labelled fields and placeholder/default values, and references to managed assets. Suitable fields include text, dates/times, links, images, icons, and repeatable entries such as event cards or schedule rows.

A creator selects a released template version to create a new independent editable scene. The scene has its own identity, content values, source/workspace, history, review, and publication lifecycle. Template edits or releases do not silently mutate scenes previously created from an older template version. The initial workflow supports creating new scenes from templates; a future explicit update/rebase workflow may selectively apply later template changes.

Templates have ownership/tenant scope, access controls, provenance, working drafts, and immutable released versions. Using a template does not automatically grant permission to edit it, and creating a scene from it does not grant publication rights or access to all displays. Assets remain governed by the managed asset library's permissions, licensing, provenance, and version-pinning rules. Published scene revisions pin exact released design-system and asset versions/hashes.

Templates may identify a compatible/default design system and useful target-screen profiles. The ordinary workflow is: choose template, fill structured fields, replace permitted images/assets as needed, preview target profiles, review content/provenance, and publish using normal permissions. Placeholder values must be visibly identifiable and must not masquerade as verified current facts.

## Consequences

- Template discovery, permission checks, editing, versioning, release, and instantiation are separate capabilities/workflows.
- Templates and scenes share the structured content model and Content panel, avoiding a separate form system.
- A template version must be recorded as the origin of a newly created scene.
- Template updates cannot mutate already published scenes or silently overwrite existing scene edits.
- Exact schemas, template sharing across tenants, and explicit update/rebase semantics remain to be specified.

## References

- [Content creation and authoring](../creation-system.md)
- [Design systems](../design-systems.md)
- [Tenancy, identity, authorization, and MCP OAuth](../access-control.md)
- [Roadmap](../plan.md)
