# Content creation and authoring system

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Scope:** Authoring, preview, publishing, and public/private scene delivery.

## Goal

SiSSi content creation is an asset-first, AI-assisted frontend authoring environment. A creator can upload existing media, ask AI to create or revise a presentation, write the frontend code directly, or bring in artifacts and data produced by MCP-connected tools. These inputs can be combined into a reusable scene.

The authoring experience is not limited to a slide editor. A scene is a frontend presentation built with the SiSSi design system and may include layout, typography, motion, media, data-driven components, multiple logical pages, and scene-owned timelines and time guards.

## Inputs

- **Uploaded assets:** initially images, PDFs, and MP4 video. Keep source assets in a reusable asset library, separate from scene workspaces. The model should allow later MP3/audio support without requiring it in the first upload implementation. See [Asset library and provenance](asset-library.md).
- **AI-authored frontend:** the creator prompts an AI to create or modify a scene's frontend. Generated code must use the SiSSi design system and the documented scene integration contract.
- **Manual code editing:** creators can open and edit the HTML, CSS, and JavaScript directly.
- **MCP-created artifacts or data:** tools connected through MCP may create or retrieve content that can be added to a scene. Treat tool output as an input artifact; validate its type, size, provenance, and permissions before use.

A PDF or video may be an asset displayed directly, or may be incorporated into a richer scene. The asset format does not itself determine whether the result is a scene.

## Server-side Vite workspace

Vite runs on the SiSSi server, never on the signage client. The planned authoring system uses a separate, isolated development workspace per scene:

1. Create or open a scene with a stable UUID.
2. Allocate an isolated scene workspace and start its Vite development server using `npm run dev` on the SiSSi server.
3. Route an authenticated UUID-addressed reverse-proxy URL to that workspace's development server.
4. Let the creator prompt AI, edit source files, upload assets, and incorporate MCP-created artifacts.
5. Show the live development result in the authoring preview.
6. Validate and build the scene, then publish an immutable scene revision.

The UUID is a routing identifier, not an access credential. Authoring URLs must be access-controlled, and one creator's workspace must not be able to read or modify another creator's files or secrets. The development URL is not the public production URL and must not be used as the display's permanent target.

## Staged scene delivery

The delivery order is deliberate:

1. **MVP — native media scenes:** directly display a managed image, PDF, or video using the built-in display runtime. These are structured scene definitions with asset references and type-specific settings; they do not require a scene-specific HTML/CSS/JavaScript application, bundle build, or Node/Vite workspace.
2. **Immediately afterward — AI-authored web scenes:** add custom compositions, layouts, overlays, and interactions through AI-authored or manually edited frontend scenes, with live preview, isolated authoring workspaces, validation/build, review, and publication.

Both remain reusable scenes in the same scene/playback model. Keep native media types deliberately narrow rather than building a general-purpose native composition system. For compositions such as text over an image or a title over a video, start from a suitable template that creates a normal AI-editable web scene. In the basic use case, the creator describes the desired result and supplies/selects content; AI writes and maintains the code, while the creator reviews the preview. Templates may expose structured content fields for routine edits without requiring code regeneration. The native-media MVP must not be blocked by the full web-scene authoring system.

## Preview execution lifecycle

- Initially allocate an isolated execution environment for each active preview workspace; keep the provider boundary runtime-independent and Podman as the first implementation target.
- Explicitly closing the editor starts a short shutdown countdown (initial default: **2 minutes**). Preview inactivity starts a longer countdown (initial default: **20 minutes**).
- Reopening the workspace or meaningful activity before shutdown cancels the pending stop. Define meaningful activity so background browser noise and automatic reloads do not keep a preview alive indefinitely.
- The trusted server-side controller owns timers and reconciles preview environments after server restarts; browser timers are not authoritative.
- Stopping a preview environment preserves the scene workspace and saved files. Start the preview on demand when reopened. Validation/build remains a separate disposable job from a controlled workspace snapshot.
- Protect preview routes through the authenticated reverse proxy and isolate scene execution from management-origin privileges and credentials. Container separation is useful but not a complete security guarantee.

