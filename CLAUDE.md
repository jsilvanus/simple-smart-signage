# CLAUDE.md — SiSSi (Simple Smart Signage)

Guidance for Claude Code sessions working in this repository.

## What this repository is

SiSSi is a centrally managed digital-signage system for televisions and other displays. **The repository is documentation only.** There is no application code, no `package.json`, no tests, and no CI yet. The planning documents are the source of truth. Do not describe any feature as implemented, and do not add a root manifest just to declare a future dependency (see D-028).

Licence: EUPL-1.2. The `LICENSE` file is a placeholder that points to the official text. The full text must be added before the first release.

## Document map

| Path | Role |
|---|---|
| `README.md` | Short project summary and links. |
| `docs/plan.md` | Implementation checklist, by phase. Pending rewrite (see below). |
| `docs/roadmap-by-release.md` | Scope boundaries: Prototype, MVP, 2.0, 3.0. |
| `docs/architecture/planes-and-concepts.md` | Twelve architectural planes (A to L) and the cross-plane boundary table. Read this first for any design work. |
| `docs/handshake.md` | Device enrolment, credentials, SSE and heartbeat. The most implementable document. |
| `docs/display-runtime.md` | Display types: hosted, packaged, native media, packaged web scene. |
| `docs/content-model.md` | Scene, layout, playlist, programme, assignment, override. |
| `docs/creation-system.md` | Authoring, Vite workspaces, publishing, MCP content creation. |
| `docs/design-systems.md`, `docs/asset-library.md` | Design systems and palettes; assets and provenance. |
| `docs/access-control.md` | Tenancy, identity, authorisation, MCP OAuth. |
| `docs/playback-resolution.md` | Deterministic resolver contract, precedence table, test vectors. Draft. |
| `docs/privacy-and-camera.md` | Binding privacy decision on cameras (cited as D-013). |
| `docs/decisions/` | Decision records D-022 to D-052 (and their index in `README.md`). |

Architecture review: a published review (private artifact, Oct 2026) assessed these documents and proposed a release-by-release roadmap. Refer to it for context. It is not a file in the repository.

## Terminology

Use these terms exactly. They are defined in `planes-and-concepts.md`.

- **Scene** is the reusable content unit. **Layout** groups scenes spatially. The two are not interchangeable.
- **Playlist** is an ordered sequence of playlist items. **Programme** is a conditional sequence of playlists. **Assignment** is what a screen or group is playing, and **schedule** says when.
- **Override** has two styles: **WITH** (adds a region) and **REPLACE** (takes over the display). A "special broadcast" is a workflow that creates an override, not a separate model.
- **Desired state**, **downloaded**, **prepared**, **active** and **observed** are distinct. A server "accepted" response is not proof that a client activated anything.
- The release lifecycle is **Compose → Review → Publish**; distribution is **Assign → Push → Cache**; playback is **Prepare → Ready → Activate → Start → End → Next** (D-052).
- Publishing never assigns content, and assigning never activates it.

## Decision register conventions

- Records are `docs/decisions/D-NNN-slug.md`, with a `Status` and `Date` header and a `## Decision` section.
- Next free number: **D-053**. Do not reuse a number. Check `docs/decisions/` before choosing one.
- Known problems that are not yet fixed:
  - Two files are numbered **D-028** (`conditional-playlist-activation` and `screen-groups-as-publishing-targets`). Rename one when fixing the register; do not add a third.
  - **D-013** (privacy, binding) and **D-014** to **D-021** are cited in the documents but have no records. Do not cite a number as authority unless its record exists. Restore the record or remove the citation.
  - `docs/decisions/README.md` indexes only 15 of the 32 files. Keep the index complete when adding a record.
  - "Accepted" is used for decisions whose specification is still open. When adding one, state separately what is decided and what is still open.
- Do not put a model name or identifier in decisions or other repository artifacts.

## Release scope and tagging

- Scope levels, from the roadmap: **Prototype → MVP (1.0) → 1.1 … 1.5 → 2.0 → 3.0**. The 1.x split is a proposal from the architecture review and has not been adopted in `roadmap-by-release.md`. Until it is, say which numbering you are using.
- Every plan item must carry a release tag. Currently most items are untagged; do not schedule an untagged item.
- MVP excludes: complex (code-driven) scenes, Android TV, Tizen, screen groups, schedules, programmes, concurrent playlists, overrides, free-form layouts, condition evaluation, design systems, templates, AI provenance and C2PA.
- Quality gates are part of the MVP: automated tests, CI, a security review, the full EUPL text, and the first release.

