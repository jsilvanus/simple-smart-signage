# D-033 — Declared scene actions and host-mediated runtime API

- **Status:** Accepted architectural direction; API names and schemas remain to be specified
- **Date:** 2026-10-15

## Context

Scenes are reusable content, while layouts compose scenes and playback concepts determine when and how they run. Interactive scenes need a predictable way to request lifecycle changes and invoke supported external capabilities without gaining direct control of the player, other content, or server resources.

## Decision

**Scene editing is where the author chooses which actions that particular scene can invoke.** The editor presents a discoverable action catalogue containing built-in runtime actions and actions registered by installed/configured plugins. The author adds the needed actions to the scene definition, configures their allowed parameters where applicable, and sees each action's description, required capabilities and permission status.

The catalogue and scene declaration have different jobs:

- The **action registry** defines which actions exist, their stable identifiers and versions, parameter/result schemas, provider, capability requirements, and execution contract. Built-in actions are supplied by SiSSi; plugins register additional actions through a controlled manifest/registration process.
- The **scene definition** declares the subset of those actions that the scene is designed to call, plus any scene-level parameter configuration. The editor must not let authors invent arbitrary API endpoints or executable server functions.
- **Tenant/display permissions and integration configuration** determine whether the declared action is actually authorized and available in a given context. Selecting an action in the editor is not itself a grant of permission.
- The **runtime dispatcher** validates and executes calls using the registry contract and effective permissions.

At runtime, the scene receives only its declared API surface. The host player and server-side dispatcher retain control of execution. Scene code requests an action; SiSSi validates the caller, current playback context, parameters, capability availability and effective permissions before performing it. A scene cannot directly mutate playlists, choose arbitrary resources, access credentials, or call arbitrary plugins/endpoints.

## Built-in lifecycle and playback requests

The runtime should distinguish **requests made by a scene** from **lifecycle events/outcomes owned by the host**.

Candidate scene requests:

- `scene.close()`: request closure of this scene occurrence. The layout's configured end-of-scene policy decides whether to hold, clear, replace, reflow or end the composition.
- `playback.next()`: request advancing to the next eligible entry in the current playlist, subject to playback policy.
- `playback.goTo(target)`: request navigation to an explicitly permitted target, preferably a playlist-entry/occurrence identifier rather than an ambiguous scene identifier. Arbitrary cross-playlist or cross-tenant navigation is forbidden unless separately authorized.
- `scene.finish(result?)`: report that the scene's intended interaction or task completed. The host maps this to configured playback behavior; it does not implicitly mean "stop everything".
- `scene.reportError(code, details?)`: report a scene-level application error. The host validates and records bounded diagnostic details and applies the configured error-recovery policy. This is not a way to execute arbitrary commands or bypass recovery.

The exact names and signatures are not yet final. A scene should not be allowed to fabricate host-owned states such as device offline, operator interruption, or successful publishing. Events such as `interrupted`, `finished`, and runtime `error` should be delivered by the host as lifecycle notifications where appropriate. The host owns authoritative state transitions and distinguishes normal completion, requested closure, interruption, and failure.

## Plugin-provided actions

Plugins may register named, versioned action definitions, for example `lighting.setPreset` or `lighting.setLevel`. Each action definition specifies:

- A stable namespaced identifier and version
- A parameter schema and result schema
- Required capabilities, scopes and resource targets
- Whether the action is reversible/idempotent, and its timeout and rate limits
- Expected errors and whether the action can run on a client, server or external service
- Audit and privacy requirements

The scene editor lets an author select and configure only registered actions. A tenant administrator must grant the required permissions and configure the relevant integration/resource. For example, a scene may request a lighting preset that turns supported lights down; the plugin resolves the configured lighting system and checks the caller's authority. The scene never receives the lighting API credential. Unknown, ungranted, unsupported or invalid actions fail closed with a structured result.

## Execution contract

- Treat action calls as asynchronous requests with a correlation ID and structured success/failure result.
- Validate caller identity, tenant, scene revision, active occurrence, target scope, parameters, permissions and capability availability.
- Apply timeouts, payload limits, rate limits and idempotency controls where appropriate.
- Record security-relevant actions and outcomes in an audit trail without logging secrets or unnecessary personal data.
- Do not block scene rendering indefinitely while a plugin is slow or unavailable.
- Define whether each action is safe to retry; never blindly retry non-idempotent external actions.
- A scene's requested navigation or closure does not bypass schedule eligibility, playlist rules, special-broadcast precedence or authorization.
- The API must be versioned and capability-discoverable so older clients and scenes can handle unsupported actions gracefully.

## Camera and other interactive inputs

Camera-based hand tracking is an input capability, not a privileged scene function. If enabled and authorized, the host or a trusted input provider delivers scoped pointer/gesture events to the scene. The scene can react to those events and request `scene.close()` or another declared action. Camera access is opt-in, permissioned and bounded; raw camera access is not granted merely because a scene requests pointer events. The experience must handle unavailable or revoked input safely.

## References

- [Content and playback model](../content-model.md)
- [Scene-first content model and layout composition](D-032-playlist-layouts-and-concurrent-scenes.md)
