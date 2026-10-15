# D-039 — Background preparation and hybrid playlist activation

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** The display runtime may prepare the next playlist item in the background while the current scene continues playing. Preparation may fetch and validate the scene bundle, ensure required managed assets are cached and verified, and resolve values that must be available before rendering. Background preparation must not interrupt or mutate the current scene. A prepared scene is not active merely because it is ready.
- **Activation policy:** Use a hybrid policy. Where playlist/schedule rules require activation at a defined time, honour that timing and use the configured fallback if the next item is not ready. Where timing is not mandatory, wait for readiness, subject to a configurable maximum wait; if readiness is not achieved in time, use the configured fallback.
- **Failure safety:** Never activate an incomplete or invalid scene. Preparation or activation failure must preserve the current/last-known-good display where possible and must not replace it with a broken scene. Background preparation is opportunistic and may be constrained by device resources, connectivity, and cache capacity.
- **Rationale:** Reduces visible gaps during ordinary playback while retaining predictable timing for scheduled or time-critical content and safe behavior when dependencies are unavailable.
- **Reference:** [Content and playback model](../content-model.md) · [Display runtime](../display-runtime.md)

## Implementation notes

- Keep readiness and activation as separate states: a prepared item may wait for its permitted activation time.
- Define which playlist/schedule modes require timing to take priority, how maximum wait is configured, and the fallback choices in the runtime contract.
- Define behavior for the first item, no current scene, offline playback, expired eligibility windows, and fallback failure as part of the runtime specification.
