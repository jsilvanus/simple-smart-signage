# Decision register

This directory records architectural decisions for SiSSi. Keep entries short, explicit, and dated. Use `Proposed`, `Accepted`, `Superseded`, or `Rejected` as the status.

## Accepted

### D-001 — Project name

- **Status:** Accepted
- **Decision:** The project is named **SiSSi — Simple Smart Signage**.
- **Repository:** `simple-smart-signage`

### D-002 — Licence

- **Status:** Accepted
- **Decision:** Use the European Union Public Licence, version 1.2 (**EUPL-1.2**).
- **Implementation note:** Include the complete official licence text in `LICENSE` before the first public release; the current starter file points to the official text.

### D-003 — Device update transport

- **Status:** Accepted
- **Decision:** Use Server-Sent Events (SSE) over HTTPS for server-to-client live notifications, plus authenticated HTTPS heartbeats.
- **Rationale:** Updates are predominantly server-to-client; ordinary HTTPS requests are sufficient for device health reporting.

### D-004 — Pending-device approval

- **Status:** Accepted
- **Decision:** Clients can self-register, but registration does not confer trusted access. A neutral splash screen displays a verification number; an administrator compares it with the dashboard and explicitly approves the pending device.
- **Security boundary:** The visual number is for human matching only and must never act as an authentication credential.

### D-005 — Outbound-only client connectivity

- **Status:** Accepted
- **Decision:** Display clients initiate all network connections to the server. No inbound connection to a television or signage stick is required.

### D-006 — Offline playback

- **Status:** Accepted
- **Decision:** Approved clients retain cached content and continue playback during temporary network or server outages. New content is activated only after required assets are downloaded and verified.

### D-012 — Pluggable full-screen web display runtime

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Use a small managed client shell with a pluggable display runtime. Full-screen web applications are the first-class display type, supporting both administrator-assigned hosted HTTPS URLs and versioned, locally cached web bundles. Native layouts and media remain complementary display types.
- **Rationale:** Web apps (including Vite builds) provide broad presentation possibilities and can be developed/deployed independently of the client shell.
- **Consequences:** The client must handle cache integrity, safe version activation/rollback, offline limitations, and a strict boundary between displayed app code and device-management credentials.
- **Camera note:** Browser-based webcam access and local person detection may be possible, but are not guaranteed. Camera access is an explicit capability and must be tested on each target platform and hardware combination. Arbitrary web apps receive no camera permission by default.
- **Reference:** [Display runtime](../display-runtime.md)

### D-013 — No identity recording or image-to-person-data linking

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** SiSSi must never identify or attempt to recognise people through its camera capabilities, record their identities, or link camera images, frames, or camera-derived observations to a person's identity or other personal data.
- **Prohibited:** Face recognition; face templates or embeddings used to recognise or track people; persistent person tracking; storing or transmitting camera images/video; and joining camera-derived data with names, accounts, device identifiers, attendance records, religious-affiliation data, or other personal records.
- **Permitted boundary:** If an approved use case needs camera input, processing must be transient and on-device. It may produce only the minimum non-identifying signal needed for the immediate function (for example, a temporary presence trigger to select a family-event slide). Do not retain raw frames or create person-level histories. Any aggregate output must be designed so it cannot reasonably be used to identify or single out a person.
- **Implementation requirement:** This is a product-level constraint, not a setting that an administrator or displayed web app may override. Camera access remains optional, off by default, separately authorised, and subject to applicable law and transparent notice.
- **Reference:** [Privacy and camera boundaries](../privacy-and-camera.md)

### D-014 — Playlist-first content and playback model

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** The playlist is SiSSi's primary programming unit and consists of ordered playlist items. Each playlist item references a reusable scene and carries playback-specific settings. Scenes can be delivered as hosted URLs or versioned bundles and may define an internal presentation timeline. Scene availability rules determine when a scene is eligible to appear; schedules/assignments determine when a playlist is active on a display.
- **Time ownership:** The scene owns its internal timeline and time guards. Guards may govern individual elements or the eligibility of the entire scene. The playlist item owns the effective playback duration for that occurrence; the schedule/assignment owns when the playlist is active. A playlist-item override must not silently bypass scene-level guards.
- **Runtime behavior:** The runtime selects eligible items, prepares content before activation, and advances when the playback policy or availability boundary requires it. Failed preparation must not replace the last known-good display state. Exact timeline modes, API schemas, empty-playlist behavior, time-zone/DST handling, and no-eligible-scene fallback remain to be specified.
- **Rationale:** Separates reusable content from programming and playback context while supporting animations, time-limited scenes, multiple playlists, and offline bundle playback.
- **Reference:** [Content and playback model](../content-model.md) · [Display runtime](../display-runtime.md)

