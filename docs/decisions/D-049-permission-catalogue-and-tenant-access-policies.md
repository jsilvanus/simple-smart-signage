# D-049 — Permission catalogue and tenant access-policy model

- **Status:** Accepted architectural direction; exact permission keys and remaining policy details remain to be specified
- **Date:** 2026-10-16

## Decision

Use named, domain-grouped permissions as the conceptual authorization model. The implementation may optimize checks with bitmasks or other representations, but raw bit positions are not public API identifiers. Roles are reusable bundles of permissions; every operation must still be authorized against the active tenant, target resource, action, and relevant conditions. Users may hold multiple roles within a tenant. Role permissions combine additively: the effective ordinary grants are the union of applicable grants from the user's roles and other applicable grants.

Keep ordinary object actions, lifecycle actions, playback operations, integration/execution capabilities, tenant administration, and exceptional security-sensitive actions distinct. In particular, editing does not imply sharing, publishing, releasing, activating, deploying, executing, deleting, or administering access.

Tenant access policies have both:
- **Defaults**, which establish normal access behavior and may be overridden where allowed.
- **Mandatory restrictions**, which cannot be overridden by object owners or ordinary grants. Restrictions may require sharing/access or prohibit it, including public/external sharing.

Initially, do not implement ordinary explicit-deny rules. Access is denied when no applicable grant permits the action, and mandatory tenant restrictions always take precedence over ordinary grants, ownership, and roles. Revisit explicit-deny rules only if a concrete use case justifies their complexity.

Keep **user groups** and **object groups** as separate concepts:
- **User groups** contain SiSSi users. Roles or permission grants assigned to a user group apply dynamically to all of its current and future members. Removing a user from the group removes the permissions inherited through that membership. Effective authorization must reflect current group membership and revocation promptly; it must not rely solely on stale token claims or cached membership snapshots.
- **Object groups** collect objects and can be used as reusable authorization scopes. A grant to an object group applies to the relevant current and future objects in that group, subject to the actions and conditions stated in the grant. Membership in an object group does not itself grant access; an explicit grant is required.
- The two group types are independent: user-group membership identifies who receives a grant, while object-group membership identifies which resources that grant covers. A grant can therefore connect a user group (or a role held by its members) to one or more object-group scopes.

Objects may belong to zero, one, or multiple object groups at once. Ownership, object-group membership, and permissions are separate concepts. For example, an Emergency publisher user group may receive publish or playback-override permissions scoped to objects in an Emergency content object group without receiving a tenant-wide emergency bypass. Objects can simultaneously belong to groups such as Emergency content and Worship services.

Built-in role templates such as Content editor, Publisher, IT/integration specialist, and Emergency publisher should be starting bundles that tenant administrators can customize, rather than immutable hard-coded roles. Keep only essential system-level account/tenant administration roles fixed. In particular, permission to use an approved API connection is distinct from permission to configure it, manage its credentials/scopes, or reveal secrets.

Objects may have zero, one, or multiple tenant-defined categories within their object type. Uncategorised objects use the type-level default. For objects in multiple categories, select the applicable default policy using a deterministic selection rule still to be specified; all applicable mandatory restrictions accumulate and must be satisfied. Categories are optional unless a future tenant policy explicitly introduces a classification requirement for selected object types. Categories are not groups: categories influence tenant policy defaults/restrictions, while groups organize users or objects and can scope grants.

## Permission catalogue

The following is the initial action vocabulary, not a finalized schema. Actions apply only where meaningful for a given object type.

### Common object actions
- `discover`: discover the object and see minimal listing metadata.
- `view`: read ordinary details and configuration.
- `download`: download or export contents where supported.
- `create`: create objects within the applicable type or scope.
- `edit`: modify working configuration.
- `delete`: delete or request deletion.
- `share`: grant or revoke access for users or teams.
- `manage_access`: administer resource grants and access settings.
- `change_owner`: transfer ownership to an eligible user.
- `archive`, `restore`: archive and restore without permanent deletion.
- `duplicate`: create a separate copy.

### Content lifecycle
- `use`: reference or reuse an object elsewhere.
- `validate`, `preview`: validate or preview without affecting live playback.
- `submit_review`, `review`, `approve`: submit for and participate in review.
- `publish`, `unpublish`: publish or withdraw published content.
- `release`, `retire`: create/designate an immutable release or retire it from future use.
- `rollback`: return to an earlier approved or published version.

