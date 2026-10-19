# Decision register

Records of architectural decisions for SiSSi. Each record is `D-NNN-slug.md` and has a `Status`, a `Date`, a `Specification` line, and a `## Decision` section.

- **Status:** `Accepted` (the direction is decided) or `Proposed` (not yet decided).
- **Specification:** `Complete`, `Open items` (the record names what is still undecided), or `Partial` (the decided parts are listed, the rest is named).

A record can be Accepted and still have open specification work. Check the Specification column before building from it.

Numbering: the next free number is **D-060**. Numbers are never reused. D-014 to D-021 were cited by earlier documents but were never recorded, so they stay unused.

## Index

| ID | Title | Status | Specification | Record |
|---|---|---|---|---|
| D-013 | Camera privacy boundaries | Accepted | Complete for the prohibitions; no camera feature is authorised | [D-013-camera-privacy-boundaries.md](D-013-camera-privacy-boundaries.md) |
| D-022 | Shared design systems and hybrid version pinning | Accepted | Complete | [D-022-design-systems.md](D-022-design-systems.md) |
| D-023 | Multi-tenant authorization and OAuth-based MCP access | Accepted | Open items | [D-023-multi-tenant-authorization.md](D-023-multi-tenant-authorization.md) |
| D-024 | Reusable content templates | Accepted | Open items | [D-024-reusable-templates.md](D-024-reusable-templates.md) |
| D-025 | MCP v2 content creation, discovery, and edit proposals | Accepted | Open items | [D-025-mcp-content-creation.md](D-025-mcp-content-creation.md) |
| D-026 | Scene resource index and MCP publishing/deployment tools | Accepted | Open items | [D-026-mcp-publishing-and-resource-index.md](D-026-mcp-publishing-and-resource-index.md) |
| D-027 | Composable palette overlays and approved accessible colour sets | Accepted | Open items | [D-027-accessible-palette-overlays.md](D-027-accessible-palette-overlays.md) |
| D-028 | Conditional playlist activation and external conditions | Accepted | Open items | [D-028-conditional-playlist-activation.md](D-028-conditional-playlist-activation.md) |
| D-029 | Concurrent playlists and temporary playback overrides | Accepted | Open items | [D-029-special-broadcast-composition.md](D-029-special-broadcast-composition.md) |
| D-030 | Shared scene and playlist display eligibility | Accepted | Open items | [D-030-scene-and-playlist-eligibility.md](D-030-scene-and-playlist-eligibility.md) |
| D-031 | Screen and screen-group assignment queues | Accepted | Open items | [D-031-playlist-composition.md](D-031-playlist-composition.md) |
| D-032 | Scene-first content model and layout composition | Accepted | Open items | [D-032-playlist-layouts-and-concurrent-scenes.md](D-032-playlist-layouts-and-concurrent-scenes.md) |
| D-033 | Declared scene actions and host-mediated runtime API | Accepted | Open items | [D-033-scene-actions-and-runtime-api.md](D-033-scene-actions-and-runtime-api.md) |
| D-034 | Pluggable execution provider for scene authoring and builds | Accepted | Open items | [D-034-pluggable-execution-provider.md](D-034-pluggable-execution-provider.md) |
| D-035 | Preview lifecycle and staged scene MVP | Accepted | Open items | [D-035-preview-lifecycle-and-staged-scene-mvp.md](D-035-preview-lifecycle-and-staged-scene-mvp.md) |
| D-036 | Separate scene bundles from managed assets | Accepted | Open items | [D-036-separate-scene-bundles-from-managed-assets.md](D-036-separate-scene-bundles-from-managed-assets.md) |
| D-037 | Minimal native media scenes and AI-authored composition templates | Accepted | Open items | [D-037-minimal-native-media-scenes-and-ai-authored-templates.md](D-037-minimal-native-media-scenes-and-ai-authored-templates.md) |
| D-038 | Tenant API connectors and scene variable bindings | Accepted | Open items | [D-038-tenant-connectors-and-scene-variable-bindings.md](D-038-tenant-connectors-and-scene-variable-bindings.md) |
| D-039 | Background preparation and hybrid playlist activation | Accepted | Complete | [D-039-background-preparation-and-hybrid-activation.md](D-039-background-preparation-and-hybrid-activation.md) |
| D-040 | Hybrid playback fallback policy | Accepted | Complete | [D-040-hybrid-playback-fallback-policy.md](D-040-hybrid-playback-fallback-policy.md) |
| D-041 | Cache-first publication and scene readiness | Accepted | Complete | [D-041-scene-readiness-and-start-lifecycle.md](D-041-scene-readiness-and-start-lifecycle.md) |
| D-042 | Scene SDK and API versioning | Accepted | Complete | [D-042-scene-sdk-and-api-versioning.md](D-042-scene-sdk-and-api-versioning.md) |
| D-043 | First-class caption services and persistent caption layers | Accepted | Open items | [D-043-caption-services-and-persistent-caption-layer.md](D-043-caption-services-and-persistent-caption-layer.md) |
| D-044 | Complex-scene security model | Accepted | Open items | [D-044-complex-scene-security-model.md](D-044-complex-scene-security-model.md) |
| D-045 | Complex-scene security enforcement requirements | Accepted | Open items | [D-045-complex-scene-security-enforcement.md](D-045-complex-scene-security-enforcement.md) |
| D-046 | Shared job execution and SaarnaVideo export | Accepted | Open items | [D-046-shared-job-execution-and-saarnavideo-export.md](D-046-shared-job-execution-and-saarnavideo-export.md) |
| D-047 | Durable development workspaces and S3 artifact storage | Accepted | Open items | [D-047-durable-workspaces-and-s3-artifacts.md](D-047-durable-workspaces-and-s3-artifacts.md) |
| D-048 | Deterministic playback resolution | Accepted | Open items | [D-048-deterministic-playback-resolution.md](D-048-deterministic-playback-resolution.md) |
| D-049 | Permission catalogue and tenant access-policy model | Accepted | Open items | [D-049-permission-catalogue-and-tenant-access-policies.md](D-049-permission-catalogue-and-tenant-access-policies.md) |
| D-050 | CLI-first MVP and OpenAPI-defined API | Accepted | Open items | [D-050-cli-first-mvp-and-openapi-api.md](D-050-cli-first-mvp-and-openapi-api.md) |
| D-051 | Managed object lifecycle and version history | Accepted | Complete | [D-051-managed-object-lifecycle-and-version-history.md](D-051-managed-object-lifecycle-and-version-history.md) |
| D-052 | Content creation, distribution, and playback lifecycles | Accepted | Complete | [D-052-content-distribution-and-playback-lifecycles.md](D-052-content-distribution-and-playback-lifecycles.md) |
| D-053 | MVP scope and client platform | Accepted | Partial: schedule detail and kiosk configuration open | [D-053-mvp-scope-and-client-platform.md](D-053-mvp-scope-and-client-platform.md) |
| D-054 | Server and client stack | Accepted | Partial: library choices open | [D-054-server-and-client-stack.md](D-054-server-and-client-stack.md) |
| D-055 | MCP implementation base and MVP scope | Accepted | Partial: protocol version, scopes, template review open | [D-055-mcp-implementation-base-and-scope.md](D-055-mcp-implementation-base-and-scope.md) |
| D-056 | Object storage | Accepted | Partial: bucket layout, retention, encryption open | [D-056-object-storage.md](D-056-object-storage.md) |
| D-057 | Human sign-in | Accepted | Partial: identity provider open | [D-057-human-sign-in.md](D-057-human-sign-in.md) |
| D-058 | Private asset access in sandboxed scenes | Accepted | Partial: lifetimes, signing keys, revocation open | [D-058-private-asset-access-in-sandboxed-scenes.md](D-058-private-asset-access-in-sandboxed-scenes.md) |
| D-059 | Screen groups as publishing targets | Accepted | Open items | [D-059-screen-groups-as-publishing-targets.md](D-059-screen-groups-as-publishing-targets.md) |

## Notes

- D-013 is the binding camera privacy decision. Its full text is in `docs/privacy-and-camera.md`, and the record links to it.
- D-028 is the conditional-playlist decision. The screen-group decision was renumbered to D-059 on 2026-10-19 to resolve a duplicate.
- D-053 to D-058 record the Gate 0 answers from the architecture review. D-053 amends D-035, and D-037 already matched it.
