# D-057 — Human sign-in

- **Status:** Accepted
- **Date:** 2026-10-19
- **Specification:** Partial. The two-stage approach is decided. The identity provider is open.

## Decision

1. **Prototype:** local accounts. Passwords are hashed with Argon2id. A single administrator account is created by a setup command. Prototype only; the local account store is not extended beyond the Prototype.
2. **MVP:** an OpenID Connect identity provider, if the church has one that can be used. If none is available, the MVP keeps local accounts with multi-factor authentication recorded as a requirement before release.
3. **Tenancy:** sign-in identifies a global human account. Tenant membership and grants are checked on each request (`access-control.md`, D-023, D-049).
4. **Sessions:** the CLI uses a short-lived token issued after sign-in. Browser sessions use secure, HTTP-only cookies.

## Open

- Which identity provider the church operates or can use. This blocks the MVP sign-in design.
- Account recovery, invitations and disablement (`access-control.md` still-to-specify list).
- Session lifetime and token rotation values.

## Consequences

- The Prototype does not depend on any external identity service.
- The MVP sign-in design waits for the identity-provider answer. The Prototype's local accounts remain for setup and break-glass access in production unless that is decided otherwise.

## References

- [Access control](../access-control.md)
- [D-023 Multi-tenant authorization](D-023-multi-tenant-authorization.md)
- [D-049 Permission catalogue and tenant access policies](D-049-permission-catalogue-and-tenant-access-policies.md)
