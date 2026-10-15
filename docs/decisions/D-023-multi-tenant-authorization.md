# D-023 — Multi-tenant authorization and OAuth-based MCP access

- **Status:** Accepted architectural direction; detailed policy and schemas remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi must support a centrally operated multi-tenant service and single-tenant/self-hosted installations. Permissions must cover users, scenes, templates, design systems, publishing, displays, and MCP integrations. MCP access should normally be authorized through OAuth.

## Decision

Use one tenant-aware identity and authorization model for both deployment modes. Use one global human account per person, with independent memberships, roles, and resource grants in multiple tenants. Platform super-administrators manage tenant lifecycle; tenant administrators operate only within their tenant. Single-tenant installs use the same authorization path with one configured tenant.

Use permission-based authorization, role templates, and resource-scoped grants. Support distinct permissions for user administration, scene/content editing, template use/editing, design-system editing/release, review/publishing, individual displays/display groups, MCP/integrations, and audit. Editing does not automatically grant release or publishing rights. Display access may be scoped to an individual screen or group.

MCP clients obtain OAuth authorization for a signed-in user, selected tenant, and explicitly granted capabilities. Use Authorization Code with PKCE for interactive clients where applicable, protocol-appropriate discovery, scoped/audience-bound expiring tokens, revocation, and permission checks on every tool call. Service identities, if supported, are a separate flow.

Enforce tenant isolation server-side across records, APIs, assets, search, background jobs, authoring workspaces, publishing, and MCP. Platform super-admin status does not automatically imply unrestricted tenant-content access; exceptional support access must be explicit and audited. Record security-sensitive actions without logging secrets.

## Consequences

- One human can use a single account across multiple tenants without sharing permissions between them.
- Every request and asynchronous operation needs a validated tenant context and current authorization.
- The application needs role/grant management, screen-group grants, OAuth consent/revocation, and audit.
- Cross-tenant isolation, revoked grants, and forbidden publishing/display actions require automated tests.

## Still to specify

- Identity provider, sign-in and account lifecycle.
- Built-in roles and exact permission keys.
- Grant inheritance, display-group semantics, and tenant lifecycle.
- Support-access procedure and audit retention.
- OAuth provider/library, supported MCP protocol version, scopes, client registration, refresh strategy, and service identities.

## References

- [Tenancy, identity, authorization, and MCP OAuth](../access-control.md)
- [Design systems](../design-systems.md)
- [Content creation and authoring](../creation-system.md)