## Three-file source contract

The default scene source consists of exactly three AI-editable core files:

- `index.html` — scene structure and semantic markup.
- `style.css` — scene styling, layout, responsive behavior, and animation styles.
- `script.js` — interaction, data binding, scene lifecycle integration, navigation between logical pages, and scene-owned timeline/time-guard behavior.

AI authoring should modify these three files by default rather than inventing a framework, adding a build system, or spreading ordinary scene logic across many source files. Human creators can edit the same files directly. This is a default authoring contract, not a claim that the final build contains only three files.

Media, fonts, and other user-provided or MCP-generated assets are separate managed resources and can be referenced by the core files. The published build may also contain generated runtime files and a manifest.

### Multiple pages in one scene

A scene may contain multiple logical pages or views while remaining one reusable scene. In the default three-file model, the HTML provides the scene structure and page containers, CSS controls their presentation, and JavaScript manages navigation and active-page state. The scene can implement page changes without involving the playlist controller.

Independently addressable HTML documents or a more complex multi-file application can be considered an explicit advanced mode later; they should not be required for ordinary AI-created scenes.

## Authoring interface

The main authoring layout has two primary areas:

- **Live preview:** a large preview of the running scene, with compact viewport controls.
- **Shared side panel:** a panel beside the preview that contains both the scene's structured **Content** editor and a unified **Action log**. These are views within the same side panel, not separate competing panels.

The Content view lets creators edit the meaningful content of a scene without needing to understand its layout or code. The Action log records AI/MCP operations and human edits, so the creator can understand what changed, by whom or by what mechanism, and inspect or reverse changes where practical. Human edits are first-class log entries, not invisible changes outside the AI/MCP history. Record meaningful edit transactions rather than flooding the log with every individual keystroke; consecutive typing may be grouped into one change.

A separate **Manual** authoring view provides source editor panes for HTML, CSS, and JavaScript alongside the preview. The creator can move between the main preview/content workflow and manual source editing without losing work. Both views share the viewport controls and stay synchronised with the same scene workspace. A full-screen preview may also be available.

The creator can request AI changes through a prompt/action area. AI/MCP actions, content edits, and source changes should be inspectable and reversible where practical. The log should distinguish the actor and action type (for example, AI change, MCP result, human content edit, or manual source edit), identify the affected content or source where possible, and communicate success or failure.

### Viewport controls and target-screen review

Scene creation must not require the creator to choose a physical screen or orientation up front. Keep a compact viewport selector available in both authoring views, using small buttons or equivalent controls for common shapes such as landscape, portrait, and square, plus a custom-dimensions option. These controls change the simulated preview viewport only; they do not change the scene's source or assign it to a device.

The preview must render the running scene at the selected CSS viewport dimensions and aspect ratio, rather than merely scaling a screenshot. The editor may scale the viewport visually to fit the available workspace, but layout and responsive behavior must be evaluated using the selected logical dimensions. Make the selected profile and dimensions visible.

Before publishing, provide a target-screen review step. The creator can select one or more preview profiles, inspect each result, and review detectable issues such as overflow, clipped content, missing assets, and runtime errors. Automated checks are aids, not a guarantee of visual quality; allow the creator to review and approve the result. A scene's intended/verified compatibility is separate from assigning it to actual devices. Do not imply that a scene is suitable for every orientation just because it can be rendered there.

### Structured content panel and editable fields

The Content view in the shared side panel exposes the scene's meaningful, creator-editable content. **AI may decide which fields to expose**, based on the scene's purpose and structure, and should give them clear human-readable labels and group them by logical page or content area. Creators should not have to click arbitrary text or objects on the preview to discover how to edit them.

Editable fields are not limited to text. Depending on the scene, they may include:

