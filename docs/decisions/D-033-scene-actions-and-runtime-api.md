# D-033 — Declared scene actions and host-mediated runtime API

- **Status:** Accepted architectural direction; API names and schemas remain to be specified
- **Date:** 2026-10-15

## Context

Scenes are reusable content, while layouts compose scenes and playback concepts determine when and how they run. Interactive scenes need a predictable way to request lifecycle changes and invoke supported external capabilities without gaining direct control of the player, other content, or server resources.

## Decision

**A scene can make API requests from its own code.** Scene authors are not limited to calling a fixed catalogue of predefined actions. For example, a scene's JavaScript may fetch event data from a public or otherwise browser-accessible event API and use the response to render the scene or respond to a visitor. This is ordinary scene behavior and should not require registering every endpoint as a plugin action.

Scene editing is also where the author defines the scene's required capabilities and, where appropriate, configures named API connections or privileged actions that the scene uses. These are distinct mechanisms:

- **Scene-authored API requests:** the scene may call public/browser-accessible APIs using normal web mechanisms, subject to browser CORS, network availability, the endpoint's own authentication and usage rules. The scene can decide when and how to call them. Arbitrary client-side requests must not carry server secrets.
- **Configured API connections:** for APIs requiring credentials, server-side access, controlled response shaping, or access to private network resources, an administrator configures a named connection/connector. Scene code calls that connection through a documented SiSSi interface; credentials stay on the server and requests are constrained by its policy. This also provides a safe path for APIs that browsers cannot call directly because of CORS.
- **Built-in runtime actions and plugin actions:** actions that affect the player, playback, devices, or privileged integrations use the host-mediated action API. The author chooses the actions the scene may invoke in the scene definition/editor; plugins register additional versioned actions through a controlled contract.
- **Permissions and enforcement:** editor declarations describe intended use and support validation/documentation; they are not permissions by themselves. Tenant/display policy, connection configuration and the runtime host determine what is actually authorized.

The host must not give scene code secrets or unrestricted server-side network access. Server-side connectors validate destination and resource scope, block SSRF/private-network access by default unless explicitly trusted, enforce timeouts and response/payload limits, and apply authentication and audit policy. The scene can request APIs and actions, but it cannot bypass SiSSi authorization, directly mutate player-owned state, or access credentials.

## Connections versus actions

A configured API connection and an action are separate concepts:

- A **connection** identifies an external service and its base configuration, authentication method, server-held credentials, permitted destinations/resources, and request/response handling policy.
- An **action** defines a specific operation, including its stable identifier/version, input and output schemas, required scopes/capabilities, and execution contract. An action may use a configured connection.
- A **scene** can call public/browser-accessible endpoints directly where appropriate, and can call named SiSSi connections or privileged actions through documented interfaces. It must never receive connection secrets.
- **Authorization** is evaluated independently of scene authoring. Declaring or selecting an action does not itself grant permission to execute it.

For example, one configured event-service connection could support separate operations such as `event.list`, `event.get`, and `event.register`. A public information scene may be authorized to read events, while a registration scene may also be authorized to submit registrations. These operations need not each be implemented as a separate plugin: ordinary public API calls remain ordinary scene code, while credentialed or privileged operations go through SiSSi's controlled connection/action interfaces.

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

The scene editor lets an author write API-calling scene logic, configure named API connections where needed, and select registered privileged actions. A tenant administrator must grant required permissions and configure the relevant integration/resource. For example, a scene may request a lighting preset that turns supported lights down; the plugin resolves the configured lighting system and checks the caller's authority. The scene never receives the lighting API credential. Unknown, ungranted, unsupported or invalid actions fail closed with a structured result.

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
