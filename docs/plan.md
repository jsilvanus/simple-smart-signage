# SiSSi plan index

This is the top-level implementation roadmap. Detailed specifications belong in their own documents; this page links to them and tracks the sequence of work.

**Release scope classification:** see [Prototype, MVP, 2.0, and 3.0](roadmap-by-release.md) for the intended feature boundaries. This file remains the implementation-phase checklist; use the release classification to determine which phase a feature belongs to.

## Current foundation

- [x] Project name: SiSSi — Simple Smart Signage
- [x] Licence choice: EUPL-1.2
- [x] Initial device lifecycle and handshake proposal
- [x] SSE + HTTPS heartbeat selected
- [x] Administrator approval required for new devices
- [x] Full-screen web runtime selected as the first-class display type
- [x] MVP client platform sequence: web client first; Android TV and Samsung Tizen after the MVP
- [ ] Add complete official EUPL-1.2 licence text to `LICENSE`

## Phase 1 — Define the contract

- [ ] Finalise API schemas and error codes.
- [ ] Finalise enrollment secret and device credential lifecycle.
- [ ] Define protocol-version compatibility.
- [ ] Define screen/group assignment and device permissions.
- [ ] Define SSE events, event IDs, reconnect, and reconciliation.
- [ ] Define heartbeat payload and online/offline thresholds.
- [ ] Define the scene-first content model: reusable scene and layout concepts (layouts group scenes and support user-defined free split); scene lifecycle API and end-of-scene policies; separate playback concepts (playlists, programmes, assignments, schedules, eligibility, run policies, shared conditions, concurrent playlist playback, and special-broadcast overrides).
- [ ] Define the scene action declaration schema, built-in lifecycle/navigation requests, host-owned lifecycle events, plugin action registry and manifests, capability grants, structured results, timeouts, idempotency, audit, and failure behavior.
- [ ] Define reusable, versioned templates as scene starting points with placeholder values and structured content schemas.
- [ ] Define display-target schema: hosted URL, packaged web bundle, and media.
- [ ] Define scene authoring workspace, UUID proxy routing, source editing, preview, build, publishing, and artifact contracts.
- [ ] Define the default three-file source contract and multiple logical pages within a scene.
- [ ] Define asset identity/versioning and MCP artifact import validation.
- [ ] Define private scene access and public embedding policy.
- [ ] Define authentication boundaries for authoring, preview, device APIs, assets, and embedded scenes.
- [ ] Define app origin policy and explicit capabilities, including optional camera access.

Reference: [Device handshake](handshake.md) · [Display runtime](display-runtime.md) · [Content and playback model](content-model.md) · [Content creation system](creation-system.md) · [Design systems](design-systems.md) · [Reusable templates](decisions/D-024-reusable-templates.md) · [Conditional playlist activation](decisions/D-028-conditional-playlist-activation.md) · [Asset library and provenance](asset-library.md) · [Decision register](decisions/README.md)

## Phase 2 — Server foundation

- [ ] Create Next.js / TypeScript application.
- [ ] Add PostgreSQL schema and migrations.
- [ ] Implement administrator authentication and authorisation.
- [ ] Implement pending enrollment, verification number, approval, rejection, and expiry.
- [ ] Implement per-device credential issuance, revocation, and audit events.
- [ ] Implement authenticated handshake, configuration, SSE, and heartbeat endpoints.
- [ ] Implement authorised web-app assignment and versioned bundle metadata.
- [ ] Define the runtime-independent execution-provider contract and initial Podman provider; separate persistent Vite preview sessions from disposable validation/build jobs.
- [ ] Define workspace/task lifecycle, bounded logs/diagnostics, artifact handoff, cleanup, dependency/network policy, resource limits, and isolation tests; decide later whether an in-container supervisor/API is necessary.
- [ ] Define isolated authoring-workspace process, Vite lifecycle, and reverse-proxy management.

## Phase 3 — First display client (web MVP)

The MVP client is a full-screen web client. Android TV and Samsung Tizen clients are post-MVP platform work; do not make native TV support a prerequisite for the first end-to-end release.

