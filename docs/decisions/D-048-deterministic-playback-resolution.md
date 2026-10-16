# D-048 — Deterministic playback resolution

- **Status:** Accepted architectural direction; resolver semantics remain to be formalized
- **Date:** 2026-10-16

## Decision

SiSSi will define one formal, deterministic playback-resolution contract that computes the desired display state for a screen from the authoritative configuration and relevant evaluation context. The contract will be shared by server-side preview, operator diagnostics, and deployment/desired-state generation; these uses must not implement competing interpretations of playback rules.

The resolver determines intended state, not actual device state. The display runtime remains responsible for preparing and rendering the desired state and reporting what it actually achieved.

The contract must explicitly define its inputs, precedence and selection rules, condition/time evaluation context, composition and override handling, output schema, diagnostics/explanation, and behavior for unknown or failed inputs. Given equivalent versioned inputs and the same explicit evaluation context, resolution must produce the same result.

This decision builds on the accepted scene-first content and playback model, including schedules, assignment queues, programmes, playlists, eligibility conditions, layouts, concurrent playback, and WITH/REPLACE overrides. It does not reopen those accepted architectural directions.

The selected specification approach is a reviewable precedence table plus a reference implementation and conformance test vectors. Hierarchical resolution is the foundation; explicit priorities resolve competition at the same level, while conditions determine candidate eligibility. The details in the contract document are a draft for review, and its listed open policy choices must be settled before implementation treats them as normative.

## Open specification work

- Define a versioned resolver input and output schema.
- Formalize schedule selection, assignment and programme precedence, playlist and entry eligibility, ordering, finite-run state, and reset semantics.
- Formalize time zones, daylight-saving transitions, half-open time windows, condition freshness, and unknown/error policies.
- Formalize composition, override priority/conflicts, device capabilities, and fallback selection.
- Include explainability diagnostics identifying selected candidates, rejected candidates and reasons, applied rules, and relevant evaluation timestamps/versions.
- Define deterministic handling of persisted state such as finite-run progress and concurrent playback positions.
- Specify validation rules, error cases, compatibility/versioning, and conformance tests with boundary-time and failure scenarios.

## Rationale

One authoritative resolver makes playback predictable and testable, lets operators understand why a screen should display particular content, and keeps previews and deployment decisions consistent. The client can then focus on preparing, activating, and reporting the resolved state.

## References

- [Playback resolution contract](../playback-resolution.md)
- [Content and playback model](../content-model.md)
- [D-028 — Conditional playlist activation](D-028-conditional-playlist-activation.md)
- [D-029 — Special broadcast composition](D-029-special-broadcast-composition.md)
- [D-031 — Screen assignment queues and conditional playlist sequences](D-031-playlist-composition.md)
- [D-039 — Background preparation and hybrid playlist activation](D-039-background-preparation-and-hybrid-activation.md)
- [D-040 — Hybrid playback fallback policy](D-040-hybrid-playback-fallback-policy.md)
