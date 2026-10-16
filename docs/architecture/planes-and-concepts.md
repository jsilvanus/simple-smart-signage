# SiSSi architecture: planes and concepts

- **Status:** Architecture overview
- **Date:** 2026-10-15
- **Scope:** Conceptual map of the system, its responsibilities, and the boundaries between them.
- **Related decisions:** D-014, D-015, D-016, D-018–D-021, D-022–D-031, D-033–D-036, D-051–D-052.

This document groups SiSSi's concepts into architectural planes. A plane describes responsibility; it does not require a separate service or package. The implementation may combine several planes while preserving their conceptual boundaries.

## System at a glance

SiSSi is a centrally managed digital-signage system. People and integrations create reusable content, publish immutable revisions, arrange content into playlists and programmes, assign desired playback to screens or screen groups, and monitor whether clients have accepted and activated that state. Display clients prepare and cache content, play it locally when possible, and reconnect to the server over outbound HTTPS.

The main flow is:

1. Create and edit assets, design systems, scenes, and layouts.
2. Review and publish immutable content revisions.
3. Assemble scenes and layouts into playlist entries and, where needed, ordered programmes.
4. Define assignment queues and schedules for screens or screen groups.
5. Resolve eligibility, conditions, and active overrides into desired playback state.
6. Deliver that state and required assets to clients.
7. Clients prepare, activate, play, report health, and synchronize changes.
8. Operators and authorized MCP clients inspect state, diagnose problems, and make permitted changes.

## A. Authoring and creation plane

**Purpose:** Create, edit, review, and version the material that can appear on a display.

Concepts:

- **Project / workspace:** A governed context for related content and collaboration.
- **Scene:** The primary reusable content unit. A scene may be a full-screen web app, a media-oriented scene, or another supported display type. It may have internal views/pages, content fields, timing, and declared actions.
- **Layout:** A reusable composition that places scenes or other supported content in regions. It is separate from playlist sequencing.
- **Scene editor:** Structured content editing and manual source editing over the same working scene. The default web-scene contract uses the files index.html, style.css, and script.js, with assets managed separately.
- **Live preview:** An authenticated server-side authoring preview at a chosen logical viewport, separate from production playback.
- **Execution provider:** A runtime-independent server-side boundary for preview sessions and disposable validation/build jobs. Podman is the first target; other sandbox/runtime implementations may be added later.
- **Action log / change history:** Auditable human, AI, and MCP edits; proposals can be reviewed and resolved rather than silently overwriting canonical work.
- **Review:** Approval of a particular revision/scope before publication; material changes can invalidate approval.
- **Template:** A versioned starting point instantiated as an independent scene.
- **Design system:** Shared visual tokens, CSS rules, conventions, and asset references. A scene chooses a primary system and may use compatible overlays, such as a palette overlay.
- **Viewport profile:** A logical target size/aspect ratio used for authoring and pre-publication review. It is not a device assignment.
- **Provenance:** Origin and transformation history for content and assets, including human, dictated/transcribed, AI-generated, AI-assisted, external/tool-sourced, and unknown origins.

Boundaries:

- Working drafts and live authoring workspaces may be mutable; saved managed-object versions and published content revisions are immutable. See D-051 for object identity, version history, archival, and garbage collection.
- AI/MCP output and uploaded files are untrusted input until validated.
- Authoring code and previews do not receive device-management credentials or server-side integration secrets.
- Structured content editing must not silently rewrite arbitrary source or discard unsupported custom CSS.

## B. Content and asset plane

**Purpose:** Represent, store, version, and deliver reusable content dependencies.

Concepts:

- **Asset library:** Reusable images, PDFs, videos, and future supported media, stored separately from scenes.
- **Asset identity and versions:** Stable asset IDs with versions/content hashes. Published revisions pin exact asset versions.
- **Asset provenance:** Original source, uploader, creator attribution when known, initial project/scene context, rights notes, and derived-preview lineage.
- **Scene revision:** An immutable published build of a scene, including the design-system release and asset versions it depends on.
- **Scene bundle:** A cacheable set of built scene application files plus a manifest; managed media payloads are not embedded in the bundle.
- **Bundle dependency manifest:** Pins exact managed-asset versions/hashes and identifies required versus optional dependencies. External URLs are declared separately and are not treated as immutable managed assets.
- **Access policy:** Explicit private/restricted or public/embed-enabled access; a UUID is an identifier, not a secret or authorization mechanism.
- **Derived artifacts:** Thumbnails, renders, previews, and generated variants distinguished from original sources.

