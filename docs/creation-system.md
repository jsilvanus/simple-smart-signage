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

The creation view should combine live preview, source editing, and an MCP/AI action log. A useful starting layout is:

- **Large live preview** of the running Vite scene.
- **Source editor panes** for HTML, CSS, and JavaScript.
- **MCP/AI action log** showing tool actions and their results, with enough context to inspect what the assistant did.
- **Prompt/action area** for requesting changes and reviewing proposed edits.

The UI may offer a full-screen preview mode as well as a source-focused split view. The preview and editors should stay synchronized as the source changes. Tool actions and code changes should be inspectable and reversible where practical.

### Viewport controls and target-screen review

Scene creation must not require the creator to choose a physical screen or orientation up front. Keep a compact viewport selector available in both authoring views, using small buttons or equivalent controls for common shapes such as landscape, portrait, and square, plus a custom-dimensions option. These controls change the simulated preview viewport only; they do not change the scene's source or assign it to a device.

The preview must render the running scene at the selected CSS viewport dimensions and aspect ratio, rather than merely scaling a screenshot. The editor may scale the viewport visually to fit the available workspace, but layout and responsive behavior must be evaluated using the selected logical dimensions. Make the selected profile and dimensions visible.

Before publishing, provide a target-screen review step. The creator can select one or more preview profiles, inspect each result, and review detectable issues such as overflow, clipped content, missing assets, and runtime errors. Automated checks are aids, not a guarantee of visual quality; allow the creator to review and approve the result. A scene's intended/verified compatibility is separate from assigning it to actual devices. Do not imply that a scene is suitable for every orientation just because it can be rendered there.

### Visual text editing

In the main authoring view, provide a WYSIWYG-style way to create and edit ordinary text without requiring the creator to edit HTML. The creator should be able to select an editable text region in the preview (or open it in a text-editing panel), type or paste content, and apply a small, predictable set of formatting such as headings, paragraphs, emphasis, lists, and links. The preview updates immediately. The manual source view remains available for full control.

This is a structured editing affordance, not an unrestricted contenteditable layer over arbitrary scene output. AI-authored scenes should expose identifiable editable text blocks/fields where appropriate; complex decorative or data-driven elements may remain source/AI-edited. The text editor and source files must stay synchronized, and changes should be inspectable and reversible where practical. Use the SiSSi design system for typography and formatting rather than importing arbitrary pasted styling.

Pasted content must be sanitised. Strip unsafe markup, scripts, event handlers, embedded objects, and unsupported styling; retain supported semantic text formatting where possible. The editor must not execute pasted HTML or treat it as trusted code. A creator can always switch to manual HTML/CSS/JavaScript editing for advanced cases.

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