- Text fields such as titles, paragraphs, labels, dates, and links, with a constrained set of semantic formatting (headings, paragraphs, emphasis, lists, and links).
- Image or video selections, including choosing a different item from the reusable asset library, uploading a replacement, and seeing a thumbnail/preview where practical.
- Icons, symbols, logos, and other visual choices selected from supported libraries or approved assets.
- Repeatable content groups such as event entries, announcements, people-free schedules, or cards, with actions to add, remove, reorder, and edit entries when appropriate.
- Simple structured values such as dates, times, URLs, and other scene-specific data.

The panel should be tailored to the scene, not a generic dump of every variable. AI-generated scenes should declare a clear content model or equivalent set of editable bindings that maps labelled controls to scene data/presentation. The model can represent text, asset references, icon/symbol identifiers, and repeatable records. It should preserve the distinction between content and presentation: changing a title, image, icon, or event entry should update the preview immediately without unnecessarily regenerating the layout or rewriting unrelated source code. If a field cannot safely or meaningfully be edited through the panel, leave it to AI-assisted or manual source editing.

The same underlying content model must drive the side-panel controls and the preview; it must not become a second, conflicting source of truth. Human changes to these fields are recorded in the unified Action log as meaningful edit transactions and should support undo/review where practical. Asset selection must respect library permissions and preserve asset identity/versioning rules; published revisions continue to pin exact asset versions.

This is structured content editing, not an unrestricted contenteditable layer over arbitrary scene output. Direct preview selection may be offered as a convenience, but it is not required and must not be the primary way to discover or edit content. The manual HTML/CSS/JavaScript view remains available for advanced cases.

Pasted content must be sanitised. Strip unsafe markup, scripts, event handlers, embedded objects, and unsupported styling; retain supported semantic text formatting where possible. The editor must not execute pasted HTML or treat it as trusted code. Use SiSSi design-system conventions rather than importing arbitrary pasted styling. AI/MCP output, asset metadata, and user-entered URLs remain untrusted inputs and must be validated.

### Provenance and review

Each editable field and managed asset must retain provenance and a history of transformations. MCP tools that create or modify content must supply provenance metadata; absent or unverifiable provenance remains unknown rather than being assumed human-authored. Distinguish direct human input, dictated/transcribed input, AI generation, assistive editing, external/tool-sourced material, and unknown origin. Routine grammar or spelling correction is recorded as a transformation while preserving the human-authored origin. Preserve AI-image provenance and compatible embedded manifests where available; only report a C2PA manifest as verified after actual validation.

Add a dedicated Review phase before publication. Reviewers inspect and can edit content, replace assets, inspect provenance, and explicitly approve a defined revision. Record reviewer, time, scope, and outcome; material changes reopen review. Approval does not erase provenance.

Keep provenance, editorial-review status, and disclosure policy as separate dimensions. Maintain versioned global/system assets for applicable AI-transparency labels, with source and licence metadata. Flag unreviewed AI-generated content and apply or recommend labels according to the publication context and configured policy. Do not assume human review universally removes legal disclosure duties.

#### Human correction of provenance errors

Provenance classifications supplied by an MCP tool, AI model, import process, or metadata parser are claims that may be wrong; they are not ground truth. An authorised human reviewer must be able to correct a text field's or asset's origin classification, including an erroneous claim that content or an image is AI-generated. Corrections may select a more accurate known category or mark the origin unknown when it cannot be established.

Record each correction as an auditable provenance event, including the prior claim, corrected classification, person making the correction, timestamp, reason or supporting evidence when provided, affected field/asset and version, and relevant source event. Do not silently overwrite or delete the earlier claim. The current classification should be clear in normal authoring and review views, while the history remains inspectable.

Distinguish tool assertions, machine-readable metadata, successful cryptographic/manifest validation, and human editorial determinations. A human correction records an accountable editorial judgement; it does not itself prove authorship or make an unverified manifest valid. Where evidence is insufficient or disputed, retain an explicit unknown/disputed state rather than forcing a confident label.

