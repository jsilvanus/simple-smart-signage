# Design systems

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Scope:** Shared visual systems used by editable scenes, authoring tools, MCP integrations, and published revisions.

## Purpose and model

A SiSSi design system is a reusable, versioned visual resource. It defines visual tokens and conventions, may include reusable component styles and references to approved visual assets, and provides a consistent starting point for scenes. It is more than a single global CSS file, although CSS is the implementation layer for much of it.

Multiple design systems may coexist. Examples could include a church/institutional system, a nature/editorial system, and a high-contrast information-display system. A scene selects its design system explicitly. For the initial model, a scene uses one primary design system at a time; scene-specific CSS may extend or override it deliberately. Combining several full design systems in one scene is not part of the initial contract because competing tokens and component rules would make results ambiguous.

Design systems are independent of a scene's internal structure. The scene builder owns the HTML, its logical pages/views, navigation, and scene-specific behavior. SiSSi's design-system layer supplies visual rules; it does not dictate or manage a scene's logical-page model.

## What a design system contains

A design system may define these groups. A system need not supply every token or component, but missing values must resolve predictably through documented defaults.

- **Typography:** font families and managed font references, weights, type scale, line heights, and letter spacing.
- **Colour:** brand/accent colours, backgrounds, text, borders, and semantic states such as warning or success.
- **Spacing and sizing:** spacing scale, layout gaps, common sizes, content widths, and alignment conventions.
- **Shapes and depth:** borders, corner radii, shadows, and other surface treatments.
- **Responsive behavior:** supported breakpoints and layout conventions for landscape, portrait, square, and custom viewports.
- **Components and patterns:** optional reusable styles for headings, cards, buttons, information panels, schedules, event entries, and other common presentation patterns.
- **Assets:** references to logos, icons, fonts, illustrations, and backgrounds, with source, rights/licence, and version information where applicable.
- **Motion and accessibility:** transition conventions, reduced-motion behavior, focus visibility, contrast expectations, and other documented accessible defaults.

The system should favour semantic tokens (for example, a text role or surface role) over requiring every scene to hard-code raw values. This allows a design system to change its palette or type scale coherently. Components and patterns are optional conventions, not a requirement that every scene use a fixed component framework.

## Three layers and CSS precedence

Keep these layers distinct:

1. **SiSSi platform defaults:** baseline normalization, safe defaults, and runtime compatibility styles.
2. **Selected design system:** reusable tokens, component styles, fonts, assets, and responsive conventions.
3. **Scene-specific styles:** the scene builder's intentional layout and exceptions in the scene's own `style.css`.

The expected precedence is platform defaults, then design-system styles, then scene-specific styles. The runtime must define predictable loading order and avoid one scene's CSS leaking into another scene or into the authoring interface. Design-system CSS should be scoped or namespaced appropriately. Scene-specific overrides are permitted but should remain explicit and reviewable.

The design system must not require arbitrary JavaScript to apply its visual rules. Any future executable extensions need a separate security and compatibility decision; CSS and declarative metadata are the baseline.

## Editing: structured controls and advanced CSS

Both editing methods are first-class and must operate on the same underlying design-system resource:

- **Structured editor:** human-friendly controls for common changes such as font choices, type scale, colours, spacing, radii, shadows, breakpoints, logos, and other supported tokens/assets. Show previews and validation where practical.
- **Advanced CSS editor:** direct access to the design system's CSS for detailed component rules and custom styling.

The structured editor must not be a separate configuration that silently competes with hand-written CSS. Prefer representing shared tokens as CSS custom properties generated from or parsed into the structured model. The editor must preserve advanced CSS that it cannot safely represent as structured controls. If a CSS edit changes a known token, reflect the change in the structured view where it can be parsed unambiguously; otherwise identify it as an advanced/custom rule rather than guessing.

If structured editing and CSS are inconsistent or a value cannot be parsed safely, surface the conflict and let the creator resolve it. Never silently discard custom CSS when changing a structured token. Validate CSS before applying it to the live preview and keep meaningful changes in the authoring Action log with actor, target, result, and undo/review support where practical.