## Known inconsistencies (do not repeat them)

When writing new documents, follow the resolved position where one exists, and flag any open conflict instead of guessing.

1. **PDF in the MVP.** `roadmap-by-release.md`, `plan.md` and D-035 say yes; D-037 and `creation-system.md` say no. Open until decided.
2. **CI, security review, EUPL text, first release.** MVP in the roadmap, post-MVP in `plan.md` Phase 6. Treat as MVP.
3. **Complex scenes** are "immediately after the MVP" in D-035 and `creation-system.md`, and 2.0 in the roadmap.
4. **Client platform.** The README says "Android TV first"; `plan.md` says web client first. Treat the web client as first.
5. **Screen groups and schedules** are not MVP. Groups and schedules appear in `plan.md` Phase 4 but belong to 2.0 (groups) and 3.0 (the full schedule model).
6. **Server framework.** The README and plan say Next.js. The MVP is API-first and CLI-first (D-050), so the review recommends a plain ESM Node.js API with OpenAPI, adding Next.js for browser surfaces in 1.2. This is not yet decided.
7. **Private assets in sandboxed scenes.** D-044 forbids cookies in the opaque-origin iframe, and `creation-system.md` requires revocable or signed access. The mechanism is unspecified.

Open Gate 0 decisions (from the review): PDF in MVP; pilot client platform and hardware; server framework; MVP sign-in method; MCP authentication scope; storage backend; groups and schedules in MVP; private-asset access in scenes; decision register repair.

## Writing and editing rules

- Keep every document's status honest: say "proposed", "draft", "accepted direction" or "accepted", and say what is still to specify.
- When a document cites another, check that the target exists. Links to missing decisions and broken anchors are currently present; do not add more.
- `plan.md` has known formatting faults: lines 80 and 81 merge several checklist items, and line 117 contains a literal `\n`. Fix them when editing that file.
- Preserve the privacy rule. No camera frames stored or transmitted; no face recognition or persistent person tracking; no audio analysis or microphone access. The rule is product-level and cannot be relaxed by configuration. Any proposal to change it needs a revised accepted decision first.
- Do not add a server, API, or dependency to the repository unless the task asks for it and the framework decision has been made.

## Code conventions (for when code arrives)

- The user works primarily in **Node.js** and prefers **ESM** wherever possible: `"type": "module"`, `import`/`export`, and no CommonJS in new packages.
- Planned layout (D-042): an npm-workspaces monorepo, with `@sissi/scene-sdk` as a dedicated workspace package and semantic versioning for the SDK plus a separate `sceneApi` version.
- The HTTP API is defined by OpenAPI, and the CLI and MCP use that API. They must not implement domain logic or bypass server-side authorisation (D-050).
- Every operation is authorised server-side against the tenant and target resource. Deny by default. Never trust a tenant code, UUID, or URL as access.
- Device credentials are unique and revocable. Enrolment verification numbers are not credentials. Store secrets hashed where feasible; never log them.
- Scene code runs only in a sandboxed iframe without `allow-same-origin`, and never receives device or server secrets.
- Clients initiate all connections over HTTPS. No inbound connection to a display is required.
- Untrusted input (uploads, AI or MCP output, scene code) is validated before use. Do not trust filenames or MIME types from the browser.
- Do not treat a successful build or a persistent preview as proof of safety. Publish from a controlled snapshot.
- Phase 3 and later work must not start before its contract is written. For new features, write or extend the OpenAPI definition alongside the capability.

## Church context

The organisation using this software is the Evangelic-Lutheran Church of Finland. For church-related work (content, templates, palettes, seasonal or liturgical features), use the Lutheran confessions, the church's own liturgical handbook and calendar, and the parish's own colour conventions, and do not assume them from general knowledge.

Data protection matters here. Religious belief is special-category data under GDPR. Do not design content or provenance features that store personal data (names of members, attendance, prayer requests, registrations) without a documented purpose and retention rule. The `church-data-protection-advisor` skill is available for these questions.

## Git and attribution

- Work on the designated feature branch (currently `claude/signage-architecture-review-jb5imy`). Never push to `main`.
- Commit and push only when asked. Do not open pull requests unless asked.
- Commit messages and PR bodies end with the attribution lines given in the session instructions. Do not add model identifiers to repository content.