- [ ] Define and document the supported browser/device setup for the web-client MVP.
- [ ] Implement onboarding splash screen and verification number.
- [ ] Implement approved-device credential storage.
- [ ] Implement handshake and configuration sync.
- [ ] Implement full-screen hosted web-app display in the web client.
- [ ] Implement packaged web-bundle download, integrity checks, atomic activation, and rollback.
- [ ] Implement media cache for image, PDF, and video assets, integrity checks, and atomic playlist switching.
- [ ] Implement SSE reconnect and HTTPS heartbeat.
- [ ] Implement offline playback and startup recovery.
- [ ] Test web-client behaviour across reloads, browser restarts, network loss, and cache corruption.
- [ ] Validate camera permissions and browser APIs on the supported web-client setup before advertising webcam support.

## Phase 4 — Content creation and management

- [ ] Implement reusable asset library for images, PDFs, and MP4 video; keep the model extensible to later MP3/audio support.
- [ ] Define asset provenance: uploader, credited creator where known, originating project, initial scene, upload time, source/rights notes, tags, and current scene usage.
- [ ] Define upload limits, server-side validation, storage, checksum/versioning, derived previews, and reference-safe deletion.
- [ ] Implement explicit asset-version pinning for editable scene references and exact version/hash pinning in published revisions.
- [ ] On asset update, prompt with the referencing-scene list and allow selective propagation; never mutate published revisions in place.
- [ ] **MVP content milestone:** implement simple media scenes that display an image, PDF, or video without requiring source-code authoring; connect asset upload, validation, review, immutable publication, playlist assignment, client download/cache, and playback in one end-to-end path.
- [ ] **Immediately after the simple-scene MVP:** implement complex code-driven scenes with the authoring workspace, live Vite preview, validation/build, and publication workflow.
- [ ] Implement preview lifecycle: isolated environment per active workspace, server-owned shutdown timers, initial 2-minute countdown after explicit editor close, initial 20-minute countdown after meaningful inactivity, cancellation on reopen/activity, restart reconciliation, and workspace persistence after stopping.
- [ ] Implement per-scene Vite authoring workspace on the SiSSi server using `npm run dev`.
- [ ] Expose each workspace through an authenticated UUID-addressed reverse proxy.
- [ ] Build the main authoring view with live preview and a shared side panel containing the structured Content editor and unified Action log.
- [ ] Build a separate Manual view with HTML/CSS/JavaScript editors and preview; keep both authoring views synchronised with the same scene workspace.
- [ ] Record meaningful human content edits and manual source edits in the same Action log as AI/MCP operations, with actor/action/target/result context and practical undo/review.- [ ] Add compact viewport controls (landscape, portrait, square, custom) shared by both authoring views; render the live scene at the selected logical dimensions.
- [ ] Add a pre-publish target-screen review for one or more profiles, with detectable layout/runtime/resource checks and explicit creator review.
- [ ] Define a scene content model or equivalent editable bindings that AI can expose as labelled fields grouped by logical page/content area.
- [ ] Define template creation, discovery, access controls, versioning, and instantiation into an independent editable scene.
- [ ] Provide ready-to-use templates with placeholder copy and structured content fields so creators can fill fields, replace images, preview, review, and publish without editing source code.
- [ ] Ensure template edits never silently mutate scenes already created from earlier template versions; define explicit update/rebase behavior separately.
- [ ] Implement structured Content panel controls for text, asset/image/video selection, icons/symbols, and suitable repeatable content groups; update preview without unnecessary layout/source regeneration.
- [ ] Support safe text paste and constrained semantic formatting; sanitise pasted markup and validate asset references, identifiers, and URLs.
- [ ] Define field-level and asset-level provenance for human input, dictated/transcribed input, AI generation, assistive transformations, external/tool sources, and unknown origins.
- [ ] Require MCP content-writing operations to return provenance metadata; preserve unknown provenance when absent or unverifiable.
- [ ] Preserve AI-generated image/media provenance and support C2PA manifest retention/validation where appropriate.
- [ ] Add an explicit Review phase before publishing, with provenance inspection, reviewer attribution, revision-scoped approval, and re-review after material changes.
- [ ] Add global/system AI-transparency label assets with source/licence/version metadata and configurable disclosure policies.
- [ ] Track provenance, editorial-review status, and disclosure decisions separately; human review is not a universal exemption from disclosure.
- [ ] Define shared design-system identity, structured token model, CSS representation, asset references, and access controls; allow multiple systems to coexist.
- [ ] Define composable design-system overlays, beginning with palette overlays that select named four-colour sets without replacing the base design system.
- [ ] Define approved church palette sets, permitted semantic foreground/background pairings, WCAG AA contrast evidence, and tenant policy for required palette selection; validate raw CSS colour overrides.
- [ ] Implement configurable design-system release permissions, defaulting to owner-only release; keep draft saving separate from immutable release.
- [ ] Implement both structured design-system editing and advanced CSS editing against the same resource, with validation, conflict handling, and preservation of custom rules.
- [ ] Implement design-system working drafts and immutable releases; draft scenes follow working versions while published scene revisions pin exact design-system and asset versions/hashes.
- [ ] Show scenes affected by design-system changes and require a new reviewed/published scene revision to apply updates to published content.
- [ ] Integrate AI-assisted scene creation and editing using the SiSSi design system and three-file source contract.
- [ ] Support multiple logical pages/views within a scene.
- [ ] Implement MCP v2 scene/template/asset search across accessible tenants, including tenant codes and pagination.
- [ ] Implement scene metadata fields and searchable filters for tags, intended use/event, seasonal relevance, date windows, and event URLs.
- [ ] Expose canonical scene/content/source/history/proposal resources and the consolidated read-only scene-dump resource, with explicit versioned immutable resources.
- [ ] Expose a scene resource-index resource listing all permitted URI resources linked to a scene, including metadata, source files, design-system/palette references, assets, proposals, revisions, previews, and publication state.
- [ ] Specify MCP publishing and deployment tools separately from authoring: publish reviewed scene revisions, search/read/edit playlists, assign playlists to screens/groups, push versioned desired state to clients, inspect rollout/sync status, and roll back safely.
- [ ] Implement MCP edits (default) and MCP proposes modes, proposal review/application/discard, revision-base conflict detection, and auditable supersession.
- [ ] Implement semantic MCP tools for scene creation, structured content and repeatable-item edits, source edits, asset upload/attachment, validation, preview, history details, and provenance correction.
- [ ] Import and validate artifacts/data produced by MCP-connected tools.
- [ ] Build, validate, and publish immutable scene revisions at stable UUID-based SiSSi URLs.
- [ ] Implement permissioned MCP publication/deployment operations with review gates, target preview/confirmation, immutable revision pinning, idempotent rollout, per-client status, and safe rollback.
- [ ] Implement playlist resources and MCP tools to discover/edit playlists, manage ordered items and playback policies, assign playlists to screens/groups, push desired configuration, and inspect synchronization/health.
- [ ] Define the OpenAPI specification as the canonical HTTP API contract and generate a typed TypeScript API client from it.
- [ ] Build the CLI on the generated API client, adding hand-written task-oriented commands/workflows where generated endpoint commands are not sufficiently usable; preserve server-side authorization and lifecycle rules.
- [ ] Define playlist layout schema and compositor contract for concurrent scenes: full-screen, PiP, side-by-side, up to four regions, free split, region sizing/stacking, independent advancement, completion/closure policies, runtime-error recovery, audio focus, device capability negotiation, and fallback behavior.\n- [ ] Define special-broadcast composition schema, activation/expiry/priority rules, audio focus, device capability negotiation, and fallback behavior.
- [ ] Implement display-client multi-region composition so a secondary broadcast can play alongside the base playlist without resetting its playback position; support start/stop/status for displays and screen groups.
- [ ] Define reusable condition/connector schemas and supported predicates for playlist-level and playlist-entry eligibility, assignments, and special broadcasts, including YouTube Live state and mapped JSON values/URLs.
- [ ] Define 24-hour screen/group assignment schedules with calendar-date schedules taking precedence over weekday schedules, exclusive schedule resolution, independent copy-to-date behavior, and off-time gaps; define conditional playlist-sequence ordering, playlist time windows and loop/finite run limits, count reset semantics, assignment priority/precedence, condition evaluation, and per-screen overrides.
- [ ] Define shared time-window semantics, AND/OR composition, timezone/DST behavior, and explicit unknown/error/stale-result policies for eligibility.
- [ ] Add `varfetch` as a server runtime dependency when the application package manifest is created; configure trusted SSRF allow/deny policy and keep credentials server-side.
- [ ] Implement server-side condition evaluation, polling/cache freshness, manual test/status display, audit events, and explicit unknown/error fallback behavior.
- [ ] Implement explicit private/restricted and public/embed-enabled scene access policies.
- [ ] Publish versioned bundles for cacheable/offline display playback.
- [ ] Create playlists and playlist items, including playback policies and transitions.
- [ ] Configure scene and playlist display-eligibility policies; evaluate eligibility during playlist selection and playback, including safe fallback when all playlist items or assignments are ineligible.
- [ ] Create schedules and assignments for screens and screen groups.
- [ ] Track content revisions and client sync status.
- [ ] Provide explicit origin/capability controls for web apps.

