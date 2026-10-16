# D-052 — Content creation, distribution, and playback lifecycles

- **Status:** Accepted architectural direction; detailed state transitions and protocol contracts remain specified by related decisions and implementation work
- **Date:** 2026-10-16

## Context

SiSSi needs concise, distinct lifecycle summaries for authored content, distribution to screens, and runtime playback. These workflows have different responsibilities and must not be conflated with one another or with the managed-object lifecycle.

## Decision

Model the end-to-end process as three related lifecycles.

### 1. Content creation — content creator actions

**Compose → Review → Publish**

- **Compose:** Create or edit reusable content, including AI-assisted authoring and live preview.
- **Review:** Review a particular revision and take editorial responsibility for the work. Review includes relevant content quality, AI-generated material, provenance, rights, suitability, and target-screen presentation. Approval is tied to the revision reviewed; material changes may require renewed review.
- **Publish:** As one logical workflow, perform applicable validation and build work, then publish an immutable revision with exact dependencies pinned. Preparation/build steps may be separate internal jobs, but are not additional top-level lifecycle stages.

Publishing does not itself assign content to a screen or imply that any client has received or activated it.

### 2. Distribution — publisher action followed by system/client delivery

**Assign → Push → Cache**

- **Assign:** The publisher selects where published content should be used, typically through a playlist assigned to a screen or screen group.
- **Push:** The server communicates and reconciles the desired state with target clients. A successful push/request does not prove that every client has synchronized.
- **Cache:** Clients download and verify the required scene bundle and managed-asset dependencies, reusing verified cached versions where possible. A cached item is not necessarily prepared or ready for playback.

The publisher owns the assignment decision; push and cache are carried out by the system and clients.

### 3. Playback — system-driven runtime actions

**Prepare → Ready → Activate → Start → (Play) → End/Finish → Next**

- **Prepare:** Prepare the selected or upcoming item, including resolving and verifying required dependencies and initializing what is needed for presentation. The next item may be prepared in the background while the current item continues playing.
- **Ready:** The client signals that preparation is complete and the item can safely proceed.
- **Activate:** The host/runtime selects or authorizes the item for activation under applicable playlist, schedule, and timing rules. Readiness alone does not activate an item.
- **Start:** The host initiates playback. This may coordinate with a scene timeline or other configured synchronization.
- **(Play):** The content is consumed by the display. Parentheses indicate this may be an implicit runtime phase rather than a separate command.
- **End/Finish:** The current item completes or terminates according to its playback contract. Normal completion is distinct from runtime failure or operator interruption.
- **Next:** Advance to the next eligible item, preferably already cached and prepared.

Screen administrators configure the screens and playback rules; routine lifecycle execution is system-driven. The existing detailed playback/runtime contracts remain authoritative for exact event semantics and behavior.

## Boundaries

- Content creation, distribution, and playback are distinct workflows, not one shared state machine.
- Review is editorial accountability, not merely technical validation.
- Publish, assign, push, client synchronization, cache, ready, activate, and start represent distinct outcomes or operations.
- A client must not activate incomplete or invalid content. On preparation or activation failure, preserve current/last-known-good playback where possible and apply the configured fallback policy.
- Desired state and reported client state remain distinct.
- The managed-object lifecycle (Create, Version control, Archive, Garbage collection) is separate from these content workflows.

## Related decisions and documentation

- [D-026 — Scene resource index and MCP publishing/deployment tools](D-026-mcp-publishing-and-resource-index.md)
- [D-036 — Separate scene bundles from managed assets](D-036-separate-scene-bundles-from-managed-assets.md)
- [D-039 — Background preparation and hybrid playlist activation](D-039-background-preparation-and-hybrid-activation.md)
- [D-041 — Cache-first publication and scene readiness](D-041-scene-readiness-and-start-lifecycle.md)
- [D-051 — Managed object lifecycle and version history](D-051-managed-object-lifecycle-and-version-history.md)
- [Content and playback model](../content-model.md)
- [Content creation and authoring system](../creation-system.md)
- [Display runtime](../display-runtime.md)
- [Architecture planes and concepts](../architecture/planes-and-concepts.md)
