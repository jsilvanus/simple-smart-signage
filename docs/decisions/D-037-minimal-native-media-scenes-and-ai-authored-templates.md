# D-037 — Minimal native media scenes and AI-authored composition templates

- **Status:** Accepted
- **Date:** 2026-10-15

## Decision

Keep native media scene types deliberately narrow. The initial native types are image, video, and PDF scenes, rendered by the SiSSi display runtime with type-appropriate playback and presentation settings. Do not turn the native renderer into a general-purpose composition or scene-authoring framework.

When a creator wants a composition beyond a single native media item—for example, text over an image, a title over a video, or a branded announcement—use a template that creates an AI-editable web scene. The AI generates and maintains the scene code; the creator primarily describes the desired result, supplies or selects content/assets, and reviews the preview. Human-authored code is not a prerequisite for the basic use case.

Templates may offer structured content fields so common edits (such as changing text, dates, logos, or the background asset) do not require regenerating the whole layout. The resulting scene remains a normal web scene with the usual source workspace, validation, preview, review, publication, immutable bundle, manifest, and asset-version pinning.

## Rationale

A small set of native renderers is easier to implement and test across device platforms. AI-authored templates provide much greater visual flexibility without requiring humans to code or forcing SiSSi to duplicate web-layout capabilities inside a second native composition system.

## Consequences

- Native image/video/PDF scenes reference managed assets and store only type-specific configuration; they do not need a scene-specific web bundle.
- More elaborate compositions use web scenes, whether created from a template or from a blank scene.
- Template-based web scenes can expose structured content fields for routine non-code editing.
- The exact native-scene configuration schema, initial playback options, template catalogue, and AI-generation workflow remain to be specified.

## References

- [Content creation and authoring](../creation-system.md)
- [Display runtime](../display-runtime.md)
- [D-015 — AI-assisted scene authoring and asset-first content creation](README.md)
- [D-036 — Separate scene bundles from managed assets](D-036-separate-scene-bundles-from-managed-assets.md)