### D-015 — AI-assisted scene authoring and asset-first content creation

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Content creation starts from reusable uploaded assets (initially images, PDFs, and MP4 video), AI-authored frontend scenes, manually edited source code, and artifacts or data imported from MCP-connected tools. AI-generated frontend code follows a versioned SiSSi design system and scene contract.
- **Source contract:** The default AI-editable scene consists of `index.html`, `style.css`, and `script.js`, with uploaded/generated assets managed separately. A scene may contain multiple logical pages or views, with navigation handled inside the scene. Advanced multi-file scenes may be defined separately.
- **Authoring runtime:** Vite runs on the SiSSi server in an isolated per-scene workspace, started with `npm run dev` and exposed through an authenticated UUID-addressed reverse proxy for live preview. Signage clients never run the development server.
- **Publishing and URL:** Publishing builds an immutable scene revision and serves it from a stable SiSSi URL based on the scene UUID. Access policy is explicitly private/restricted or public/embed-enabled. A versioned bundle is also the basis for reliable cacheable display delivery. A transient authoring URL is never a production scene URL.
- **Security requirements:** Authoring workspaces must be isolated and access-controlled. Uploaded files, MCP output, and generated code are untrusted until validated. Server secrets, MCP credentials, and device-management credentials must never be exposed to scene frontend code or display clients. Private access should not rely on UUID obscurity or long-lived bearer tokens in URLs.
- **Rationale:** Gives creators a flexible AI-assisted frontend authoring workflow while retaining predictable, cacheable, reviewable display releases and optional public embedding.
- **Reference:** [Content creation and authoring](../creation-system.md) · [Content and playback model](../content-model.md)

### D-016 — Separate authentication by client and request type

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Use the creator's authenticated session for authoring, a unique revocable device credential for signage-device control-plane requests, and an explicit access policy for published scenes. Use Authorization headers for API/resource requests when the client can set them, but do not assume browser page navigation or ordinary iframe loads can attach arbitrary headers.
- **Preview:** Protect UUID-addressed Vite preview routes at the reverse proxy. Use the authenticated session or a short-lived preview-ticket/session exchange; the UUID is not a credential.
- **Scene isolation:** Never expose device-management, server, MCP, or AI-provider credentials to scene JavaScript. Serve private assets through trusted endpoints or narrowly scoped, short-lived access.
- **Embedding:** Public embedding must be explicitly enabled and limited to public content/capabilities, with CSP framing and origin policy configured. Private embedding requires a deliberate session or short-lived scoped mechanism; long-lived bearer tokens in URLs are not the default.
- **Rationale:** Authentication must match the client and request type, while untrusted presentation code remains separate from management privileges.
- **Reference:** [Content creation and authoring](../creation-system.md) · [Device handshake](../handshake.md)

### D-018 — Reusable asset library and origin provenance

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Treat uploaded media as reusable, managed assets separate from scenes and playlists. The initial planned upload formats are MP4 video, PDF, and images. Keep the model extensible to MP3/audio, which may be added later rather than required for the first upload implementation.
- **Provenance:** Preserve stable asset identity, uploader and upload time, original creator attribution where known, the project where the asset was first registered, and the initial scene if uploaded from a scene. The uploader and credited creator are distinct concepts. Library uploads may have no initial scene. Record source/rights/attribution notes where known.
- **Reuse:** Scenes reference assets by stable ID and version/content hash. Track current scene usage separately from immutable origin metadata. Reuse across scenes/projects must not rewrite the original project or initial-scene provenance, and deleting a scene reference must not delete the library asset.
- **Publishing:** Published scene revisions must pin the exact asset versions/hashes they require so later changes do not silently alter published or cached playback.
- **Validation and access:** Validate uploaded content server-side; do not trust filename extensions or browser MIME types. Asset discovery and retrieval must obey project/scene permissions. Protect the original source and distinguish it from generated thumbnails, renders, and other derived previews.
- **Rationale:** Supports asset reuse, traceable attribution, safe publishing, and later growth in supported media types without conflating media storage with scene authoring.
- **Reference:** [Asset library and provenance](../asset-library.md) · [Content creation and authoring](../creation-system.md)

