# D-027 — Composable palette overlays and approved accessible colour sets

- **Status:** Accepted architectural direction; palette schema and church-specific values remain to be specified
- **Date:** 2026-10-15

## Decision

Allow a scene to use one primary design system plus explicitly compatible, narrowly scoped overlays. A palette overlay changes semantic colour tokens without replacing the base system's typography, spacing, components, layout rules, or assets. It declares purpose, token scope, precedence, compatibility constraints, and version.

A palette overlay can provide named four-colour sets. Each set defines four values, semantic roles, allowed foreground/background pairings, and usage constraints. Record contrast ratios and the applicable WCAG criterion/threshold for each approved pairing. Do not assume every arbitrary pairing among four colours is accessible merely because the palette has been approved.

For a church tenant or design-system policy configured to require an approved church palette, scene creation and publication must select a permitted set or compatible released palette overlay. Validation flags arbitrary colour overrides in scene CSS and requires a policy-approved exception where one is allowed. This is tenant policy, not a universal rule for every SiSSi tenant.

For WCAG AA contrast checks, ordinary text requires at least 4.5:1 and qualifying large text at least 3:1. Other visual objects and focus indicators have their own applicable criteria. Palette approval covers tested combinations, not every possible layout or use of text over imagery.

Palette overlays have working drafts and immutable releases. Published scene revisions pin the exact released overlay version and palette-set identity. Preview, validation, and review show the active base system, overlays, selected set, and approved exceptions.

The actual church palette values, pairings, evidence, schema, and exception workflow remain to be documented.

## References

- [Design systems](../design-systems.md)
- [MCP v2 content creation](D-025-mcp-content-creation.md)
- [Roadmap](../plan.md)
