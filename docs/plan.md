# SiSSi plan index

This is the top-level implementation roadmap. Detailed specifications belong in their own documents; this page links to them and tracks the sequence of work.

## Current foundation

- [x] Project name: SiSSi — Simple Smart Signage
- [x] Licence choice: EUPL-1.2
- [x] Initial device lifecycle and handshake proposal
- [x] SSE + HTTPS heartbeat selected
- [x] Administrator approval required for new devices
- [ ] Add complete official EUPL-1.2 licence text to `LICENSE`

## Phase 1 — Define the contract

- [ ] Finalise API schemas and error codes.
- [ ] Finalise enrollment secret and device credential lifecycle.
- [ ] Define protocol-version compatibility.
- [ ] Define screen/group assignment and device permissions.
- [ ] Define SSE events, event IDs, reconnect, and reconciliation.
- [ ] Define heartbeat payload and online/offline thresholds.

Reference: [Device handshake](handshake.md) · [Decision register](decisions/README.md)

## Phase 2 — Server foundation

- [ ] Create Next.js / TypeScript application.
- [ ] Add PostgreSQL schema and migrations.
- [ ] Implement administrator authentication and authorisation.
- [ ] Implement pending enrollment, verification number, approval, rejection, and expiry.
- [ ] Implement per-device credential issuance, revocation, and audit events.
- [ ] Implement authenticated handshake, configuration, SSE, and heartbeat endpoints.

## Phase 3 — First display client

- [ ] Select the first supported hardware/platform.
- [ ] Implement onboarding splash screen and verification number.
- [ ] Implement approved-device credential storage.
- [ ] Implement handshake and configuration sync.
- [ ] Implement media cache, integrity checks, and atomic playlist switching.
- [ ] Implement SSE reconnect and HTTPS heartbeat.
- [ ] Implement offline playback and startup recovery.

## Phase 4 — Content management

- [ ] Create and manage media assets.
- [ ] Create playlists and schedules.
- [ ] Assign playlists to individual screens and screen groups.
- [ ] Preview content and validate schedules.
- [ ] Track content revisions and client sync status.

## Phase 5 — Reliability and operations

- [ ] Add structured server/client logs without secrets.
- [ ] Add device health and last-seen dashboard.
- [ ] Add backup and restore procedures.
- [ ] Test server restart, internet outage, Wi-Fi loss, corrupt downloads, and revoked credentials.
- [ ] Test cold boot, scheduled TV power, and app auto-start on actual hardware.
- [ ] Document installation, upgrades, recovery, and operator procedures.

## Phase 6 — Additional platforms and release

- [ ] Evaluate Samsung Tizen support.
- [ ] Verify supported platform lifecycle and kiosk limitations.
- [ ] Add automated tests and CI.
- [ ] Review security and EUPL compliance.
- [ ] Publish a first usable release and operator documentation.

## Delivery rule

A phase is not complete merely because the happy path works. Include failure recovery, permission checks, and tests appropriate to the phase before marking its tasks complete.
