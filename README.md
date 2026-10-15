# SiSSi — Simple Smart Signage

SiSSi is a centrally managed digital-signage system for televisions and other displays.

- **Server:** Next.js / TypeScript, with PostgreSQL planned.
- **Clients:** Android TV first; Samsung Tizen is a possible additional target.
- **Display:** Full-screen web apps (including Vite builds), with hosted-URL and packaged/offline modes planned.
- **Connectivity:** Outbound HTTPS, Server-Sent Events (SSE), and HTTPS heartbeats.
- **Enrollment:** Devices self-register but require administrator approval before receiving trusted access.
- **Reliability:** Local content cache, offline playback, and automatic reconnection.

## Project docs

- [Plan index](docs/plan.md)
- [Device handshake and enrollment](docs/handshake.md)
- [Display runtime and camera capabilities](docs/display-runtime.md)
- [Decision register](docs/decisions/README.md)

## Licence

Licensed under the European Union Public Licence 1.2 (EUPL-1.2). See [LICENSE](LICENSE).
