# Display runtime

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15

## Decision

SiSSi's client is a small, managed shell around a pluggable display runtime. A full-screen web application is the first-class display type. The shell owns device identity, enrollment, configuration sync, connectivity, caching, recovery, and platform integration; displayed content does not receive access to device-management secrets.

The display target assigned to a device may be one of:

1. **Hosted web app** — load an assigned HTTPS URL, such as an application built with Vite.
2. **Packaged web app** — download a versioned static web bundle, verify it, cache it locally, and display its entry page.
3. **Native media scene** — display one managed image, video, or PDF with type-specific playback settings using the built-in runtime.
4. **Packaged web scene** — run a published web scene bundle for custom compositions, overlays, layouts, and interactions.

The initial delivery should start with the narrow native media scene types, followed by the full-screen web runtime for custom compositions. Keep native media rendering separate from general web-scene composition; templates create ordinary AI-editable web scenes when creators need overlays or richer layouts. Both use the same scene, publication, playlist, and playback model.

## Hosted and packaged web apps

### Hosted mode

The client opens an administrator-assigned HTTPS URL without browser chrome. Refreshing or reloading the app can make new hosted content available. Availability and functionality depend on the network and the remote app's own dependencies.

### Packaged mode

The server distributes a versioned bundle of static web assets. The client downloads all required files, verifies integrity, and only then atomically activates the new version. The last known-good version remains available during failed downloads and temporary outages.

A packaged app is more suitable for offline playback, but it is not automatically fully offline: APIs, remote fonts, images, authentication, and other external dependencies may still require connectivity. Apps should declare their required capabilities and offline expectations.

## Content and playback model

SiSSi's programming unit is the **playlist**. A playlist is an ordered sequence of playlist items; each item references a reusable scene and supplies playback-specific settings. The content model is specified in [Content and playback model](content-model.md).

- **Scene:** reusable presentation content delivered as a hosted URL or versioned bundle. A scene may contain its own timeline for animations, timed element changes, or media playback.
- **Scene revision:** an immutable version of scene content and its presentation definition.
- **Scene-owned time guards:** conditions within a scene that govern when the scene or individual elements are shown, hidden, replaced, or advanced. A scene-level guard can restrict eligibility; an element-level guard only affects that element.
- **Playlist item:** a reference to a scene plus playback policy, such as allocated duration, transition, and end behavior. The same scene may be used more than once with different settings.
- **Playlist:** ordered playlist items and the playlist's repeat/advance policy.
- **Schedule / assignment:** determines which playlist is active on which display or display group and during what periods.

Keep separate time responsibilities: the scene owns its internal timeline and time guards; the playlist item owns the playback slot for that occurrence; the schedule/assignment owns when the playlist is active. Time guards can affect individual elements or the scene's eligibility. A playlist-item override must not silently bypass scene-level guards.

The runtime should select the next eligible item, prepare its content, and activate it only when required assets are ready. If a scene-level guard becomes false while it is playing, stop presenting that scene and advance to eligible content. Element-level guards affect only their governed elements. Define explicit behavior for empty playlists, no eligible items, overnight windows, time-zone and daylight-saving transitions, and clock uncertainty before implementation.

A scene timeline can loop, play once and hold, remain static, or signal completion. These are candidate behaviors whose exact contract must be defined; they are not yet API enums. The outer playlist controller owns playback slots, while the scene runtime owns the internal presentation timeline. The lifecycle contract must define readiness, start, stop, and completion signaling for both hosted and packaged scenes.

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

## Future camera inference (not MVP)

Camera-based scene classification for context-aware signage is a possible later research item, not an MVP capability. Prefer inference entirely on the display device. First establish feasibility on actual Android TV and Samsung Tizen hardware; do not assume camera or model-runtime support from platform name alone.

A separate inference service may be studied only as a later fallback. It must discard each frame after processing and must not store frames. Sending frames to another service is currently prohibited by the binding privacy decision in [Privacy and camera boundaries](privacy-and-camera.md); it must not be implemented unless that decision is explicitly reviewed and amended first. This roadmap note grants no camera permission and does not change the current prohibition.

## Platform notes

- **Android TV:** a native Android shell with a full-screen WebView is a likely implementation. Camera support depends on the device, USB host/driver support, WebView capabilities, and native permission handling.
- **Samsung Tizen:** implement a Tizen-specific web client and validate camera APIs and connected-camera support on the actual TV and firmware. Android WebView behaviour cannot be assumed.
- **Browser/kiosk:** useful for compatible hardware, but boot recovery, permissions, and kiosk restrictions vary.

## Consequences

- Signage content can be developed independently as a Vite or other static web application.
- New display applications can be deployed without rebuilding the client shell, within supported runtime and security constraints.
- The client needs versioned caching, safe activation/rollback, origin/capability policy, and platform-specific testing.
- External websites may be incompatible or unsuitable for offline operation; hosted and packaged apps should be distinguished in the administration UI.
