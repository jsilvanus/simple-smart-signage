# SiSSi release scope: Prototype, MVP, 2.0, and 3.0

This document classifies the features in the SiSSi plan by intended product release. It complements [the implementation plan](plan.md): release scope answers **what belongs in each release**, while the implementation phases answer **in what order we build it**.

These are scope boundaries, not promises that a feature is already implemented. Cross-cutting foundations (especially tenant isolation, authorization, immutable versions, auditability, and secure handling of untrusted media/code) must be implemented to the depth required by each release; they are not postponed simply because their full management experience comes later.

## Prototype — prove the complete path

**Goal:** Prove one end-to-end path from a working server to image or video playing on an enrolled display. The prototype is not the MVP.

1. **Server and tenant**
   - Start the server and database with configuration and migrations.
   - Have one tenant and an administrator with credentials.
   - Enforce tenant ownership and basic server-side authorization for every prototype operation.
2. **Client enrolment**
   - Run the first full-screen web client in a documented development/test browser.
   - Client registers as pending and displays a verification number.
   - Administrator can verify and add/approve the client to the tenant; issue a unique device credential and support revocation.
   - Client authenticates, connects, and reports a basic heartbeat/connection state.
3. **Create simple media**
   - Administrator/authorised user creates a scene containing one image or one video.
   - Upload or attach the media directly during scene creation. No separate reusable asset library.
   - No source-code authoring, templates, design-system editor, PDF, audio, or complex layout.
4. **Publish**
   - Publish a specific immutable scene revision; do not edit published bytes in place.
   - Record the minimum actor/time/version information needed to identify what was published.
5. **Assign and deliver**
   - Assign the published media scene to the enrolled client.
   - Use a minimal assignment representation that can later evolve into the full playlist model; do not build scheduling or concurrent playback.
   - Deliver the assignment and required media to the client; verify media integrity before displaying it.
6. **Playback**
   - Client prepares and displays the assigned image/video and reports enough state to confirm playback.
   - A minimal local cache is allowed where required for download/playback, but offline resilience and cache-management guarantees are MVP work.
7. **Interface and test**
   - Define/extend OpenAPI before or alongside each capability, then regenerate the CLI from the current contract at every step.
   - All prototype operations must be possible through the CLI/API; no general admin UI is required.
   - Test the single happy-path vertical slice and basic authorization failures.

**Prototype acceptance test:** From a working server and tenant, an administrator can enrol a display, create an image or video scene, publish it, assign it, and verify that it plays on the display.

**Explicitly out of prototype scope:** reusable asset library, PDF scenes, advanced offline/recovery behaviour, full role/grant administration, general web admin UI, complex web-scene authoring, schedules, Android TV, Tizen, and the full MCP tool catalogue.

## MVP — a usable, dependable first product

**Goal:** Make the prototype suitable for a small real deployment using a supported full-screen web client, simple media scenes, and CLI-first management.

### Core product workflow
- Production-ready simple media scenes for images, PDFs, and MP4 video, with validated uploads and playback settings.
- Reusable asset library with stable IDs, versioning, checksums, provenance/attribution fields, scene usage references, and safe deletion/update handling.
- Explicit asset-version references in editable scenes and exact dependency/version/hash pinning in immutable published revisions.
- Editorial Review → Publish workflow, revision-scoped approval and audit; material changes require review again.
- Playlists and ordered items, with basic progression and a single active playlist/assignment per screen.
- Assign playlists to individual screens; basic screen inventory and client sync/playback status.
- CLI-first operation for tenant/device/content/asset/publish/playlist/assignment workflows. OpenAPI remains the canonical HTTP contract, the typed TypeScript client and CLI are regenerated as the API evolves, and task-oriented CLI commands may wrap generated operations.
- A bounded initial MCP integration: authenticated, permission-checked access to core resources and semantic workflows required for practical AI/agent assistance. It uses the same domain operations and authorization as the API/CLI; it is not a parallel backend.

### Device and delivery reliability
- Supported web-client browser/device setup documented and tested.
- Secure enrolment, device credentials, revocation, authenticated configuration sync, SSE notifications, HTTPS heartbeat, reconnect and reconciliation.
- Download/cache of required media and packaged web bundles where applicable; integrity verification, atomic activation, and preservation of last-known-good content.
- Offline playback of verified cached content, startup/reload recovery, and safe behaviour during server/network outages.
- Distinct desired, downloaded, prepared, active, and observed status; useful per-device diagnostics.
- Structured server/client logs without secrets, basic device health/last-seen view through CLI or a minimal operational surface, and backup/restore procedures.
- Automated tests/CI for core contracts and failure cases; installation, upgrade, backup, restore, and operator documentation.
- Human identity, tenant membership, initial role templates and resource-scoped permissions sufficient for real operation; audit security-sensitive actions and test cross-tenant isolation.
- Production security review of the web client, media delivery, private/public access, and any code execution that is actually enabled. Do not enable untrusted authored scenes until their isolation/security gate passes.
- EUPL-1.2 licence text and compliance checks; first usable release.

### Deliberately not required for MVP
- A general-purpose administrative web application; authenticated visual editor/preview surfaces are allowed only where needed for content creation.
- AI-authored or manually coded custom scenes and isolated Vite workspaces.
- Android TV or Samsung Tizen native clients.
- Complex scheduling, programmes, concurrent playlists, special-broadcast overrides, free-form multi-region composition, and external condition evaluation.
- Full design-system management, template catalogue, rich MCP resource index/proposal workflows, and advanced AI provenance/C2PA workflows.

