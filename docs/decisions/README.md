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

For a substantial architecture choice, add a file such as `D-012-short-title.md` with:

- Status and date
- Context
- Decision
- Consequences
- Alternatives considered

Keep this index updated when a decision is accepted or superseded.
