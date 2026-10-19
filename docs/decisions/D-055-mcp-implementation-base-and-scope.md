# D-055 — MCP implementation base and MVP scope

- **Status:** Accepted
- **Date:** 2026-10-19
- **Specification:** Partial. The base template and the MVP scope are decided. Protocol version, scopes and template conventions are open.

## Decision

1. **Base:** the MCP server is built from the `jsilvanus/codestash` template. The template is the starting point for the MCP server package and its conventions. It is not yet reviewed against this record. That review is the first step of the MCP work (see Open).
2. **MVP scope:** read-only resources (scenes, assets, playlists, screens, status) and draft-editing tools for native scenes and asset upload. Publishing, assignment and rollback are not MVP tools. They arrive in 2.0 (D-026, D-050).
3. **Authority:** the MCP server calls the HTTP API and uses the same authorisation as the CLI and API. It holds no separate permissions.
4. **Authentication:** OAuth 2.0 authorisation code with PKCE, tenant-selected and audience-bound, as set out in `access-control.md`. No long-lived tokens in MCP configuration as the normal workflow.

## Open

- Whether the codestash conventions for tool naming, resource URIs and error shapes match the MVP scope. Any mismatch is recorded here before implementation.
- The MCP protocol version to support and the OAuth library. Both are chosen when the template is reviewed.
- Scope names for read and draft-edit capabilities.

## References

- [D-025 MCP content creation](D-025-mcp-content-creation.md)
- [D-026 MCP publishing and resource index](D-026-mcp-publishing-and-resource-index.md)
- [D-050 CLI-first MVP and OpenAPI-defined API](D-050-cli-first-mvp-and-openapi-api.md)
- [Access control](../access-control.md)
- Template: <https://github.com/jsilvanus/codestash>
