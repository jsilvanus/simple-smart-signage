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
- [ ] Define display-target schema: hosted URL, packaged web bundle, native layout, and media.
- [ ] Define app origin policy and explicit capabilities, including optional camera access.

Reference: [Device handshake](handshake.md) · [Display runtime](display-runtime.md) · [Decision register](decisions/README.md)

## Phase 2 — Server foundation

- [ ] Create Next.js / TypeScript application.
- [ ] Add PostgreSQL schema and migrations.
- [ ] Implement administrator authentication and authorisation.
- [ ] Implement pending enrollment, verification number, approval, rejection, and expiry.
- [ ] Implement per-device credential issuance, revocation, and audit events.
- [ ] Implement authenticated handshake, configuration, SSE, and heartbeat endpoints.
- [ ] Implement authorised web-app assignment and versioned bundle metadata.

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

## Phase 4 — Content management

- [ ] Create and manage media assets.
- [ ] Create, validate, and version web-app bundles.
- [ ] Create playlists and schedules.
- [ ] Assign display targets to individual screens and screen groups.
- [ ] Preview content and validate schedules.
- [ ] Track content revisions and client sync status.
- [ ] Provide explicit origin/capability controls for web apps.

## Phase 5 — Reliability and operations

- [ ] Add structured server/client logs without secrets.
- [ ] Add device health and last-seen dashboard.
- [ ] Add backup and restore procedures.
- [ ] Test server restart, internet outage, Wi-Fi loss, corrupt downloads, and revoked credentials.
- [ ] Test cold boot, scheduled TV power, and app auto-start on actual hardware.
- [ ] Test packaged-app offline behaviour and rollback.
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

## Delivery rule

A phase is not complete merely because the happy path works. Include failure recovery, permission checks, and tests appropriate to the phase before marking its tasks complete.