### D-019 — Explicit asset-version pinning and update propagation

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Assets are versioned. Scene references can explicitly follow the latest asset version while being edited or pin a specific version; the selected mode must be visible. Every published scene revision pins exact asset versions or content hashes.
- **Update prompt:** When an existing asset is updated, show a list of scenes that reference it and ask whether the new version should be propagated. Let the creator select individual eligible scenes, select all eligible scenes, or skip propagation. Show project context and the current reference/version mode for each scene.
- **Safety:** Never silently retarget a pinned reference. Updating editable scene references does not mutate an already published revision. To change published output, build a new immutable scene revision and use the normal review/publish process. Keep previous asset versions available for existing revisions and rollback, subject to retention policy.
- **Rationale:** Allows convenient library updates without unexpected changes to other scenes or displays, while retaining deterministic published playback.
- **Reference:** [Asset library and provenance](../asset-library.md) · [Content creation and authoring](../creation-system.md)

### D-022 — Shared design systems and hybrid version pinning

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Treat each design system as a shared, versioned resource containing structured visual tokens, CSS rules, optional component conventions, and versioned asset references. Multiple systems may coexist; each scene explicitly selects one primary system. Scene-specific CSS may extend or override that system. The scene builder remains responsible for scene internals and logical-page navigation.
- **Editing:** Support both structured controls for common tokens/assets and advanced CSS editing. Both edit the same underlying resource. Preserve custom CSS that cannot be safely represented in structured controls, surface conflicts, and never silently discard changes. Validate edits and record meaningful actions.
- **Versioning:** Draft scenes follow the selected system's current working version. Publishing resolves that reference to a specific immutable released version and pins it, plus exact asset versions/hashes, in the published scene revision. Published revisions and bundles never change when a system changes. Applying an update to published content requires a new reviewed and published scene revision.
- **Rationale:** Makes visual consistency reusable and editable while allowing multiple visual identities and deterministic published/offline playback.
- **Reference:** [Design systems](../design-systems.md) · [Content creation and authoring](../creation-system.md) · [Asset library and provenance](../asset-library.md)

### D-021 — Content provenance, editorial review, and AI transparency

- **Status:** Accepted architectural direction; detailed legal policy remains context-dependent
- **Date:** 2026-10-15
- **Decision:** Provenance is structured data attached to editable content fields and managed assets, with origin and transformation history. MCP tools that create or modify content must supply provenance metadata. Missing or unverifiable provenance stays explicitly unknown; it must not default to human-authored.
- **Origin and transformations:** Distinguish direct human input, dictated/transcribed input, AI-generated content, AI-assisted transformations, external/tool-sourced material, and unknown origin. Record grammar/spelling corrections as transformations while preserving human-authored origin when the human remains the author. Keep prior lineage rather than overwriting it.
- **Media:** Preserve AI-generation provenance for images and other assets. Support C2PA-compatible manifest retention and validation where appropriate, alongside SiSSi's own field-level history. Never claim verification unless validation actually succeeded.
- **Human correction:** MCP/AI/imported provenance claims can be wrong. Authorised humans can correct classifications for text and assets, including false AI-generated claims, or set origin to unknown when evidence is insufficient. Preserve the prior claim and record who corrected it, when, why/evidence if supplied, and the affected field/asset version. A correction is an accountable editorial judgement, not proof of authorship or cryptographic validation. Surface later conflicting claims rather than silently overwriting the correction.
- **Review:** Add a dedicated Review phase before publication. Record reviewer, time, reviewed revision/scope, and outcome. Material changes reopen or invalidate approval. Review does not erase origin history. Provenance corrections that affect disclosure decisions trigger re-evaluation.
- **Transparency:** Maintain versioned global/system assets for applicable AI-transparency labels, with source/licence metadata. Track provenance, editorial-review status, and disclosure/marking decisions separately. Human review is not a universal exemption from disclosure duties; applicability depends on context and current law.
- **Rationale:** Makes AI and human contributions traceable, supports editorial accountability, and provides a basis for context-sensitive transparency.
- **Reference:** [Content creation and authoring](../creation-system.md) · [Asset library and provenance](../asset-library.md) · [European Commission Article 50 guidance](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act)

