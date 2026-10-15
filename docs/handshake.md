# Device handshake and enrollment

**Status:** Proposed protocol for version 1  
**Scope:** Communication between the SiSSi server and display clients.  
**Transport:** HTTPS for all API requests; SSE over HTTPS for server-to-client updates.

## Goals

1. A newly installed client can register itself without being trusted.
2. The display shows a verification number that an administrator can compare with the dashboard.
3. Only explicit administrator approval makes a device eligible for authenticated access.
4. Every approved device has its own revocable credential.
5. Clients continue showing cached content during temporary network or server outages.
6. Devices initiate all network connections; the server does not need inbound access to a display.

## Lifecycle

1. **Boot:** The client loads its persisted device/enrollment state.
2. **Enroll:** If it has no approved identity, it submits a registration request over HTTPS.
3. **Pending screen:** The server returns an enrollment ID, a short-lived verification number, expiry, and a high-entropy enrollment secret/token. The client displays the number on a neutral SiSSi splash screen.
4. **Administrator review:** The dashboard lists pending enrollments. The administrator compares the number on the physical screen with the dashboard and may name, assign, approve, or reject the device.
5. **Credential exchange:** An approved client proves possession of its enrollment secret and exchanges it for a unique device credential. The server must not issue credentials before approval.
6. **Authenticated handshake:** The client authenticates and obtains its assigned configuration, content revision, protocol requirements, and heartbeat interval.
7. **Synchronisation:** The client downloads required assets, verifies integrity, and only then switches to the new playlist.
8. **Online operation:** The client opens SSE, sends HTTPS heartbeats, and reconciles configuration periodically.
9. **Recovery:** On network failure, it retains cached content and retries with exponential backoff plus jitter.

## Proposed endpoints

These paths are a starting proposal, not yet a frozen API contract.

- `POST /api/v1/enrollments` — create a pending enrollment.
- `GET /api/v1/enrollments/{id}` — check enrollment status using the enrollment secret.
- `POST /api/v1/enrollments/{id}/exchange` — exchange an approved enrollment for device credentials.
- `POST /api/v1/devices/handshake` — authenticate and obtain runtime configuration.
- `GET /api/v1/devices/events` — authenticated SSE stream.
- `POST /api/v1/devices/heartbeat` — report health and current state.
- `GET /api/v1/devices/config` — retrieve current assigned configuration.
- Content endpoints — download authorised assets and verify their hashes.

All endpoint names are provisional until recorded as an accepted decision and implemented in an API specification.

## Enrollment request

Example metadata; do not include secrets in the JSON body unless the final API explicitly requires it.

```json
{
  "protocol_version": 1,
  "app_version": "0.1.0",
  "platform": "android_tv",
  "capabilities": {
    "sse": true,
    "local_cache": true
  }
}
```

The server should create a cryptographically random enrollment identifier and verification number. The enrollment secret must have sufficient entropy, be transmitted only over HTTPS, and be stored server-side as a hash where feasible.

The verification number is for human visual matching only. It is not a password, bearer credential, or proof of device identity. It must expire, be rate-limited, and never grant access to private content.

## Approval and rejection

Pending devices may access only the minimal enrollment endpoints required to show status. They must not read playlists, private configuration, or content assets.

Approval must apply to the specific pending enrollment. The dashboard should record who approved or rejected it and when. Rejected or expired enrollments must not be exchangeable for device credentials.

During approval, an administrator should be able to assign a human-readable name and screen/group. Reassignment and credential revocation must be supported after enrollment.

## Authenticated handshake response

The authenticated handshake should return, at minimum:

- protocol version and compatibility requirements;
- device status;
- server time;
- heartbeat interval;
- configuration revision;
- content revision and whether synchronisation is required;
- assigned screen/group and relevant configuration;
- an authenticated SSE endpoint or connection instructions.

Example response:

```json
{
  "protocol_version": 1,
  "device_status": "active",
  "server_time": "2026-01-01T12:00:00Z",
  "heartbeat_interval_seconds": 60,
  "config_revision": 1,
  "content_revision": 1,
  "sync_required": true,
  "sse_path": "/api/v1/devices/events"
}
```

This is illustrative only. The final contract must define error responses, field validation, credential transport, and version negotiation.

## SSE and heartbeat

SSE is used for server-to-client notifications such as configuration changes, content revision changes, maintenance notices, and revocation signals. The client initiates the connection using HTTPS and authenticates it with its device credential.

Heartbeats use ordinary authenticated HTTPS requests, initially every 60 seconds. They may report app version, current state, last successful sync, current content revision, and relevant errors. Avoid sending unnecessary personal or sensitive data.

The client must reconnect SSE with backoff, use event IDs where supported, and periodically reconcile the complete configuration so missed events do not leave it stale. Heartbeats and SSE serve different purposes: heartbeats report health; SSE delivers timely updates.

## Client state model

- `UNPROVISIONED` — no active enrollment.
- `PENDING_APPROVAL` — enrollment exists; only onboarding/status access is permitted.
- `APPROVED` — administrator approved the enrollment; credential exchange is permitted.
- `SYNCING` — authenticated and downloading/verifying required content.
- `ONLINE` — operating normally.
- `OFFLINE` — server unreachable; cached content remains available.
- `DISABLED` — server has revoked or disabled the device.

Transitions must be explicit. A transient network error must not erase enrollment state or cached content. A revoked device must not be able to regain access merely by retrying.

## Security requirements

- Require HTTPS; never send credentials over cleartext HTTP.
- Use unique, revocable credentials per device; no shared fleet-wide secret.
- Keep enrollment secrets separate from the visual verification number.
- Rate-limit enrollment, status checks, and failed credential exchanges.
- Apply server-side authorisation to every device, screen, playlist, and asset.
- Do not treat a device ID or app/platform metadata as authentication.
- Define credential rotation and revocation behaviour.
- Validate and constrain content rendered in a browser/WebView.
- Do not activate a new playlist until required assets are downloaded and verified.
- Keep secrets out of logs and error messages.

## Open questions

See the [decision register](decisions/README.md). Important unresolved items include credential format and rotation, enrollment expiry, precise endpoint schemas, SSE authentication details across client platforms, and Tizen lifecycle limitations.
