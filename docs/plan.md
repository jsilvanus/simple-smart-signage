# SiSSi plan index

This is the top-level implementation roadmap. Detailed specifications belong in their own documents; this page links to them and tracks the sequence of work.

## Current foundation

- [x] Project name: SiSSi — Simple Smart Signage
- [x] Licence choice: EUPL-1.2
- [x] Initial device lifecycle and handshake proposal
- [x] SSE + HTTPS heartbeat selected
- [x] Administrator approval required for new devices
- [x] Full-screen web runtime selected as the first-class display type
- [ ] Add complete official EUPL-1.2 licence text to `LICENSE`

## Phase 1 — Define the contract

- [ ] Finalise API schemas and error codes.
- [ ] Finalise enrollment secret and device credential lifecycle.
- [ ] Define protocol-version compatibility.
- [ ] Define screen/group assignment and device permissions.
- [ ] Define SSE events, event IDs, reconnect, and reconciliation.
- [ ] Define heartbeat payload and online/offline thresholds.
- [ ] Define the content model: playlists, playlist items, scenes, scene revisions, scene timelines, scene time guards, and display assignments.
- [ ] Define display-target schema: hosted URL, packaged web bundle, and media.
- [ ] Define scene authoring workspace, UUID proxy routing, source editing, preview, build, publishing, and artifact contracts.
- [ ] Define the default three-file source contract and multiple logical pages within a scene.
- [ ] Define asset identity/versioning and MCP artifact import validation.
- [ ] Define private scene access and public embedding policy.
- [ ] Define authentication boundaries for authoring, preview, device APIs, assets, and embedded scenes.
- [ ] Define app origin policy and explicit capabilities, including optional camera access.

Reference: [Device handshake](handshake.md) · [Display runtime](display-runtime.md) · [Content and playback model](content-model.md) · [Content creation system](creation-system.md) · [Decision register](decisions/README.md)

## Phase 2 — Server foundation

- [ ] Create Next.js / TypeScript application.
- [ ] Add PostgreSQL schema and migrations.
- [ ] Implement administrator authentication and authorisation.
- [ ] Implement pending enrollment, verification number, approval, rejection, and expiry.
- [ ] Implement per-device credential issuance, revocation, and audit events.
- [ ] Implement authenticated handshake, configuration, SSE, and heartbeat endpoints.
- [ ] Implement authorised web-app assignment and versioned bundle metadata.
- [ ] Define isolated authoring-workspace process, Vite lifecycle, and reverse-proxy management.

## Phase 3 — First display client

- [ ] Select the first supported hardware/platform.
- [ ] Implement onboarding splash screen and verification number.
- [ ] Implement approved-device credential storage.
- [ ] Implement handshake and configuration sync.
- [ ] Implement full-screen hosted web-app display.
- [ ] Implement packaged web-bundle download, integrity checks, atomic activation, and rollback.
- [ ] Implement media cache, integrity checks, and atomic playlist switching.
- [ ] Implement SSE reconnect and HTTPS heartbeat.
- [ ] Implement offline playback and startup recovery.
- [ ] Validate camera permissions and browser APIs on target hardware before advertising webcam support.

## Phase 4 — Content creation and management

- [ ] Manage reusable uploaded assets, initially images, PDFs, and MP4 video.
- [ ] Define supported upload types, size limits, storage, validation, and asset versioning.
- [ ] Implement per-scene Vite authoring workspace on the SiSSi server using `npm run dev`.
- [ ] Expose each workspace through an authenticated UUID-addressed reverse proxy.
- [ ] Build the authoring view with live preview, HTML/CSS/JavaScript editors, and MCP/AI action log.
- [ ] Integrate AI-assisted scene creation and editing using the SiSSi design system and three-file source contract.
- [ ] Support multiple logical pages/views within a scene.
- [ ] Import and validate artifacts/data produced by MCP-connected tools.
- [ ] Build, validate, and publish immutable scene revisions at stable UUID-based SiSSi URLs.
- [ ] Implement explicit private/restricted and public/embed-enabled scene access policies.
- [ ] Publish versioned bundles for cacheable/offline display playback.
- [ ] Create playlists and playlist items, including playback policies and transitions.
- [ ] Configure scene-owned time guards and evaluate scene eligibility during playback.
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

## Phase 6 — Additional platforms and release

- [ ] Evaluate Samsung Tizen support.
- [ ] Verify supported platform lifecycle, kiosk limitations, and camera APIs.
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

## Delivery rule

A phase is not complete merely because the happy path works. Include failure recovery, permission checks, and tests appropriate to the phase before marking its tasks complete.
