# Tenancy, identity, authorization, and MCP OAuth

- **Status:** Accepted architectural direction; detailed policy and schemas remain to be specified
- **Date:** 2026-10-15

## Deployment and tenant model

SiSSi supports both a centrally operated multi-tenant service and single-tenant/self-hosted installations. Both use the same tenant-aware identity and authorization model. A single-tenant installation has one configured tenant and may omit platform-wide tenant provisioning features; it must not use a weaker or separate authorization path.

A platform super-administrator manages platform operations and tenant lifecycle. A tenant administrator manages users, resources, and settings only within their tenant. Platform super-admin status does not automatically grant unrestricted access to tenant content. Any exceptional cross-tenant support access must be explicitly granted, limited, and audited.

## Identity and memberships

Use one global human account per person, capable of belonging to multiple tenants. The person signs in once and selects or switches to the relevant tenant. Each tenant membership has its own status, roles, and resource grants, so a person may have different responsibilities in different organisations. Removing a membership from one tenant does not delete the global account or memberships elsewhere. Account disablement and deletion behavior must be specified without leaving orphaned grants or audit records.

Tenant context must be explicit in application operations. Never infer tenant access merely because a user knows a resource ID or URL.

## Tenant short codes and cross-tenant discovery

Each tenant has a unique, case-insensitively allocated short code of 1–6 lowercase alphanumeric characters. This code is intended for readable search results, labels, and disambiguation, not authentication or authorization. Use the immutable internal tenant ID for canonical resource identity and access-control checks. A code must be unique across the installation/platform namespace in which cross-tenant search operates. If code changes are supported later, they must be explicit and must not change resource identity.

A user-facing global search can return results from every tenant in which the current user has relevant discovery permission. Each result includes the tenant code and stable resource identity. Search must filter inaccessible resources before returning results; knowing a tenant code, resource ID, or URI never grants access. MCP resource reads and tool calls must still re-check current tenant membership and resource grants.

## Authorization model

Use permission-based authorization with understandable built-in role templates and resource-scoped grants. Roles are convenient bundles of permissions, not a substitute for checking each operation against the target resource and tenant. Enforce access server-side in APIs, background jobs, asset delivery, search, scene authoring, publishing, and MCP tools.

Permission areas include:

- Platform and tenant lifecycle administration.
- Tenant membership and user/account administration.
- Scene/template creation and editing, and content field updates.
- Design-system viewing, editing, release, and retirement.
- Review and publication.
- Individual displays and display groups.
- MCP clients, integrations, OAuth grants, and audit access.

Keep distinct capabilities distinct. Editing a scene does not automatically grant publication rights. Editing a design system does not automatically grant release rights. Template-use permission does not imply template-edit permission. Access to one display does not grant access to every display. A user may have grants for an individual display or for a named group of displays; the effective target set must be calculated and auditable.

Design-system release permission is configurable per system and defaults to owner-only release. The owner may explicitly grant release rights to selected users or roles. Saving a working draft is separate from creating an immutable release. Scene publishing remains a separate permission.

## MCP OAuth

MCP clients use OAuth-based user authorization rather than relying on manually copied long-lived tokens as the normal interactive workflow.

1. The user signs in to SiSSi and selects the tenant in which the client will act.
2. The user reviews and authorizes the requesting client and its requested capabilities.
3. The client obtains an access token using the supported OAuth flow. For interactive clients, use Authorization Code with PKCE where applicable, and follow the selected MCP protocol version's authorization discovery and protected-resource requirements.
4. The token is scoped to the subject, tenant, client, audience, and expiry, and can be revoked.
5. Every tool call checks current tenant membership, resource grants, and operation-specific permissions. A token does not preserve rights that have since been removed.

Do not expose durable credentials or OAuth secrets to scene HTML/CSS/JavaScript, display clients, model prompts, tool output, or logs. Non-interactive service identities, if supported, are a separate explicit flow with their own limited grants and lifecycle. Token refresh policy, client registration, exact scope names, provider/library, and supported protocol version remain to be selected.

## Isolation, audit, and failure behavior

All tenant-owned records and operations must be tenant-scoped. Apply isolation to database queries, APIs, managed assets, search, caches, asynchronous jobs, authoring workspaces, scene bundles, and MCP calls. Deny by default when tenant context, membership, or required grants are missing or ambiguous. Permission changes and revoked OAuth grants must take effect without relying solely on a token's expiry.

Audit security-sensitive tenant lifecycle, membership and role/grant changes, design-system release-policy changes and releases, display-group changes, OAuth consent/revocation, MCP operations, and publication actions. Include actor, tenant, target, action, time, and outcome as appropriate; never log raw access tokens, secrets, or credentials. Exceptional cross-tenant support access must have an explicit reason and auditable start/end.

## Still to specify

- Identity provider, sign-in methods, account recovery, invitations, and account disable/deletion lifecycle.
- Built-in roles and exact permission keys.
- Resource-grant inheritance and display-group membership semantics.
- Tenant provisioning, suspension, export, and deletion.
- Support-access approval and expiry.
- OAuth provider/library, MCP protocol version, discovery details, scope names, client registration, refresh-token policy, and service identities.
- Database-level isolation strategy, audit retention, and tamper resistance.

## References

- [Decision register](decisions/README.md)
- [Design systems](design-systems.md)
- [Content creation and authoring](creation-system.md)
- [Device handshake](handshake.md)
