# Content creation and authoring system

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Scope:** Authoring and preview, not the display client's playback contract.

## Goal

SiSSi content creation is an asset-first, AI-assisted frontend authoring environment. A creator can upload existing media, ask AI to create or revise a presentation, or bring in artifacts and data produced by MCP-connected tools. These inputs can be combined into a reusable scene.

The authoring experience should not be limited to a slide editor. A scene is a frontend presentation built with the SiSSi design system and may include layout, typography, motion, media, data-driven components, and scene-owned timelines and time guards.

## Inputs

- **Uploaded assets:** images, PDFs, MP4 video, and other explicitly supported file types. Keep source assets as managed assets so they can be reused across scenes.
- **AI-authored frontend:** the creator prompts an AI to create or modify a scene's frontend. Generated code must use the SiSSi design system and the documented scene integration contract.
- **MCP-created artifacts or data:** tools connected through MCP may create or retrieve content that can be added to a scene. Treat tool output as an input artifact; validate its type, size, provenance, and permissions before use.
- **Manual edits:** creators must be able to review and adjust the result rather than relying exclusively on AI.

A PDF or video may be an asset displayed directly, or may be incorporated into a richer scene. The asset format does not itself determine whether the result is a scene.

## Per-scene Vite environment

The planned authoring system uses a Vite development environment for live scene editing and preview:

1. Create or open a scene with a stable UUID.
2. Allocate an isolated scene workspace and start its Vite development server using `npm run dev`.
3. Route a UUID-addressed reverse-proxy URL to that scene's development server.
4. Let the creator prompt AI to create or revise the frontend, upload assets, and incorporate MCP-created artifacts.
5. Show the running result in a preview using the same design system and scene contract.
6. Validate, review, and publish an immutable scene revision.

The UUID is a routing identifier, not an access credential. Authoring URLs must be access-controlled, and one creator's workspace must not be able to read or modify another creator's files or secrets.

## Design system and scene contract

AI-generated frontend code should follow a versioned SiSSi design system: reusable layout primitives, typography, spacing, colours, media handling, responsive rules, and accessible defaults. The system should also provide a documented scene contract for readiness, start, stop, and optional completion, while leaving internal timelines and time guards under scene control.

Design-system and runtime-contract versions should be recorded with each published revision so a later change does not silently alter an already published scene.

## Preview versus published delivery

The Vite dev server is the live authoring and preview mechanism. It should not be assumed to be the permanent production runtime for signage devices.

Publishing creates a versioned, immutable delivery artifact—initially a static web bundle plus a manifest—containing the scene frontend and the dependencies that are allowed to be packaged. The publisher validates references, records asset hashes, and checks that required resources are available. The display runtime downloads and verifies the artifact before activation, and retains its last known-good revision if preparation fails.

Hosted URL delivery can remain available for explicitly approved cases, but should not be confused with a creator's transient development URL. Production publishing must not expose source workspace files, development-server controls, MCP credentials, AI provider secrets, or device-management credentials to a display.

## Isolation and safety requirements

- Give each active authoring workspace a unique UUID and an isolated filesystem/process boundary.
- Authenticate and authorise preview routes; UUIDs are not secrets.
- Restrict resource use, workspace lifetime, network access, and filesystem access.
- Never inject server credentials or MCP connection secrets into generated frontend code or browser-visible environment variables.
- Treat uploaded files, MCP output, and AI-generated code as untrusted until validated.
- Apply file-size/type limits, safe asset serving, and malware/content checks appropriate to the deployment.
- Publish only an explicitly reviewed revision; publishing must not mutate a revision already used by a playlist.
- Keep a clear distinction between source assets, editable workspace files, published scene revisions, and display caches.

## Still to specify

The implementation contract must define workspace creation and cleanup, per-workspace process supervision, proxy routing, authentication, AI editing boundaries, MCP artifact import, supported upload formats and size limits, dependency/network policy, preview lifecycle, publishing/build failures, asset storage, revision rollback, and whether an optional hosted production scene is supported in the first release.