Boundaries:

- Updating a source asset does not mutate existing published revisions.
- Propagation to editable scene references is explicit; pinned references are never silently retargeted.
- Content identity/versioning is separate from playlist occurrence and playback state.
- Asset access obeys tenant and resource permissions.

## C. Playback orchestration plane

**Purpose:** Decide what should play, in what order, and under which playback rules.

Concepts:

- **Playlist:** An ordered sequence of playlist entries. It is a primary programming unit and can be assigned to screens/groups or included in a programme.
- **Playlist entry:** A particular occurrence/reference to a reusable scene or layout, with playback-specific settings such as effective duration, transitions, and repeat policy.
- **Programme:** An explicitly ordered, potentially conditional sequence of reusable playlists.
- **Assignment queue:** The desired programming for a screen or screen group across the day, with uncovered time treated as off-time unless configured otherwise.
- **Schedule:** Determines when an assignment is active. Calendar-date schedules take precedence over weekday schedules; the chosen schedule is exclusive. Copying a schedule to a date creates an independent snapshot.
- **Eligibility:** Determines whether a scene, playlist, or playlist entry is allowed to be selected now. It is separate from schedule activation and from timing guards inside a scene.
- **Playback policy:** Defines progression, looping, finite runs, end-of-entry behavior, and what happens when no content is eligible.
- **Concurrent playlist composition:** Allows more than one playlist to contribute content to a display composition at the same time, while each retains its own sequence and playback state.
- **Override:** A temporary, higher-priority playback/composition instruction layered over the normal desired state. An override has an **override style**:
  - **WITH:** Add the override playlist alongside base playback in another region, such as picture-in-picture or split-screen. Base playback continues underneath and retains its state.
  - **REPLACE:** Temporarily take over the whole display. Base playback state is preserved and resumes when the override ends.
- **Override policy:** Defines target screens/groups, priority, activation/deactivation, expiry, manual stop, fallback, conflict handling, and audit. The compositor and target client capabilities determine whether a requested composition is supportable.

The WITH/REPLACE override styles are not a separate special-broadcast content model. A special broadcast is represented through the concurrent-playlist/override model; “special broadcast” may remain as a user-facing workflow or label.

Boundaries:

- Scenes and layouts define content/presentation; playlists and programmes define sequencing.
- Schedules define when an assignment is active; eligibility determines whether candidate content may run.
- Playlist-entry duration does not silently override scene-level guards.
- Concurrent playlists must not be conflated with a layout that merely contains multiple scenes.
- Overrides do not mutate or reset the underlying base playlist state.

## D. Presentation and composition plane

**Purpose:** Determine how simultaneously active content is arranged and rendered on a display.

Concepts:

- **Layout regions:** User-defined regions with position, dimensions, overlap, and stacking order. Free-form layouts are primary; PiP, split-screen, and four-way split are convenience templates.
- **Compositor:** The SiSSi runtime component that renders active regions and coordinates their visibility and geometry. Hardware TV PiP is not assumed.
- **Region lifecycle/end policy:** What to do when a scene in a region finishes: hold the last frame, replace/advance the region, clear it or show a placeholder, collapse/reflow where supported, or end the whole layout when explicitly configured.
- **Transitions:** Supported visual change between entries/regions, subject to client capabilities.
- **Audio focus:** Policy for avoiding accidental simultaneous audio when more than one active region can produce sound.
- **Capability negotiation:** Check whether a client can render the requested layout, media, interaction, and transition behavior; report unsupported compositions and apply explicit fallback rules.

Boundaries:

- A layout is not a playlist and does not own the sequencing state of concurrent playlists.
- Presentation does not grant permission to run a playlist or override; orchestration and authorization decide that.
- A scene's normal completion is distinct from a runtime error or operator interruption.

## E. Runtime and device plane

**Purpose:** Execute assigned playback reliably on real screens and manage device lifecycle.

Concepts:

- **Display client:** A managed shell with a pluggable runtime; Android TV is the initial target, with Tizen as a possible additional target.
- **Display runtime:** Runs supported display types, including hosted web apps and versioned locally cached web bundles.
- **Desired state:** The server's currently intended assignment/composition for a screen, including revisions, schedules, and active overrides.
- **Preparation and activation:** Download and validate the scene bundle first, then ensure its required managed assets are cached and verified before switching to a new revision; reuse cached asset versions across bundles and preserve last-known-good playback if preparation fails.
- **Local cache / offline playback:** Retain approved content and continue playback during temporary network/server outages, within policy and expiry limits.
- **Heartbeat and runtime status:** Authenticated device health reports and playback/runtime diagnostics.
- **Device enrollment:** New clients self-register into a pending state and show a verification number. An administrator approves the device before it receives trusted access.
- **Device credential:** Unique and revocable; the human-verification number is never an authentication credential.
- **Capability profile:** Reports supported display types, media, layout modes, camera/interaction capabilities, and relevant runtime constraints.

Boundaries:

- Clients initiate network connections; no inbound connection to a television is required.
- Scene JavaScript is not trusted with device-management credentials.
- Server acceptance, client synchronization, and actual activation are separate statuses.
- Camera access is opt-in and off by default. SiSSi prohibits identifying people, persistent person tracking, storing/transmitting camera frames, and linking camera-derived observations to identity or personal records. Audio/microphone analysis is prohibited for the planned gesture feature.

## F. API and integration plane

**Purpose:** Let scenes and trusted services retrieve external data and request permitted actions without exposing secrets or bypassing policy.

Concepts:

- **Scene-authored API request:** A scene may call public/browser-accessible endpoints directly using ordinary web mechanisms. CORS, network reachability, and the external service's authentication rules still apply. Each public endpoint does not need to become a plugin action.
- **Configured API connection:** A named, administrator-configured integration for private or privileged services, server-held credentials, constrained destinations/resources, and response handling. Scene code invokes it through a documented SiSSi interface; secrets remain server-side.
- **Runtime action:** A host-mediated request that affects player lifecycle, navigation, devices, or another privileged capability.
- **Plugin action:** A registered, namespaced, versioned action with input/output schemas, required scopes/capabilities, resource targets, and execution policy.
- **Connection versus action:** A connection identifies how SiSSi reaches a service and what resources/request policies are available. An action defines an operation that can be invoked against a configured connection. They are related but distinct.
- **External condition connector:** A server-side request/mapping mechanism for evaluating values such as event data or livestream state, with freshness and explicit unknown/error behavior.

Boundaries:

- Declaring an action in a scene does not grant permission to execute it.
- Tenant/display policy, connection configuration, and runtime authorization independently govern access.
- Server-side HTTP integrations must validate destinations, block SSRF/private-network targets by default, enforce timeouts and response/payload limits, and avoid leaking secrets in logs.
- Scenes cannot fabricate host-owned outcomes such as “device offline” or “publishing succeeded.” They can report a request or interaction result; the host owns authoritative lifecycle outcomes.

## G. Identity, permissions, and security plane

**Purpose:** Establish who or what is acting, in which tenant, and with which rights.

Concepts:

- **Tenant:** Security and ownership boundary for centrally managed or self-hosted installations.
- **User identity and tenant membership:** A person is distinct from their membership and roles in each tenant.
- **Role and resource grant:** Permissions for content editing, review, publication, integrations/MCP, devices, and screen groups. Editing content does not imply publishing or assignment rights.
- **OAuth for MCP:** User-authorized, tenant-selected, capability-scoped access using appropriate OAuth protections, expiring tokens, revocation, and audit.
- **Device authentication:** Separate per-device credentials and permissions.
- **Scene access policy:** Controls private/restricted access and public embedding independently from authoring access.
- **Secret boundary:** Server and integration credentials remain server-side; browser scenes receive only narrow, scoped results.
- **Audit:** Security-sensitive actions, grants, publication, overrides, and integration calls are recorded without logging secrets.

