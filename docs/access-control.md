# D-023 — Multi-tenant authorization and OAuth-based MCP access

- **Status:** Accepted architectural direction; detailed policy and schemas remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi must support both a centrally operated multi-tenant service and single-tenant/self-hosted installations. Access must be consistent across users, scenes, design systems, publishing, displays, and MCP integrations. MCP access should be authorised through OAuth rather than relying on manually created long-lived tokens as the normal user workflow.

## Decision

Use one tenant-aware identity and authorization model for both deployment modes. In a multi-tenant service, platform super-administrators manage tenant lifecycle. Tenant administrators manage their own tenant, not other tenants. A single-tenant installation uses the same model with one configured tenant and may omit platform-wide tenant provisioning features.

Separate global human identity from tenant membership and grants. A user may belong to multiple tenants and have different permissions in each. Enforce tenant isolation server-side for all tenant-owned records, APIs, assets, searches, background jobs, and MCP operations.

Use permission-based authorization with understandable role templates and resource-scoped grants. Permission areas include account/user administration, content creation and update, design-system editing and release, review/publishing, individual display management, display-group management, MCP/integrations, and audit. Support access to an individual screen or a named group of screens. Content-editing rights do not automatically grant publication rights; design-system editing does not automatically grant release rights; access to one screen does not grant access to all screens.

Use OAuth-based authorization for MCP clients. A user signs in and authorizes a client for a selected tenant and explicit capabilities; the client obtains its own access token through the supported OAuth flow. For interactive clients, use Authorization Code with PKCE where applicable and follow the selected MCP protocol's discovery/protected-resource requirements. Tokens should be scoped, audience-bound, expiring, revocable, and associated with the authorizing subject, tenant, and client. Every tool call must still check current resource permissions. Do not expose durable credentials to scene code or logs. Non-interactive service identities, if supported, are a separate explicit flow.

A platform super-admin role does not automatically imply unrestricted access to tenant content. Any exceptional cross-tenant support access must be explicit and audited. Record security-sensitive tenant, role/grant, display-group, OAuth, MCP, and publishing actions without logging raw secrets.

## Consequences

- Multi-tenant and single-tenant deployments share the same authorization concepts and code paths.
- Every resource and asynchronous operation needs a validated tenant context.
- The application needs role/grant management, screen-group grants, and an audit trail.
- MCP integration needs OAuth authorization, tenant selection, scope/permission enforcement, and revocation UX.
- Cross-tenant isolation, revoked grants, and forbidden publishing/display actions require automated tests.

## Still to specify

- Identity provider and supported sign-in methods.
- Built-in roles and exact permission keys.
- Resource-grant inheritance and group-membership semantics.
- Tenant lifecycle and platform support-access procedure.
- OAuth provider/library, supported MCP protocol version, scope names, client-registration policy, refresh strategy, and service identities.
- Database-level isolation strategy, audit retention, and tamper resistance.

## Reference

- [Tenancy, identity, authorization, and MCP OAuth](../access-control.md)
- [Device handshake](../handshake.md)
- [Content creation and authoring](../creation-system.md)
