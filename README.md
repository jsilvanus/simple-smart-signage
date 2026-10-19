# SiSSi — Simple Smart Signage

SiSSi is a centrally managed digital-signage system for televisions and other displays.

- **Server:** ESM Node.js / TypeScript with Express and an OpenAPI contract; PostgreSQL planned (D-054).
- **Clients:** a full-screen web SPA on a kiosk PC for the MVP; Android TV and Samsung Tizen later (D-053).
- **Display:** Full-screen web apps (including Vite builds), with hosted-URL and packaged/offline modes planned.
- **Connectivity:** Outbound HTTPS, Server-Sent Events (SSE), and HTTPS heartbeats.
- **Enrollment:** Devices self-register but require administrator approval before receiving trusted access.
- **Reliability:** Local content cache, offline playback, and automatic reconnection.

## Project docs

- [Plan index](docs/plan.md)
- [Architecture planes and concepts](docs/architecture/planes-and-concepts.md)
- [Device handshake and enrollment](docs/handshake.md)
- [Display runtime and camera capabilities](docs/display-runtime.md)
- [Decision register](docs/decisions/README.md)

## Licence

Licensed under the European Union Public Licence 1.2 (EUPL-1.2). See [LICENSE](LICENSE).