Boundaries:

- Every operation is authorized server-side and scoped to the tenant and resource.
- A platform super-administrator does not automatically receive unrestricted access to tenant content.
- UUIDs and verification numbers are not credentials.
- A scene's declared capabilities are a request/contract, not an authorization grant.

## H. Publishing and delivery plane

**Purpose:** Turn reviewed working content and desired programming into reliable, traceable releases.

Concepts:

- **Publish:** Build and release a reviewed, immutable scene revision with exact dependencies.
- **Desired-state deployment:** Assign the intended playlist/programme/composition to a screen or group and reconcile it with current state.
- **Server acceptance:** The server has accepted and stored a desired-state update.
- **Client synchronization:** A particular client has received required state and assets.
- **Activation:** The client has prepared and switched to the new state.
- **Rollout status:** Per-screen reporting of accepted revision, download/preparation progress, active revision, and errors.
- **Rollback:** Restore a previously known-good published revision or desired state through an explicit operation.
- **Public embed versus private delivery:** Explicitly different access modes; production scene URLs are not transient authoring URLs.

Boundaries:

- Publishing a scene does not by itself assign it to a display.
- A server-side success response does not prove every client synchronized or activated the change.
- A client does not activate incomplete or unverified bundles.
- Rollback must not mutate immutable historical revisions.

## I. Control and synchronization plane

**Purpose:** Keep server intent, connected clients, and offline clients consistent over time.

Concepts:

- **SSE over HTTPS:** Server-to-client live notifications for updates.
- **Authenticated HTTPS heartbeat:** Client-to-server health and state reporting.
- **Desired/current state reconciliation:** The server records intended state; clients report their observed state and converge when reachable.
- **Revision and occurrence identity:** Stable IDs distinguish scene revisions, playlist entries/occurrences, assignments, and override instances.
- **Reconnect and catch-up:** Clients recover missed updates after temporary disconnection and fetch current authoritative state.
- **Conflict and precedence rules:** Explicit ordering among schedule selection, base assignment, concurrent playlist composition, and active overrides.

Boundaries:

- Live notifications are hints to synchronize, not the only source of truth.
- Offline playback can continue from verified cache, but new state is activated only after required content is prepared.
- Client state reports must distinguish desired, downloaded, prepared, and active state.

## J. Conditions and external state plane

**Purpose:** Evaluate whether content or assignments are eligible using time and external data.

Concepts:

- **Calendar/time condition:** Time windows evaluated in the screen/group's configured local timezone, including defined daylight-saving behavior.
- **External condition:** A configured API value, livestream state, or other external signal.
- **Eligibility policy:** Reusable rule attached to a scene, playlist, playlist entry, programme entry, assignment, or override.
- **Evaluation cadence and freshness:** How often a condition is checked and how long a result remains valid.
- **Unknown/error policy:** Explicit handling for timeout, malformed response, missing field, stale data, or unavailable provider.
- **Condition result:** A timestamped, bounded, auditable value; it does not directly mutate content.

Boundaries:

- Condition evaluation is separate from content rendering and scene JavaScript.
- Missing or failed data must not silently become true or false.
- External URLs and response-derived destinations require validation.
- Time guards inside a scene remain distinct from schedule activation and playlist eligibility.

## K. Management, automation, and MCP plane

**Purpose:** Make system resources discoverable and enable authorized human or agent workflows.

Concepts:

- **Management UI:** Authoring, review, design systems, asset library, playlist editing, schedules, screen groups, device enrollment, monitoring, and audit.
- **MCP resource index:** A canonical, permission-filtered index of resources connected to a scene, with stable URIs and IDs.
- **MCP resources:** Readable canonical state, including revision-stamped scene dumps; pending proposals are not presented as canonical state.
- **MCP tools:** Search and inspect content; edit or propose changes; publish reviewed revisions; edit playlist entries; assign screens/groups; push desired state; inspect rollout and rollback.
- **Edit/propose modes:** Direct edits update working state subject to authorization; proposals are independent change sets based on a specific revision and require explicit resolution if stale or overlapping.
- **Automation:** Scheduled or condition-driven workflows that invoke the same authorized server operations as interactive users.
- **Auditability:** Identify actor, tenant, resource, operation, result, and relevant revision for consequential operations.

