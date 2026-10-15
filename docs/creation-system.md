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

## Design system and scene contract

AI-generated frontend code should follow a versioned SiSSi design system: reusable layout primitives or equivalent CSS conventions, typography, spacing, colours, media handling, responsive rules, and accessible defaults. The system should provide a documented scene contract for readiness, start, stop, and optional completion, while leaving internal timelines, page navigation, and time guards under scene control.

Design-system and runtime-contract versions should be recorded with each published revision so a later change does not silently alter an already published scene.

## Build and publish

The Vite dev server is the live authoring and preview mechanism. It is not the permanent production runtime for signage devices.

Publishing builds the scene into a versioned, immutable delivery artifact—initially a static web bundle plus a manifest. The publisher validates references, records exact asset versions/hashes, and checks that required resources are available. Published revisions remain immutable if a source asset is later updated. The display runtime downloads and verifies the artifact before activation, and retains its last known-good revision if preparation fails.

The published build is served by SiSSi at a stable scene URL based on the scene UUID. This production URL is separate from the development preview URL. A scene can be published with one of two access policies:

- **Private/restricted:** requires an authorised access mechanism. Prefer revocable credentials or short-lived signed access over long-lived bearer tokens embedded in URLs.
- **Public/embed-enabled:** intentionally accessible to external websites, for example through an iframe. The publisher must make this choice explicit and apply an appropriate embedding policy.

A UUID is not a secret. Private URLs must not rely on obscurity alone. Query-string bearer tokens can leak through browser history, proxy/access logs, analytics, or referrer headers, so they should not be the default for long-lived access. Public embedding also requires deliberate configuration of allowed framing origins, content security policy, cross-origin resource behavior, and any data/API permissions.

Publishing a scene must not expose workspace files, development-server controls, MCP credentials, AI provider secrets, or device-management credentials. Hosted production delivery and downloadable bundles are separate delivery choices; a transient authoring URL must never be published as though it were a stable production URL.

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