When a correction changes facts used by an AI-transparency label or disclosure recommendation, recalculate or flag that decision for review. Keep the provenance correction, editorial approval, and applicable disclosure decision distinct. MCP tools may propose classifications but must not silently undo or overwrite a human correction; any later conflicting claim must be recorded and surfaced for resolution.

## Reusable templates

A **template** is a nearly finished, reusable starting point for creating a scene. It combines a scene structure/layout and behavior with a structured content schema, sensible placeholder/default values, and references to the managed assets it needs. Examples include an upcoming-event announcement, weekly schedule, worship/service information, a notice, or a rotating set of announcements. A template should be useful immediately after a creator fills in the relevant content and should not require HTML/CSS/JavaScript editing for ordinary use.

### Template content and structured fields

- Templates expose named, labelled fields grouped by meaningful content area or logical page, using the same structured content model as the scene Content panel.
- Fields can include text, dates/times, links, icons, logos, images/video, and repeatable entries such as events, cards, notices, or schedule rows where appropriate.
- Placeholder text must be visibly identified as example/default content, not mistaken for confirmed real-world information. Templates may provide illustrative sample values, but should not invent current dates, event details, contact information, or other facts for the creator.
- Asset slots should identify suitable dimensions/roles and accept permitted managed assets. Replacing an image should update the structured binding without requiring a layout rewrite.
- Templates may specify a compatible/default design system and expected viewport profiles. The creator can inspect the result in live preview and adjust structured fields before publishing.

### Instantiating and versioning templates

Choosing a template creates a new, independent editable scene initialized from a specific template version. The new scene has its own stable scene identity, content values, editable source/workspace, history, and publication lifecycle. It is not a live instance that automatically changes whenever the source template changes. Template and scene assets follow the asset-library permission and versioning rules; published scene revisions pin exact asset versions/hashes and the exact released design-system version.

Templates themselves are reusable, versioned resources with identity, ownership/tenant scope, access controls, provenance for included text/media, and immutable released versions. A template author can save a working draft separately from releasing a version. Template-use permission does not automatically grant permission to edit the template, and editing a template does not grant permission to publish the resulting scene to every display. Creating or updating a template must follow content validation and provenance rules.

An existing scene remains based on the template version from which it was created. Later template releases must not silently overwrite it. A future explicit update/rebase workflow may compare changes and let a creator selectively adopt them; exact merge semantics remain to be specified. For the initial implementation, creating a fresh scene from the latest template is supported without requiring rebase support.

The basic workflow is: choose a permitted template, create a scene from its released version, fill or replace the structured fields/assets, preview relevant target-screen profiles, review provenance and content, then publish using the normal scene publication permissions and workflow.

## Design system and scene contract

AI-generated frontend code should follow a versioned SiSSi design system. A design system is a shared resource—not just one global CSS file—with structured visual tokens, CSS rules, optional reusable component conventions, and references to managed assets such as fonts, logos, and icons. Multiple design systems may coexist, and each scene explicitly selects one primary system. Scene-specific CSS may deliberately extend or override the selected system. The initial model does not layer multiple complete design systems into one scene.

Keep three layers distinct: SiSSi platform defaults, the selected design system, and scene-specific styles. Design-system CSS must be scoped/namespaced to avoid leaking into other scenes or the authoring interface. See [Design systems](design-systems.md) for the full contract.

The design-system editor supports both structured controls for common tokens/assets and an advanced CSS editor. Both edit the same underlying resource. Preserve custom CSS that cannot be safely represented by structured controls, surface conflicts, and never silently discard advanced rules. Validate changes and record meaningful human/MCP edits in the Action log.

