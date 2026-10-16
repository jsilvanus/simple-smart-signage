# D-050 — CLI-first MVP and OpenAPI-defined API

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

The MVP should validate SiSSi's signage capabilities without first building a general-purpose administration web UI. Both human operators and AI agents need usable interfaces, while some tasks inherently require visual feedback.

## Decision

The MVP is **CLI-first and MCP-enabled**, with no general-purpose administrative web UI. SiSSi will expose its application capabilities through a documented HTTP API whose contract is defined in OpenAPI. The CLI and MCP server will both use this API; neither will independently implement domain logic or bypass server-side authorization.

Generate API clients, types, and interface scaffolding from the OpenAPI contract where practical. Add hand-authored CLI ergonomics and MCP-specific tool design where generation alone does not provide a good user experience.

Visual browser surfaces are permitted where visualization is intrinsic to the task, notably scene editing and scene/signage previews. The CLI or MCP may provide an authenticated preview URL for the user to open in a browser. These surfaces are companion experiences, not a separate administrative control plane, and must use the same authorization model with appropriately scoped preview access.

## Consequences

- API schemas, errors, authentication, and authorization become foundational MVP contracts.
- Routine administration and content/playback operations are available through CLI and MCP.
- Preview and editing experiences may use browser rendering without implying a general-purpose web UI.
- MCP tool design and safety policy are specified separately; an OpenAPI endpoint does not automatically have to become a one-to-one MCP tool.

