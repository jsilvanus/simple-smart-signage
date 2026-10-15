# Decision register

This directory records architectural decisions for SiSSi. Keep entries short, explicit, and dated. Use `Proposed`, `Accepted`, `Superseded`, or `Rejected` as the status.

## Accepted

### D-001 — Project name

- **Status:** Accepted
- **Decision:** The project is named **SiSSi — Simple Smart Signage**.
- **Repository:** `simple-smart-signage`

### D-002 — Licence

- **Status:** Accepted
- **Decision:** Use the European Union Public Licence, version 1.2 (**EUPL-1.2**).
- **Implementation note:** Include the complete official licence text in `LICENSE` before the first public release; the current starter file points to the official text.

### D-003 — Device update transport

- **Status:** Accepted
- **Decision:** Use Server-Sent Events (SSE) over HTTPS for server-to-client live notifications, plus authenticated HTTPS heartbeats.
- **Rationale:** Updates are predominantly server-to-client; ordinary HTTPS requests are sufficient for device health reporting.

### D-004 — Pending-device approval

- **Status:** Accepted
- **Decision:** Clients can self-register, but registration does not confer trusted access. A neutral splash screen displays a verification number; an administrator compares it with the dashboard and explicitly approves the pending device.
- **Security boundary:** The visual number is for human matching only and must never act as an authentication credential.

### D-005 — Outbound-only client connectivity

- **Status:** Accepted
- **Decision:** Display clients initiate all network connections to the server. No inbound connection to a television or signage stick is required.

### D-006 — Offline playback

- **Status:** Accepted
- **Decision:** Approved clients retain cached content and continue playback during temporary network or server outages. New content is activated only after required assets are downloaded and verified.

### D-012 — Pluggable full-screen web display runtime

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** Use a small managed client shell with a pluggable display runtime. Full-screen web applications are the first-class display type, supporting both administrator-assigned hosted HTTPS URLs and versioned, locally cached web bundles. Native layouts and media remain complementary display types.
- **Rationale:** Web apps (including Vite builds) provide broad presentation possibilities and can be developed/deployed independently of the client shell.
- **Consequences:** The client must handle cache integrity, safe version activation/rollback, offline limitations, and a strict boundary between displayed app code and device-management credentials.
- **Camera note:** Browser-based webcam access and local person detection may be possible, but are not guaranteed. Camera access is an explicit capability and must be tested on each target platform and hardware combination. Arbitrary web apps receive no camera permission by default.
- **Reference:** [Display runtime](../display-runtime.md)

### D-013 — No identity recording or image-to-person-data linking

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** SiSSi must never identify or attempt to recognise people through its camera capabilities, record their identities, or link camera images, frames, or camera-derived observations to a person's identity or other personal data.
- **Prohibited:** Face recognition; face templates or embeddings used to recognise or track people; persistent person tracking; storing or transmitting camera images/video; and joining camera-derived data with names, accounts, device identifiers, attendance records, religious-affiliation data, or other personal records.
- **Permitted boundary:** If an approved use case needs camera input, processing must be transient and on-device. It may produce only the minimum non-identifying signal needed for the immediate function (for example, a temporary presence trigger to select a family-event slide). Do not retain raw frames or create person-level histories. Any aggregate output must be designed so it cannot reasonably be used to identify or single out a person.
- **Implementation requirement:** This is a product-level constraint, not a setting that an administrator or displayed web app may override. Camera access remains optional, off by default, separately authorised, and subject to applicable law and transparent notice.
- **Reference:** [Privacy and camera boundaries](../privacy-and-camera.md)

### D-014 — Playlist-first content and playback model

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** The playlist is SiSSi's primary programming unit and consists of ordered playlist items. Each playlist item references a reusable scene and carries playback-specific settings. Scenes can be delivered as hosted URLs or versioned bundles and may define an internal presentation timeline. Scene availability rules determine when a scene is eligible to appear; schedules/assignments determine when a playlist is active on a display.
- **Time separation:** Keep scene-internal timeline time, playlist-item playback duration, and calendar-based schedule/availability separate. A scene may suggest a default duration, but the playlist item owns the effective playback duration. A playlist-item override must not silently bypass scene availability restrictions.
- **Runtime behavior:** The runtime selects eligible items, prepares content before activation, and advances when the playback policy or availability boundary requires it. Failed preparation must not replace the last known-good display state. Exact timeline modes, API schemas, empty-playlist behavior, time-zone/DST handling, and no-eligible-scene fallback remain to be specified.
- **Rationale:** Separates reusable content from programming and playback context while supporting animations, time-limited scenes, multiple playlists, and offline bundle playback.
- **Reference:** [Content and playback model](../content-model.md) · [Display runtime](../display-runtime.md)

## Proposed / to decide

### D-007 — Server stack and deployment

- **Status:** Proposed
- **Proposal:** Next.js and TypeScript, PostgreSQL, and Docker Compose on a VPS.
- **To decide:** Object storage strategy, migrations, backups, and deployment environments.

### D-008 — Client platforms

- **Status:** Proposed
- **Proposal:** Start with Android TV; investigate a dedicated Tizen web client for Samsung televisions.
- **To decide:** First supported platform and minimum OS/firmware requirements. Verify kiosk/auto-start behaviour on actual hardware.

### D-009 — Enrollment expiry and polling

- **Status:** Proposed
- **Proposal:** Short-lived enrollment, a six-digit verification number, and polling while pending.
- **To decide:** Exact expiry, polling intervals, rate limits, and lockout rules.

### D-010 — Device credentials

- **Status:** Proposed
- **Proposal:** Unique revocable credential per device, exchanged only after approval.
- **To decide:** Token format, storage, rotation, expiry, and authentication for SSE on Android and Tizen.

### D-011 — API versioning

- **Status:** Proposed
- **Proposal:** Version endpoints under `/api/v1/`.
- **To decide:** Compatibility policy and minimum supported client protocol.

## Adding decisions

For a substantial architecture choice, add a file such as `D-014-short-title.md` with:

- Status and date
- Context
- Decision
- Consequences
- Alternatives considered

Keep this index updated when a decision is accepted or superseded.
