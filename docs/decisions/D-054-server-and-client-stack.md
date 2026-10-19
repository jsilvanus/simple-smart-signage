# D-054 — Server and client stack

- **Status:** Accepted
- **Date:** 2026-10-19
- **Specification:** Partial. Language, framework and contract tooling are decided. Individual library choices are open.
- **Supersedes:** the Next.js server named in the README and `plan.md`.

## Decision

- **Language and modules:** TypeScript on Node.js LTS. All packages are ESM (`"type": "module"`). No CommonJS in new packages.
- **Server:** Express for the HTTP API. The API is defined by an OpenAPI 3.1 document, which is the canonical contract. Typed clients are generated from it.
- **Database:** PostgreSQL, with migrations written as code in the repository.
- **Client:** a Vite-built single-page application for the kiosk PC (D-053). The same Vite toolchain builds the authoring workspaces (D-035), so one build tool covers both.
- **Interfaces:** the CLI and the MCP server use the HTTP API and never implement domain logic (D-050).
- **Not used:** Next.js. No React server framework is part of the MVP. A browser authoring UI in 1.2 is a Vite application served by the API, unless a later decision says otherwise.
- **Storage:** S3-compatible object storage (D-056).

## Open

- The OpenAPI-to-TypeScript generator and the request-validation middleware.
- The test runner, the migration tool and the query layer. These are chosen during the Prototype scaffold and recorded then.
- Whether the SPA is served by the API process or by a separate static host in production.

## Consequences

- One language and one module system across server, client, CLI and SDK packages.
- The planned npm-workspaces layout (D-042) stands. The workspace root will contain the server, the kiosk SPA, the CLI and `@sissi/scene-sdk`.
- `docs/plan.md` Phase 2 is reworded accordingly. The architecture overview's "Next.js application" wording is reworded in the same change.

## References

- [D-042 Scene SDK and API versioning](D-042-scene-sdk-and-api-versioning.md)
- [D-050 CLI-first MVP and OpenAPI-defined API](D-050-cli-first-mvp-and-openapi-api.md)
- [D-034 Pluggable execution provider](D-034-pluggable-execution-provider.md)
- [Display runtime](../display-runtime.md)