Use the accepted hybrid update model: drafts follow the selected design system's current working version, so system changes can be assessed in the live preview. Publishing resolves that reference to a specific immutable released version and pins it, plus exact asset versions/hashes, in the scene revision manifest. A published revision or cached bundle must not change when the design system is edited. Applying a design-system update to a published scene requires creating, reviewing, and publishing a new scene revision.

The scene contract distinguishes host lifecycle operations and notifications from scene requests and controller-invoked scene functions. A scene signals readiness and may report natural completion or request closure; the host remains authoritative for interruption, stop, and runtime failure, and applies the configured playback policy to completion/closure. The scene definition also declares any scene-specific functions the controller may invoke (for example, `restart`, `pause`, or `resume` for a timeline scene). The scene implementation supplies each function's behavior; other scene types may expose different functions. The controller discovers these functions from the manifest rather than assuming a universal command set. The runtime validates and dispatches calls through a bounded, host-mediated bridge, enforcing state, capability and authorization checks. Internal timelines, logical-page navigation, and time guards remain under scene control. The scene builder owns the scene's internal structure; the design system supplies visual rules.


## MCP v2 content creation and discovery

MCP v2 is a first-class authoring interface, not merely an import endpoint. It supports discovery, structured content editing, source editing, asset operations, validation, preview, provenance correction, and change review. The full contract is recorded in [D-025](decisions/D-025-mcp-content-creation.md).

### Tenant-aware search and scene metadata

MCP clients can search scenes, templates, and assets across all tenants the authenticated user is authorised to access. Search results include the tenant's short code, stable object ID, and useful descriptive metadata so similarly named items can be distinguished. Search is a tool because it accepts variable filters and may return paginated results. It must enforce the same tenant and resource permissions as direct reads; a tenant code or object ID is never a credential.

Each tenant has a case-insensitively unique, 1–6 character lowercase alphanumeric code for display and discovery. Canonical resource identity and authorization use an immutable internal tenant ID, not this short code. The short-code limit is a product constraint, not an assumption that Git-style short hashes are inherently unique.

Scenes carry rich searchable metadata. The initial model should allow a title, description, tags, intended use/purpose, relevant event or occasion, seasonal relevance or date window, optional event URL, and extensible additional metadata. Exact field types, controlled vocabularies, and validation remain to be defined. Descriptive metadata helps creators find and understand content; it does not replace schedule assignments or scene time guards.

### MCP resources and tools

Use resources primarily for readable canonical state, and tools for searches, mutations, validation, preview requests, and workflow actions. Resource templates address individual tenant-owned objects and subresources. Canonical resource URIs refer to mutable working state using stable internal IDs; immutable releases and snapshots use explicit version/revision identifiers. The proposed URI convention is documented in D-025 and remains a contract to finalise.

Provide a read-only **scene resource index** at `sissi://tenants/{tenantId}/scenes/{sceneId}/resources`. It lists every scene-linked resource URI that the caller may discover, grouped by purpose and annotated with type/relation, mutable-versus-versioned status, current revision where relevant, and a short description. Include metadata, content schema/values, source files, template/design-system/palette references, assets, history, proposals, revisions, previews, and publication/deployment status where available. This is the single discovery point for scene-linked resources; it must not expose inaccessible URIs or leak cross-tenant resource existence.

Provide a read-only scene-dump resource that gives a revision-stamped consolidated snapshot of relevant scene context: metadata, content schema and values, current revision, design-system/template references, asset references, and pending-proposal summaries. Include source content only when requested and permitted. Large sections must remain separately retrievable; the dump must not silently truncate data. Canonical content and pending proposals are always represented separately.

Both structured content editing and source editing are first-class MCP capabilities. Structured tools edit schema-defined fields and repeatable items; source tools edit the permitted `index.html`, `style.css`, and `script.js` files. Asset upload/attachment, scene validation, viewport preview, history, and provenance correction are explicit capabilities. Publishing, template/design-system release, and display assignment remain separate permissioned workflows.

### MCP edit and propose modes