Boundaries:

- MCP is an interface to SiSSi, not a bypass around permissions, review, or publication.
- Resource visibility and tool availability are filtered by current authorization.
- Accepting an edit proposal changes working state; it does not publish automatically.
- Publishing, server acceptance, client synchronization, and activation remain distinct.

## L. Observability and governance plane

**Purpose:** Make the system understandable, diagnosable, accountable, and safe to operate.

Concepts:

- **Operational health:** Device connectivity, heartbeats, runtime errors, download/preparation failures, and current active revision.
- **Content health:** Missing assets, invalid revisions, unsupported media/layouts, overflow/clipping, and authoring/runtime errors.
- **Deployment health:** Server acceptance, client synchronization, activation, drift, and rollback history.
- **Audit trail:** Security, permission, editorial review, provenance corrections, publishing, assignment, override, and integration events.
- **Privacy and governance:** Data minimization, retention rules, explicit capabilities, no identity inference from camera input, and strict separation of content provenance from disclosure/review decisions.
- **Fallback policy:** Defined behavior when a client, integration, condition provider, or content revision fails.

Boundaries:

- Logs and telemetry must not contain credentials, raw camera frames, or unnecessary personal data.
- A runtime failure is not the same as normal scene completion.
- Monitoring should report uncertainty and stale state rather than imply success without evidence.

## Cross-plane boundaries to preserve

| Concern | Owns | Must not be conflated with |
|---|---|---|
| Reusable visual/content definition | Scene, layout, design system, asset | Playlist order or display assignment |
| Playback order and duration | Playlist entry, programme, playback policy | Scene's internal timeline or layout geometry |
| When a target is active | Assignment queue and schedule | Scene/playlist eligibility |
| Whether an item may run | Eligibility and conditions | Schedule selection or presentation |
| Simultaneous presentation | Layout/compositor and concurrent playlist composition | Playlist sequencing state |
| Temporary priority behavior | Override with WITH or REPLACE style | A separate content model or mutation of base playback |
| External service access | Connection plus action/request contract | Authorization grant or exposed secret |
| Publication | Immutable revision and release | Assignment, synchronization, or activation |
| Client health | Observed device/runtime state | Desired state or proof of successful activation |
| Provenance and review | Origin history and approval record | A universal legal conclusion about disclosure |

## End-to-end conceptual flow

    Assets + Design Systems
              |
              v
       Scene / Layout Authoring -----> Review
              |                         |
              v                         v
          Immutable Publish <-----------+
              |
              v
    Playlist Entries -> Playlists -> Programme (optional)
              |              |
              +--------------+
                     |
                     v
       Screen / Screen-Group Assignment Queue
                     |
              Schedule + Eligibility
                     |
            Base desired playback
                     |
         Concurrent playlists / overrides
               (WITH or REPLACE)
                     |
                     v
          Composition + Capability Check
                     |
                     v
             Desired State Delivery
                     |
                     v
          Client Prepare -> Verify -> Activate
                     |
                     v
          Playback + Heartbeat + Telemetry

External APIs/conditions ---> Eligibility and authorized scene requests
MCP/UI/Automation ----------> Authorized authoring, publishing, and control operations
Identity/permissions -------> Enforced across every protected operation

## Implementation guidance

Keep these as conceptual boundaries even if the first release implements several in one Next.js application. Prefer explicit schemas and service interfaces between authoring, immutable publishing, playback resolution, authorization, integration execution, and client synchronization. Do not prematurely split planes into separate network services.

The exact API schemas, state machines, precedence rules, fallback semantics, and implementation packaging remain subject to the linked decision documents. This overview summarizes the architecture; it does not replace the detailed decisions.
