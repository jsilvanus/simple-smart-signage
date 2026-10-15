# Display runtime

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15

## Decision

SiSSi's client is a small, managed shell around a pluggable display runtime. A full-screen web application is the first-class display type. The shell owns device identity, enrollment, configuration sync, connectivity, caching, recovery, and platform integration; displayed content does not receive access to device-management secrets.

The display target assigned to a device may be one of:

1. **Hosted web app** — load an assigned HTTPS URL, such as an application built with Vite.
2. **Packaged web app** — download a versioned static web bundle, verify it, cache it locally, and display its entry page.
3. **Native SiSSi layout** — render structured layouts and standard widgets using a built-in renderer.
4. **Media** — display images and video using a managed player.

The initial implementation should prioritise the full-screen web runtime. Native layouts and media can be added as complementary display types without changing the device-management architecture.

## Hosted and packaged web apps

### Hosted mode

The client opens an administrator-assigned HTTPS URL without browser chrome. Refreshing or reloading the app can make new hosted content available. Availability and functionality depend on the network and the remote app's own dependencies.

### Packaged mode

The server distributes a versioned bundle of static web assets. The client downloads all required files, verifies integrity, and only then atomically activates the new version. The last known-good version remains available during failed downloads and temporary outages.

A packaged app is more suitable for offline playback, but it is not automatically fully offline: APIs, remote fonts, images, authentication, and other external dependencies may still require connectivity. Apps should declare their required capabilities and offline expectations.

## Webcam and browser capabilities

Web content can use browser APIs such as `navigator.mediaDevices.getUserMedia()` when all required platform conditions are met. This can enable a web app to access a webcam and run local computer-vision models, including person detection.

This is a **capability to validate per platform**, not a guarantee that every SiSSi device can use every attached camera. The device OS must recognise the camera; the browser/WebView must expose it; the host app must implement required permissions; and the app origin and user-consent rules must allow access. Secure-context requirements (normally HTTPS for hosted content) also apply.

Before claiming webcam support on a platform, test the actual hardware, browser engine, camera permission flow, performance, and lifecycle behaviour. USB webcam support on Android TV and camera access from a Samsung Tizen signage app must be verified on target devices.

## Security and privacy boundaries

- Do not grant camera access to arbitrary URLs by default.
- Camera use must be an explicit, administrator-controlled capability for an approved app/origin, with platform permission and visible notice as appropriate.
- A displayed app must not receive device-enrollment secrets or privileged management tokens.
- Prefer on-device processing when practical. Sending camera frames to a server is a separate, higher-risk capability requiring explicit design, access controls, retention rules, and privacy review.
- Person detection should return only the minimum data required for the use case. Avoid retaining or transmitting images by default.
- **Binding privacy constraint:** SiSSi must never identify or attempt to recognise people through cameras, record identities, or link camera images, frames, or camera-derived observations to identity or other personal data. Do not use face recognition, identity-oriented face templates/embeddings, persistent person tracking, stored/transmitted camera footage, or joins to names, accounts, device identifiers, attendance, religious-affiliation data, or other personal records.
- If camera input is approved for a use case, process it transiently on-device and discard frames immediately after processing. The output may only be a minimal non-identifying signal needed for the immediate function, such as a temporary presence trigger. Do not create person-level histories; aggregate outputs must not reasonably enable identification or singling out.
- This constraint is a product-level rule, not a configurable permission. An administrator or displayed web app cannot override it.
- Treat packaged web bundles as executable code: only authorised administrators may publish/assign them; validate bundle integrity and use a controlled update process.

See [Privacy and camera boundaries](privacy-and-camera.md) for the binding privacy decision.

## Platform notes

- **Android TV:** a native Android shell with a full-screen WebView is a likely implementation. Camera support depends on the device, USB host/driver support, WebView capabilities, and native permission handling.
- **Samsung Tizen:** implement a Tizen-specific web client and validate camera APIs and connected-camera support on the actual TV and firmware. Android WebView behaviour cannot be assumed.
- **Browser/kiosk:** useful for compatible hardware, but boot recovery, permissions, and kiosk restrictions vary.

## Consequences

- Signage content can be developed independently as a Vite or other static web application.
- New display applications can be deployed without rebuilding the client shell, within supported runtime and security constraints.
- The client needs versioned caching, safe activation/rollback, origin/capability policy, and platform-specific testing.
- External websites may be incompatible or unsuitable for offline operation; hosted and packaged apps should be distinguished in the administration UI.