The scene editor exposes **MCP edits** and **MCP proposes** modes. MCP edits is the default. In edits mode, an authorized mutation changes the working draft immediately and creates an auditable history transaction. In proposes mode, the same requested changes create a separate proposal and leave canonical content unchanged until acceptance.

Proposals form an inspectable stack/list of change sets. Each records its actor, time, base revision, target fields/files, proposed patch, provenance, and status, with validation/preview results where available. Overlapping proposals do not silently overwrite each other or the canonical draft. A proposal can explicitly supersede another proposal, with the relationship recorded; otherwise proposals remain independent. The scene-dump resource includes pending-proposal summaries but never folds unaccepted changes into canonical content.

Accepting a proposal checks whether its base revision and affected content still match the current draft. A stale or overlapping proposal produces an explicit conflict requiring resolution/rebase or regeneration. Successful acceptance creates a normal edit transaction and new working revision. Discarded, rejected, superseded, and applied proposals remain auditable under the retention policy. Proposal acceptance is not editorial approval and does not publish the scene.

The effective mode is controlled in the scene editor and enforced by the server for that authoring context; an MCP caller cannot bypass proposal mode by changing an argument. Every mutation retains the provenance and history requirements in the [provenance section](#provenance-and-review).

## MCP publishing, playlists, and deployment

MCP publishing tools are separate from scene authoring tools. The proposed semantic capabilities are: publish a reviewed and validated immutable scene revision; search and read playlists; create/edit playlists and ordered items; configure durations, transitions, playback policies, and time windows; assign playlists to screens or screen groups; push/reconcile a chosen playlist or assignment revision as desired state; inspect rollout and per-client synchronization status; and roll back to a known-good immutable revision.

Publishing must pin the exact scene source, design-system and palette-overlay releases, and asset versions/hashes. Playlist changes and target assignments are explicit operations with separate permissions. Before deployment, show the affected screens/groups and exact revision. Return an operation/deployment identifier and report each client's synchronization separately; accepting a push request does not mean all clients have applied it. Operations should be idempotent, auditable, tenant-scoped, and recoverable. Rollback selects a known-good version rather than mutating a published revision.

Scene editing, editorial review, publication, playlist editing, screen/group assignment, and deployment are distinct permissions. Creating or editing a scene does not grant permission to publish it or change what a display plays. Exact tool names, schemas, rollout state machine, confirmation policy, and rollback semantics remain to be specified.

## Build and publish

The Vite dev server is the live authoring and preview mechanism. It is not the permanent production runtime for signage devices.

Publishing builds the scene into a versioned, immutable delivery artifact: a static web bundle plus a dependency manifest. The bundle contains the built scene application, not the payloads of managed media assets. The manifest records exact managed-asset versions/hashes and distinguishes required from optional dependencies. External URLs, if allowed, are declared separately and are not treated as immutable managed assets. The publisher validates references and confirms that required resources are available. Published revisions remain immutable if a source asset is later updated. On delivery, the client downloads and validates the bundle first, then downloads any missing required asset versions, reusing verified cached versions where possible. It activates only after the bundle and all required dependencies are verified and ready; otherwise it retains its last-known-good revision.

The published build is served by SiSSi at a stable scene URL based on the scene UUID. This production URL is separate from the development preview URL. A scene can be published with one of two access policies:

- **Private/restricted:** requires an authorised access mechanism. Prefer revocable credentials or short-lived signed access over long-lived bearer tokens embedded in URLs.
- **Public/embed-enabled:** intentionally accessible to external websites, for example through an iframe. The publisher must make this choice explicit and apply an appropriate embedding policy.

A UUID is not a secret. Private URLs must not rely on obscurity alone. Query-string bearer tokens can leak through browser history, proxy/access logs, analytics, or referrer headers, so they should not be the default for long-lived access. Public embedding also requires deliberate configuration of allowed framing origins, content security policy, cross-origin resource behavior, and any data/API permissions.

Publishing a scene must not expose workspace files, development-server controls, MCP credentials, AI provider secrets, or device-management credentials. Hosted production delivery and downloadable bundles are separate delivery choices; a transient authoring URL must never be published as though it were a stable production URL.

## Execution provider and isolation

Scene authoring and build execution use a server-side, runtime-independent execution-provider boundary. Podman is the first target, preferably rootless where practical; see [D-034](decisions/D-034-pluggable-execution-provider.md). Keep persistent Vite preview sessions distinct from disposable validation/build jobs. Do not expose a general-purpose shell, arbitrary host paths, a public Podman socket, or host/container-management privileges to MCP or scene code. A successful build is not a security verdict, and only validated candidate artifacts proceed through the separate publication workflow. Whether workers need an in-container supervisor/API remains undecided.

## Isolation and safety requirements

- Give each active authoring workspace a unique UUID and an isolated filesystem/process boundary.
- Authenticate and authorise preview routes; UUIDs are not secrets.
- Restrict resource use, workspace lifetime, network access, and filesystem access.
- Never inject server credentials or MCP connection secrets into generated frontend code or browser-visible environment variables.
- Treat uploaded files, MCP output, and AI-generated code as untrusted until validated.
- Apply file-size/type limits, safe asset serving, and malware/content checks appropriate to the deployment.
- Publish only an explicitly reviewed revision; publishing must not mutate a revision already used by a playlist.
- Keep a clear distinction between source assets, editable workspace files, published scene revisions, and display caches.
- Keep private-scene access controls separate from display-device credentials and management APIs.
- Ensure public scenes receive only the public data and capabilities deliberately allowed by the publisher.

## Still to specify

The implementation contract must define workspace creation and cleanup, per-workspace process supervision, proxy routing, authentication, AI editing boundaries, MCP artifact import, supported upload formats and size limits, dependency/network policy, source-editor behavior, preview lifecycle, build/publishing failures, asset storage and provenance, version replacement and reference-safe deletion, asset-version pinning and scene-update propagation prompts, derived previews, revision rollback, private-scene access, public embedding/CSP policy, and whether advanced multi-file scenes are supported in the first release.

## Authentication boundaries

Authentication must be appropriate to the kind of request; “put the credential in an Authorization header” is the default for API calls where the client can set headers, but it does not solve every browser navigation or iframe case.

- **Authoring UI and APIs:** use the authenticated creator session. Same-site browser requests may use a secure, HttpOnly session cookie; API clients that explicitly set headers may use an Authorization header. Do not expose long-lived credentials to scene JavaScript.
- **Development preview:** the browser's navigation to a preview URL or an ordinary iframe cannot reliably attach an arbitrary Authorization header. Protect the UUID-routed preview through the authenticated reverse proxy, for example with the existing same-site session or a short-lived preview ticket exchanged for a session. The UUID is only an identifier, not a secret.
- **Signage device APIs:** each approved device authenticates its control-plane requests with its own revocable device credential, normally in an Authorization header. Do not make that credential available to the scene's JavaScript execution context.
- **Scene assets:** serve assets through a trusted runtime/asset endpoint or issue narrowly scoped, short-lived access where necessary. Do not pass device-management credentials into arbitrary scene code.
- **Private external embedding:** ordinary iframe navigation cannot set a custom Authorization header. Prefer an explicit same-site session flow where appropriate, or a deliberately designed short-lived, narrowly scoped embed mechanism. Do not use long-lived bearer tokens in query strings.
- **Public embedding:** it must be explicitly enabled and expose only public content and capabilities. Configure CSP frame-ancestors, origin/cross-origin behavior, and data permissions deliberately; an obscure UUID URL is not access control.

Published scene code should be isolated from the SiSSi management application's origin and privileges wherever practical. Apply a restrictive Content Security Policy and sandboxing appropriate to the supported scene features. Never expose server, MCP, AI-provider, or device-management secrets to scene frontend code.