### D-020 — Viewport-aware authoring and structured content editing

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Scene creation does not require an initial physical-screen or orientation choice. Both authoring views provide compact viewport controls for common landscape, portrait, and square profiles, plus custom dimensions. The preview renders the live scene at the selected logical viewport dimensions and aspect ratio.
- **Final review:** Before publishing, creators can review one or more target-screen profiles and inspect automated findings such as overflow, clipping, missing assets, and runtime errors. Automated checks do not replace human visual approval. Target compatibility is distinct from device assignment.
- **Main authoring layout:** Place the live preview beside one shared side panel containing both a structured Content editor and a unified Action log. A separate Manual view provides HTML/CSS/JavaScript source editing and preview; both views use the same scene workspace.
- **AI-defined content fields:** AI may determine which meaningful fields a scene exposes, label them clearly, and group them by logical page/content area. The Content panel can edit text and structured values, switch images/media from permitted assets, choose icons/symbols/logos from supported libraries or assets, and manage suitable repeatable content groups. Changes update the preview through the scene's content model without unnecessary layout regeneration.
- **Unified action history:** The Action log records meaningful human content edits and manual source edits as well as AI/MCP operations. Entries should identify actor/action type, affected field or source where possible, and outcome. Group ordinary typing into edit transactions rather than logging every keystroke; support inspection and undo/review where practical.
- **Safety and consistency:** The content panel is a structured editing interface, not unrestricted editing of arbitrary rendered DOM. The content model is the shared source of truth for panel controls and preview. Pasted markup is sanitised, unsafe code and embedded objects are removed, and supported formatting follows the SiSSi design system. Asset references must obey permissions and versioning/pinning rules. Content that cannot be safely exposed remains AI/manual-source edited.
- **Rationale:** Lets non-technical creators manage a scene's actual content—including text and visual assets—without needing to manipulate its layout, while retaining responsive previews, source transparency, and a useful history of both human and AI-assisted work.
- **Reference:** [Content creation and authoring](../creation-system.md) · [Roadmap](../plan.md)

### D-017 — Gesture interaction and strict no-audio boundary

- **Status:** Accepted direction for future research; not an MVP feature
- **Date:** 2026-10-15
- **Decision:** SiSSi may investigate optional camera-based human-pose and hand-gesture interaction, such as calibrated pointing, hand raising, or visually detected clapping, to trigger a presentation response or send a minimal event to an explicitly authorised scene/AI interaction layer. This is gesture interaction, not identity recognition or person tracking.
- **Privacy boundary:** Inference must run on-device where feasible, process frames transiently, and discard them immediately. Do not store or transmit camera frames/video, identify people, create persistent tracking identifiers, or link gesture events to names, accounts, device IDs, attendance, religious-affiliation, or other personal records. Do not keep person-level gesture histories.
- **Calibration and uncertainty:** Pointing-to-target interaction may require an explicit, temporary calibration step. Interaction must be opt-in, visibly indicated, and have a clear cancel/timeout path. Ambiguous gestures must not trigger consequential actions; use a deliberate confirmation gesture or dwell threshold where appropriate.
- **AI boundary:** Gestures may produce only narrowly defined, non-identifying events for the current interaction. They must not grant general access to AI tools, privileged APIs, or device management. The scene/runtime mediates allowed actions.
- **Binding audio prohibition:** SiSSi must not use microphones or perform sound/audio detection, audio recording, speech recognition, or audio analysis for this feature. A clap is detected from visual hand movement alone; no sound is captured or analysed. This is an explicit product constraint and is not relaxed by this proposal.
- **Scope:** Research only, outside the MVP. Verify camera and pose-estimation feasibility, latency, calibration, false positives, accessibility, consent/notice, and on-device performance on target hardware before proposing implementation.
- **Rationale:** Enables natural, low-friction interaction while preserving the existing no-identification camera boundary and a strict no-audio policy.
- **Reference:** [Privacy and camera boundaries](../privacy-and-camera.md) · [Roadmap](../plan.md)


### D-023 — Multi-tenant authorization and OAuth-based MCP access

