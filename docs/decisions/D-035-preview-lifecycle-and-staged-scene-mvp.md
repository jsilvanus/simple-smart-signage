# D-035 — Preview lifecycle and staged scene MVP

- **Status:** Accepted architectural direction; exact timeout configuration and scene schemas remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi needs an economical, understandable authoring preview lifecycle and a useful first release before supporting the full flexibility of complex, code-driven scenes.

## Decision

### Preview lifecycle

- Give each active authoring workspace its own isolated preview execution environment initially. Do not introduce a shared pool of workspaces inside a single container unless measurements later justify the added isolation and scheduling complexity.
- Keep the execution-provider interface runtime-independent; Podman is the first provider target under D-034.
- When the creator explicitly closes the editor, start a **short, configurable shutdown countdown**, initially **2 minutes**.
- When a preview is idle, start a **longer, configurable shutdown countdown**, initially **20 minutes**. Define meaningful activity so background browser noise or automatic reloads cannot keep a preview alive indefinitely.
- Reopening the workspace before shutdown cancels the pending stop and reuses the running environment where possible.
- The trusted server-side controller owns timers and lifecycle state, not the browser. It reconciles running environments after server restarts.
- Stopping an environment must not delete the scene workspace or its saved source/assets. Preview starts on demand. Validation/build jobs remain separate, disposable executions created from controlled workspace snapshots.
- Route previews through the authenticated reverse proxy and keep them separate from management-origin privileges and credentials. Apply resource limits and least privilege; a separate container is not by itself a complete security guarantee.

### Staged scene delivery

- **MVP: simple media scenes** for directly displaying an image or video (PDF removed from the MVP by D-053). These should be usable without requiring creators to author HTML/CSS/JavaScript or run a Node/Vite development environment.
- **Immediately after the simple-scene MVP: complex scenes**, including AI-authored or manually edited frontend scenes, richer layouts and interactions, using the authoring workspace, live Vite preview, validation/build, and publication workflow.
- Keep the scene model extensible so simple media scenes and complex scenes remain reusable scenes within the same playback/playlist model. Do not let complex-scene infrastructure unnecessarily block the first usable media-scene release.

## Consequences

- The first release can deliver practical signage value before the full authoring environment is complete.
- Preview runtime costs are controlled through lazy startup and different shutdown delays for explicit close versus inactivity.
- Initial timeout values are defaults to tune after operational measurements; they are not immutable product limits.
- Exact media-scene behavior (including video playback, duration, completion, and failure fallback) and the detailed complex-scene contract remain specification work.

## References

- [Pluggable execution provider](D-034-pluggable-execution-provider.md)
- [Content creation and authoring](../creation-system.md)
- [Implementation plan](../plan.md)
- [Decision register](README.md)
