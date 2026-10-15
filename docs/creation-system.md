# Content creation and authoring system

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Scope:** Authoring, preview, publishing, and public/private scene delivery.

## Goal

SiSSi content creation is an asset-first, AI-assisted frontend authoring environment. A creator can upload existing media, ask AI to create or revise a presentation, write the frontend code directly, or bring in artifacts and data produced by MCP-connected tools. These inputs can be combined into a reusable scene.

The authoring experience is not limited to a slide editor. A scene is a frontend presentation built with the SiSSi design system and may include layout, typography, motion, media, data-driven components, multiple logical pages, and scene-owned timelines and time guards.

## Inputs

- **Uploaded assets:** images, PDFs, MP4 video, and other explicitly supported file types. Keep source assets as managed assets so they can be reused across scenes.
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

## Design system and scene contract

AI-generated frontend code should follow a versioned SiSSi design system: reusable layout primitives or equivalent CSS conventions, typography, spacing, colours, media handling, responsive rules, and accessible defaults. The system should provide a documented scene contract for readiness, start, stop, and optional completion, while leaving internal timelines, page navigation, and time guards under scene control.

Design-system and runtime-contract versions should be recorded with each published revision so a later change does not silently alter an already published scene.

## Build and publish

The Vite dev server is the live authoring and preview mechanism. It is not the permanent production runtime for signage devices.

Publishing builds the scene into a versioned, immutable delivery artifact—initially a static web bundle plus a manifest. The publisher validates references, records asset hashes, and checks that required resources are available. The display runtime downloads and verifies the artifact before activation, and retains its last known-good revision if preparation fails.

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

The implementation contract must define workspace creation and cleanup, per-workspace process supervision, proxy routing, authentication, AI editing boundaries, MCP artifact import, supported upload formats and size limits, dependency/network policy, source-editor behavior, preview lifecycle, build/publishing failures, asset storage, revision rollback, private-scene access, public embedding/CSP policy, and whether advanced multi-file scenes are supported in the first release.