- **Status:** Accepted architectural direction; detailed policy and schemas remain to be specified
- **Date:** 2026-10-15
- **Decision:** SiSSi supports centrally operated multi-tenant deployments and single-tenant/self-hosted installs using the same underlying tenant-aware authorization model. Platform super-administrators manage tenant lifecycle; tenant administrators manage only their tenant. Human identity is separate from tenant membership, and a user may have different roles/grants in different tenants.
- **Permissions:** Use consistent permission-based authorization with tenant roles and resource-scoped grants. Support rights for user/account administration, content creation/update, design-system editing/release, review/publishing, MCP/integrations, and individual displays or display groups. Creating/editing content does not automatically confer publication or target-screen rights. Enforce permissions server-side for every operation.
- **MCP OAuth:** MCP clients obtain OAuth authorisation for a signed-in user, selected tenant, and explicitly granted capabilities. Use suitable standard OAuth/MCP discovery and protected-resource metadata, Authorization Code with PKCE for interactive clients where applicable, scoped/audience-bound expiring tokens, revocation, and audit. Tokens do not bypass current resource permissions. Separate non-interactive service identities, if supported, from normal interactive user authorisation.
- **Isolation and audit:** All tenant-owned records and operations must be tenant-scoped. Platform support access to tenant content is not automatically implied by the super-admin role; exceptional access must be explicit and audited. Record security-sensitive role, grant, OAuth, MCP, and publishing actions without logging secrets.
- **Rationale:** Supports SaaS and self-hosted deployment without duplicating the authorization system, while keeping permissions understandable and MCP access accountable.
- **Reference:** [Tenancy, identity, authorization, and MCP OAuth](../access-control.md) · [Device handshake](../handshake.md) · [Content creation and authoring](../creation-system.md)


### D-026 — Scene resource index and MCP publishing/deployment tools

- **Status:** Accepted architectural direction; exact schemas and tool names remain to be specified
- **Date:** 2026-10-15
- **Decision:** Provide a scene-level resource-index URI listing every scene-linked resource the caller may access. Keep publishing and deployment separate from authoring, with explicit MCP tools for publishing reviewed immutable scene revisions, playlist search/read/edit, screen/group assignment, desired-state push, rollout status, and safe rollback. Report server acceptance separately from per-client synchronization.
- **Reference:** [Decision details](D-026-mcp-publishing-and-resource-index.md)

### D-028 — Screen groups as publishing targets

- **Status:** Accepted architectural direction; exact schemas and conflict rules remain to be specified
- **Date:** 2026-10-15
- **Decision:** Treat screen groups as first-class tenant-scoped publishing targets. Assign playlists to groups or individual screens, reconcile desired state, and report synchronization per screen. Group membership changes are audited; overlapping assignments require explicit precedence/conflict handling.
- **Reference:** [Decision details](D-028-screen-groups-as-publishing-targets.md)

### D-027 — Composable palette overlays and approved accessible colour sets

- **Status:** Accepted architectural direction; palette schema and church-specific values remain to be specified
- **Date:** 2026-10-15
- **Decision:** Allow compatible palette overlays on a primary design system without replacing its other visual rules. Palette overlays can provide named four-colour sets with semantic roles and documented, tested foreground/background pairings. Where a church tenant policy requires an approved palette, validate selection and flag unapproved CSS colour overrides. Store WCAG AA contrast evidence for tested combinations; do not treat every arbitrary pairing as automatically compliant.
- **Reference:** [Decision details](D-027-accessible-palette-overlays.md)

### D-025 — MCP v2 content creation, discovery, and edit proposals

