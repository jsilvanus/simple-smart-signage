# D-037 — Minimal native media scenes and AI-authored composition templates

- **Status:** Accepted
- **Date:** 2026-10-15

## Decision

Keep native media scene types deliberately narrow. The initial native types are image and video scenes; PDF is explicitly outside the MVP and may be considered later, rendered by the SiSSi display runtime with type-appropriate playback and presentation settings. Do not turn the native renderer into a general-purpose composition or scene-authoring framework.

When a creator wants a composition beyond a single native media item—for example, text over an image, a title over a video, or a branded announcement—use a template that creates an AI-editable web scene. The AI generates and maintains the scene code; the creator primarily describes the desired result, supplies or selects content/assets, and reviews the preview. Human-authored code is not a prerequisite for the basic use case.

A template is a complex scene with deliberately exposed structured inputs, not a separate renderer or necessarily a fixed layout. AI or human coders should expose useful human-editable inputs (such as text, dates, liturgical colours, asset choices, and animation colours) wherever practical. Humans can always edit the full HTML/CSS/JavaScript scene directly. Structured fields make routine edits possible without changing code or regenerating the whole layout. The resulting scene remains a normal web scene with the usual source workspace, validation, preview, review, publication, immutable bundle, manifest, and asset-version pinning.

## Rationale

A small set of native renderers is easier to implement and test across device platforms. AI-authored templates provide much greater visual flexibility without requiring humans to code or forcing SiSSi to duplicate web-layout capabilities inside a second native composition system.

## Consequences

- Native image/video scenes reference managed assets and store only type-specific configuration; they do not need a scene-specific web bundle.
- More elaborate compositions use web scenes, whether created from a template or from a blank scene.
- Template-based web scenes can expose structured content fields for routine non-code editing.
- Native image settings include duration, fit mode, and background colour. Native video settings include autoplay, looping, muted playback, fit mode, and end behaviour. The playlist occurrence controls effective playback duration wherever applicable; scene completion follows the configured playback policy. Exact schemas and edge cases remain to be specified.

## References

- [Content creation and authoring](../creation-system.md)
- [Display runtime](../display-runtime.md)
- [D-036 — Separate scene bundles from managed assets](D-036-separate-scene-bundles-from-managed-assets.md)