MCP tools must be able to inspect and edit both structured properties and advanced CSS. They should discover the system and its editable properties before making changes, identify the exact working version they edited, report what changed, and include required provenance/history metadata. MCP changes must not bypass validation, access controls, or version history.

## Multiple systems, identity, and permissions

Each design system has a stable ID, human-readable name, description, ownership/access policy, working draft, and immutable released versions. Saving changes updates the working draft; it is distinct from creating an immutable release. Release permission is configurable per design system, with the default allowing the system owner to release it. An owner may explicitly grant release rights to other permitted users or roles. Editing rights alone do not imply release rights, and every release records its actor and exact content/assets. Scenes refer to the stable system identity and the relevant version policy; they must not identify a system by a mutable display name or a URL alone.

Design systems are shared resources, not embedded copies of the same global CSS in every scene. Access controls govern who may view, edit, release, or retire a system. A scene creator must be able to see which system is selected and whether it follows the working version or is pinned. Removing or retiring a system must not break published revisions that already reference a released version.

System assets use the managed asset library and its provenance/licensing rules. Each released design-system version records exact CSS/metadata and asset versions or hashes needed to reproduce it. Published scenes must not depend on a mutable asset URL that could change underneath the release.

## Versioning and scene updates — hybrid model

The accepted default is hybrid:

- **Draft scene:** follows the selected design system's current working version. Changes to the system can appear in the draft preview so the creator can assess the impact during authoring.
- **Published scene revision:** pins the exact released design-system version and exact asset versions/hashes used by that revision. Changes to the design system do not mutate a published scene or its cached/offline bundle.
- **Publishing:** resolves the working design system to a specific immutable released version, records that version in the scene revision manifest, and builds the scene against it. The release must be available and validated before publication succeeds.
- **Updating a system:** show the affected draft scenes and published revisions. Drafts may pick up working changes, but creators should be able to inspect the impact. Updating a published scene requires creating, reviewing, and publishing a new scene revision; it must never rewrite the old revision in place.
- **Rollback:** retain the prior system and scene revisions according to retention policy, so a creator can return to a known-good version without changing historical releases.

A draft preview may therefore change when a shared design system changes. That is intentional and should be visible in the authoring UI and Action log. Publication is the point where all mutable references are resolved into immutable versioned inputs.

## Preview, validation, and accessibility

Design-system edits should update the live authoring preview. Provide representative previews and support the scene's viewport controls, while making clear that testing a design-system sample is not a substitute for checking actual scenes. Before releasing a system, validate CSS syntax, referenced assets, font availability, and relevant token values. Detect or flag likely problems such as missing assets, invalid values, insufficient contrast where measurable, and reduced-motion omissions where applicable.

Before publishing a scene, target-screen review remains required under the scene authoring contract. The selected design-system version and its assets are part of the inputs to that review. A system update that materially changes the rendered result should prompt renewed scene review before a new scene revision is published.

## Release permissions

Use a configurable release policy per design system. The default is that only the design-system owner can create an immutable release; the owner may explicitly grant this capability to selected roles or users. Saving edits to the working draft is a separate operation and does not itself create a release. A release captures the exact structured tokens, CSS, metadata, and asset versions/hashes. Scene publication may use only a validated released version, and the scene publisher must also have the relevant scene-publishing permission. Log changes to release policy and every release.

## Boundaries and still to specify

- Exact database schema and version identifiers.
- Token schema, supported component conventions, and fallback semantics.
- CSS parsing strategy and conflict-resolution UI for structured/advanced edits.
- How design-system assets are uploaded, licensed, reviewed, and released.
- CSS scoping/isolation details and the policy for custom fonts.
- Whether design-system releases require a separate reviewer/approval role.
- Retirement and retention policy for unused systems and old releases.

The initial implementation should establish stable identity, structured tokens, advanced CSS, immutable releases, explicit scene selection, and hybrid draft/published behavior before expanding into a large component catalogue.