## Phase 5 — Reliability and operations

- [ ] Add structured server/client logs without secrets.
- [ ] Add device health and last-seen dashboard.
- [ ] Add backup and restore procedures.
- [ ] Test server restart, internet outage, Wi-Fi loss, corrupt downloads, and revoked credentials.
- [ ] Test cold boot, scheduled TV power, and app auto-start on actual hardware.
- [ ] Test packaged-app offline behaviour and rollback.
- [ ] Test workspace isolation, resource limits, proxy authorisation, and cleanup.
- [ ] Test public embedding restrictions and private-scene access revocation.
- [ ] Document installation, upgrades, recovery, and operator procedures.

## Phase 6 — Additional platforms and release (post-MVP)

- [ ] Implement an Android TV client using the established server API and playback contracts.
- [ ] Evaluate and implement Samsung Tizen support using the established server API and playback contracts.
- [ ] Verify platform lifecycle, kiosk limitations, browser/runtime capabilities, and camera APIs on actual target hardware before advertising platform-specific features.
- [ ] Add automated tests and CI.
- [ ] Review security and EUPL compliance.
- [ ] Publish a first usable release and operator documentation.

## Future research — not MVP

- [ ] Evaluate optional camera-based scene classification for context-aware signage, with a strong preference for on-device inference.
- [ ] First verify camera access and local inference feasibility on actual Android TV and Samsung Tizen hardware.
- [ ] Consider a separate inference service only as a later, explicitly reviewed fallback. It must discard frames after inference and must not store them; any transmission of frames would require revising the current binding camera privacy decision before implementation.
- [ ] Keep this capability out of the MVP. Until separately approved, use scheduled signage only; no camera-based inference is authorised by this roadmap item.

