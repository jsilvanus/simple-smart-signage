# D-053 — MVP scope and client platform

- **Status:** Accepted
- **Date:** 2026-10-19
- **Specification:** Partial. Scope boundaries are decided. Schedule detail and kiosk configuration are open (see below).
- **Amends:** D-035 (PDF removed from the MVP), D-037 (confirms no PDF in the MVP).

## Decision

1. **No PDF in the MVP.** The MVP native media scenes are image and MP4 video only. PDF handling is deferred to a later release. The asset model keeps the PDF type so that it can be added without a migration.
2. **The MVP client is a kiosk PC running the web SPA.** The client is a full-screen single-page application (Vite build) on a PC configured as a kiosk. Android TV and Samsung Tizen remain later native shells (Android TV in 1.5, Tizen in 2.0).
3. **Screen groups are out of the MVP.** Groups are first-class in 2.0 (D-059). The MVP assigns playlists to individual screens.
4. **Per-screen 24-hour schedules are in the MVP.** The MVP includes the single-screen schedule model from D-031: a weekday pattern, calendar-date overrides, copy-to-date, and off-time gaps. Screen-group schedules are 2.0.
5. **Everything else in the MVP definition in `roadmap-by-release.md` stands**, including CI, the security review, the EUPL text and the first release.

## Open

- Whether copy-to-date and off-time gaps are required in the first MVP build or the first point release after it.
- The kiosk OS, browser and full-screen configuration. These are pinned by the test matrix before the MVP starts (plan Phase 3).
- Whether the kiosk needs an auto-start and power-recovery shell in the MVP. The current assumption is that the kiosk OS handles auto-start and no native shell is needed.

## Consequences

- The MVP needs no PDF renderer and no PDF derivative pipeline.
- The MVP client has one browser target to test, not two platforms.
- Android TV work moves to 1.5. If the pilot needs a native shell earlier, it is re-decided here.

## References

- [Roadmap by release](../roadmap-by-release.md)
- [D-035 Preview lifecycle and staged scene MVP](D-035-preview-lifecycle-and-staged-scene-mvp.md)
- [D-037 Minimal native media scenes](D-037-minimal-native-media-scenes-and-ai-authored-templates.md)
- [D-031 Playlist composition](D-031-playlist-composition.md)
- [D-059 Screen groups as publishing targets](D-059-screen-groups-as-publishing-targets.md)