- **Status:** Accepted architectural direction; exact schemas and tool/resource names remain to be specified
- **Date:** 2026-10-15
- **Decision:** MCP v2 supports tenant-aware cross-tenant search across only accessible resources, with a unique 1–6 character tenant code for display/disambiguation and immutable internal tenant IDs for identity and authorization. Scenes support rich searchable metadata including tags, intended use/event, seasonal relevance or date window, and optional event URL. MCP resources represent canonical readable state; tools perform search and mutations. Canonical working-state URIs use stable IDs, while immutable releases/revisions/snapshots use explicit version identifiers. A read-only scene-dump resource supplies consolidated, revision-stamped context without merging pending proposals into canonical state. Structured content and source editing are equally first-class. The scene editor provides MCP edits (default) and MCP proposes modes. Proposals are independent, auditable change sets based on a specific revision; overlapping/stale proposals require explicit resolution and never silently overwrite canonical content. Accepting a proposal changes the working draft only and does not publish.
- **Reference:** [MCP v2 content creation](../creation-system.md#mcp-v2-content-creation-and-discovery) · [Decision details](D-025-mcp-content-creation.md)

### D-024 — Reusable content templates

- **Status:** Accepted architectural direction; detailed schemas and update workflow remain to be specified
- **Decision:** Templates are versioned, nearly finished scene starting points with structured content fields, visibly identified placeholders/defaults, and managed asset references. Instantiating a released template creates an independent editable scene pinned to the source template version. Template changes never silently mutate existing scenes. Ordinary updates should require only structured field edits, asset replacement, preview, review, and normal publication permissions.
- **Reference:** [Reusable templates and content creation](../creation-system.md) · [Decision details](D-024-reusable-templates.md)
## Proposed / to decide

### D-007 — Server stack and deployment

- **Status:** Proposed
- **Proposal:** Next.js and TypeScript, PostgreSQL, and Docker Compose on a VPS.
- **To decide:** Object storage strategy, migrations, backups, and deployment environments.

### D-008 — Client platforms

- **Status:** Proposed
- **Proposal:** Start with Android TV; investigate a dedicated Tizen web client for Samsung televisions.
- **To decide:** First supported platform and minimum OS/firmware requirements. Verify kiosk/auto-start behaviour on actual hardware.

### D-009 — Enrollment expiry and polling

- **Status:** Proposed
- **Proposal:** Short-lived enrollment, a six-digit verification number, and polling while pending.
- **To decide:** Exact expiry, polling intervals, rate limits, and lockout rules.

### D-010 — Device credentials

- **Status:** Proposed
- **Proposal:** Unique revocable credential per device, exchanged only after approval.
- **To decide:** Token format, storage, rotation, expiry, and authentication for SSE on Android and Tizen.

### D-011 — API versioning

- **Status:** Proposed
- **Proposal:** Version endpoints under `/api/v1/`.
- **To decide:** Compatibility policy and minimum supported client protocol.


## Adding decisions

For a substantial architecture choice, add a file such as `D-014-short-title.md` with:

- Status and date
- Context
- Decision
- Consequences
- Alternatives considered

Keep this index updated when a decision is accepted or superseded.

### D-028 — Conditional playlist activation and external conditions

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** Playlist assignments or playlist-selection rules may depend on server-evaluated external conditions, such as YouTube Live state or a configured API's JSON response. Conditions are separate from calendar schedules and scene time guards and do not mutate playlists or immutable scene revisions.
- **Dependency:** Plan to use `varfetch@^0.3.0` for configured server-side HTTP requests and JSON-path mapping. Add it to the server application's package manifest when the app is scaffolded; this planning repository currently has no `package.json`.
- **Safety:** Keep credentials server-side, apply SSRF protections, block private-network targets unless trusted server configuration explicitly allows them, validate response-derived URLs, and define explicit freshness and unknown/error behavior.
- **Reference:** [Conditional playlist activation](D-028-conditional-playlist-activation.md) · [Content and playback model](../content-model.md)

### D-029 — Special broadcasts and multi-region display composition

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Decision:** A temporary special broadcast can run a secondary playlist concurrently with the normal/base playlist in PiP or split-screen regions. This is a display composition assignment, not a normal playlist item; base playback continues underneath and resumes without resetting when the broadcast ends.
- **Activation:** Manual or condition-based, targeted to a display or screen group, with priority, expiry, stop, fallback, and audit behavior.
- **Runtime:** SiSSi's client compositor provides the layout; hardware TV PiP is not assumed. Define capability negotiation, content support, and audio focus; avoid accidental dual audio and report unsupported layouts.
- **Reference:** [Special broadcast composition](D-029-special-broadcast-composition.md) · [Content and playback model](../content-model.md)


### D-030 — Shared scene and playlist display eligibility

- **Status:** Accepted architectural direction; exact schemas and evaluation semantics remain to be specified
- **Date:** 2026-10-15
- **Decision:** Both scenes and playlists have first-class display-eligibility policies that can combine time windows and conditions. Assignments/schedules, playlist-item playback behavior, scene element-level guards, and eligibility are distinct concerns. Ineligible content is skipped or falls back according to explicit policies; condition errors are never silently coerced to true or false.
- **Reference:** [Decision details](D-030-scene-and-playlist-eligibility.md) · [Content and playback model](../content-model.md)


### D-031 — Screen and screen-group assignment queues

- **Status:** Accepted architectural direction; exact schema and selection semantics remain to be specified
- **Date:** 2026-10-15
- **Decision:** A screen or screen group has a 24-hour assignment schedule; uncovered time is off time unless explicitly configured otherwise. A programme can be a conditional, explicitly ordered sequence of reusable playlists. Playlist entries can have time/condition eligibility and either loop continuously or run a finite number of times; reaching the limit exhausts the entry for the current scheduled occurrence. Scene guards remain independently handled by the scene.
- **Reference:** [Assignment queues](D-031-playlist-composition.md) · [Content and playback model](../content-model.md)