### Playback and devices
- `view_status`: inspect device or playback status.
- `manage_configuration`: configure a screen or group.
- `manage_members`: change screen-group membership.
- `assign_content`: assign content to a target.
- `manage_playlist`, `manage_schedule`, `manage_assignment_queue`: manage the corresponding playback resources.
- `activate`, `deactivate`: activate or deactivate an assignment, schedule, or override.
- `override_playback`, `clear_override`: start or clear an override.
- `preview_target`: preview resolved output for a specific screen.
- `deploy`: issue desired-state changes to target devices.
- `force_sync`: request immediate device reconciliation.
- `manage_device`, `pair_device`, `revoke_device`: administer, approve registration of, or revoke a device.

### Rules, integrations, and execution
- `manage_rules`: create or edit rules and conditions.
- `manage_connection`, `use_connection`, `view_connection_status`: administer, use, or inspect an integration without conflating those capabilities.
- `manage_credentials`, `view_secret`: manage credentials or reveal a secret only where explicitly supported.
- `manage_scopes`: change a connection's allowed scopes, destinations, or capabilities.
- `manage_action_definition`, `invoke_action`: separately manage and execute plugin actions.
- `manage_webhooks`, `test_connection`: configure webhooks or perform bounded connectivity tests.

### Tenant and platform administration
- `manage_members`: invite, remove, or manage tenant members.
- `manage_roles`, `grant_permissions`: administer role templates/bundles and assign roles or grants.
- `manage_categories`: administer tenant-defined categories.
- `manage_policy_defaults`, `manage_policy_restrictions`: configure tenant access-policy defaults and mandatory restrictions.
- `manage_tenant_settings`, `manage_auth_providers`, `manage_oidc_mappings`: administer tenant settings, authentication options, and mappings from external identities to SiSSi users.
- `manage_api_clients`, `manage_oauth_grants`: administer applicable clients and delegated authorization.
- `view_audit`, `export_tenant_data`, `manage_tenant_lifecycle`: audit, export, or administer tenant lifecycle actions.
- Platform lifecycle administration is a separate platform-scoped domain and does not itself grant ordinary access to tenant content.

### Exceptional and security-sensitive actions
- `access_private_object`: deliberately access an otherwise private object through an authorized exceptional-access procedure.
- `access_sensitive_metadata`, `inspect_security_events`: access specially protected metadata or security events.
- `manage_device_capabilities`, `manage_mcp_clients`, `authorize_mcp_client`, `revoke_mcp_client`: administer device capability profiles and MCP client authorization.
- `manage_retention`, `purge_deleted_data`: change supported retention rules or permanently purge eligible deleted data.

## Authorization constraints

- A permission is necessary but may not be sufficient: evaluate tenant membership, target scope, object grants, policy defaults/restrictions, and action-specific conditions.
- Tenant restrictions are mandatory constraints and cannot be overridden by sharing, ownership, roles, or ordinary grants.
- Target-specific limits, approval requirements, time-bounded grants, and authentication-strength requirements may constrain an otherwise permitted action.
- Sharing a connection does not reveal its credentials or grant permission to change its scopes or execute every action.
- Exceptional private-object access requires an explicit action, a reason, and an audit event. It remains tenant-scoped and subject to mandatory restrictions.
- Roles such as Editor, Publisher, and Tenant Administrator are convenience bundles; they do not replace per-action server-side authorization.
- Permission changes and revocations must take effect without relying solely on token expiry.

## Open specification work

- Final stable permission identifiers and the subset supported by each object type.
- Default-policy selection when multiple categories apply, and exact policy-combination/evaluation order.
- Whether and how tenants may require category classification for selected object types.
- Exact fixed system-level roles and any remaining role-template details.
- Role templates, screen-group target semantics, approval workflows, temporary grants, and whether nested groups are supported.
- Exact exceptional-access approval/expiry process and audit retention.

## References

- [Access-control architecture](../access-control.md)
- [D-026 — MCP publishing and resource index](D-026-mcp-publishing-and-resource-index.md)
- [D-028 — Screen groups as publishing targets](D-028-screen-groups-as-publishing-targets.md)
- [D-044 — Complex-scene security model](D-044-complex-scene-security-model.md)