## 2.0 — richer authoring and broader device support

**Goal:** Expand beyond simple media into reusable, custom-designed scenes and practical deployment across dedicated signage platforms.

### Custom scene authoring
- AI-assisted and manual HTML/CSS/JavaScript scene authoring using the documented three-file contract and SiSSi design system.
- Isolated per-scene Vite authoring workspaces on the server, authenticated UUID-addressed preview routing, live preview, disposable validation/build jobs, and runtime-independent execution-provider boundary with Podman as the initial provider.
- Durable workspace checkpoints and S3-compatible artifact storage, bounded logs, resource/network limits, workspace recovery and isolation tests.
- Structured Content editor, Manual source editor, unified Action log, practical undo/review, viewport controls, target-screen review, and validation/build/publish workflow.
- Reusable templates with placeholder content and labelled structured fields; multiple logical pages/views in a scene.
- Design systems with structured tokens and advanced CSS editing, working drafts and immutable releases, version pinning, controlled palette overlays, contrast/accessibility checks, and impact review.
- Asset-first custom scenes, scene metadata/search, safe paste, and import/validation of artifacts produced by connected tools.

### Additional clients and operations
- Android TV client based on the established API/playback contracts.
- Samsung Tizen client, subject to actual hardware/firmware compatibility testing.
- Platform lifecycle, kiosk/auto-start, scheduled TV power, media capability, and cache/offline behaviour validated on target hardware.
- More complete operator dashboards, diagnostics, upgrade/recovery procedures, resource and workspace monitoring, and severity-based security-violation handling.

### Advanced MCP and automation
- Expanded MCP v2 resources/resource templates, canonical and immutable versioned URIs, scene dump/resource index, tenant-aware search and rich metadata filters.
- Semantic tools for structured/source edits, assets, templates, validation, preview, history and provenance.
- Edit/propose modes, revision-base conflict detection, proposal review/application/discard, auditable supersession, and richer MCP OAuth/client configuration.
- Separate permissioned publishing/deployment tools, rollout status, confirmation/review gates and safe rollback; MCP remains an interface to the same authorized domain operations.

## 3.0 — advanced programming, composition, and context-aware signage

**Goal:** Support more complex, dynamically programmed displays and optional integrations after the core authoring/client product is proven.

### Programming and composition
- Programmes, multiple playlists and conditional sequences.
- Screen/group assignment schedules, date overrides, weekday schedules, time windows, timezone/DST handling, off-time gaps, loop/finite-run policies and per-screen overrides.
- Eligibility policies and shared conditions for scenes, playlist entries, assignments and overrides.
- Deterministic playback resolver shared by preview, diagnostics and desired-state generation, with explicit precedence, explanations, unknown/error/stale-result handling and conformance tests.
- Concurrent playlist composition, user-defined free-split layouts, full-screen/PiP/side-by-side/up-to-four-region arrangements, independent region progression, transitions, audio focus and capability-based fallback.
- Temporary override workflows with WITH (add a region while base playback continues) and REPLACE (take over while preserving base state) behaviour, priority, expiry, conflict handling and audit.
- Persistent caption services/layers integrated with external caption sources such as LCYT, with per-display language/styling and source outages isolated from base playback.

### Integrations and richer governance
- Configured external API connections, server-side condition connectors, external data mapping/polling/cache freshness, manual test/status views and strict SSRF/secret controls.
- Broader automation and integration workflows, including controlled import/export from other media-production systems.
- Richer tenant-defined access policies, categories, advanced resource grants and governance/reporting where real deployment experience shows the need.
- Extended provenance workflows, AI-transparency label policy and C2PA manifest preservation/validation where appropriate.

### Research, opt-in only
- Camera-based context classification only after a separate privacy/security review and verified on-device feasibility; not enabled by this release classification alone.
- Optional on-device gesture/pose interaction under the existing privacy constraints. No microphone, audio analysis, person identification, persistent tracking, frame storage, or frame transmission.
- Additional media types such as MP3/audio only after a separate playback/capability decision; audio file playback does not authorize microphone access or audio analysis.

## Cross-release rules

- **OpenAPI and CLI evolve continuously:** every capability is specified in OpenAPI, and the CLI is regenerated at each prototype step and as the API changes later. Generated endpoint commands may be supplemented with well-designed task workflows.
- **One domain, multiple interfaces:** API, CLI, MCP, and any UI must use the same authorization and lifecycle rules; none bypasses the others.
- **Preserve lifecycle boundaries:** Compose → Review → Publish; Assign → Push → Cache; Prepare → Ready → Activate → Start → (Play) → End/Finish → Next.
- **Immutable published state:** published revisions pin exact dependencies and are never mutated in place. Updating content creates a new revision; rollback selects a previous known-good revision/state.
- **Security is not deferred:** tenant isolation, server-side authorization, device identity, secret boundaries, safe media handling, and the relevant code-isolation gate apply whenever the corresponding capability is introduced.
- **No camera/audio expansion by implication:** future research bullets do not authorize collection or processing. The existing binding privacy decisions continue to govern.
- **Release boundaries are intentional:** if a feature is needed to pass an earlier release's acceptance test, bring forward only the minimum implementation necessary and record the scope change explicitly.