## Future research — gesture interaction (not MVP)
- [ ] Research optional on-device pose/gesture interaction (calibrated pointing and visual clap detection) under D-017; no audio input or analysis.
- [ ] Define an opt-in capability and a minimal, non-identifying event contract; keep camera frames local and transient.
- [ ] Test calibration, false-positive handling, cancellation, accessibility, latency, and target-device feasibility before implementation.
- [ ] Preserve the binding prohibition on microphone access, sound detection, recording, speech recognition, and audio analysis.

## Tenancy, authorization, and MCP access

- [ ] Specify MCP v2 resources, resource templates, semantic tools, tenant-aware search, canonical and versioned URI conventions, and scene-dump resource.
- [ ] Define rich searchable scene metadata (tags, intended use/event, season/date window, optional event URL) and tenant short-code constraints.
- [ ] Define MCP edit/propose modes, proposal stack lifecycle, stale-base conflict handling, and audit/provenance contracts.
- [ ] Define tenant-aware data ownership and enforce tenant isolation in API handlers, background jobs, assets, search, and MCP tools.
- [ ] Define platform super-admin and tenant-admin boundaries for multi-tenant and single-tenant deployments.
- [ ] Define initial role templates and permission keys for users, scenes/content, design systems, publishing, displays/display groups, MCP, and audit.
- [ ] Implement resource-scoped grants for individual displays and display groups, with auditable effective access.
- [ ] Specify human sign-in, invitations, tenant membership, account disable/removal, and audit behavior; use one global human account with independent memberships/grants in multiple tenants.
- [ ] Implement MCP OAuth discovery/authorization, user consent, tenant-scoped and audience-bound access tokens, expiration/revocation, and permission checks on every tool call.
- [ ] Decide OAuth provider/library, supported MCP protocol version, scopes, client registration, refresh-token policy, and any separate service-identity flow.
- [ ] Add tests for cross-tenant isolation, role/grant changes, revoked OAuth grants, and unauthorized publishing/display actions.

## Delivery rule

A phase is not complete merely because the happy path works. Include failure recovery, permission checks, and tests appropriate to the phase before marking its tasks complete.