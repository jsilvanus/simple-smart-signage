# Playback resolution contract

- **Status:** Draft contract for review
- **Related decision:** [D-048 — Deterministic playback resolution](decisions/D-048-deterministic-playback-resolution.md)

This document records the chosen direction: hierarchical resolution is the foundation, with explicit priorities where candidates compete at the same level and conditions determining eligibility. It defines a reviewable precedence table and initial test vectors; unresolved policy details remain open rather than being guessed in implementation.

## 1. Invariants

1. One versioned resolver is used for server preview, operator diagnostics, and desired-state generation.
2. The resolver computes desired state, not actual device state. The runtime reports what it prepared, activated, or failed to render.
3. Evaluation time, time zone, condition results and freshness, configuration revisions, device capabilities, and persisted playback state are explicit inputs. The resolver must not read the wall clock or make network requests implicitly.
4. Eligibility is evaluated before selection. Priority cannot make an ineligible candidate eligible.
5. Ordered queues and sequences preserve configured order. Same-level priority ties use an explicit stable tie-break; database or iteration order is never a tie-break.
6. Decisions and exclusions have machine-readable reason codes and useful diagnostics.
7. Unknown, stale, invalid, or failed inputs follow declared policies; they are never silently assumed true.
8. Readiness and cache state do not silently override mandatory schedule timing. Runtime preparation/fallback follows D-039–D-041.

## 2. Precedence table

| Order | Stage | Rule | If no valid candidate |
|---:|---|---|---|
| 1 | Evaluation context | Use the explicit evaluation instant, IANA time zone, condition snapshot/freshness, config revisions, capabilities, and persisted playback state. | Return a typed error or apply the declared unknown/error policy. |
| 2 | Effective schedule | For the local calendar date, a date-specific schedule wins over the weekday schedule. The selected schedule is exclusive. Windows are half-open: start inclusive, end exclusive. | Uncovered time is off time; do not fall through to another schedule. |
| 3 | Screen/group assignment queue | Evaluate candidate eligibility, then select the first eligible candidate in explicit queue order. | Resolve the configured off-time/empty state; do not invent a programme. |
| 4 | Programme sequence | Evaluate each playlist-entry's eligibility and finite-run state; select using the programme's explicit order and persisted progression state. | Apply configured no-eligible-entry/end behavior. |
| 5 | Playlist sequence | Evaluate playlist entries and their time/condition guards; follow configured order, repeat, and end behavior. | Apply configured end behavior or resolve no base content. |
| 6 | Base composition | Resolve the selected scene/layout revision, regions, ordering, and declared runtime capabilities. Resolve published references according to their explicit revision/update policy. | Use an explicitly configured compatible fallback or report incompatibility. |
| 7 | Overrides | Evaluate target and activation eligibility. Resolve same-level conflicts using explicit priority and stable tie-break. WITH adds content while base playback continues; REPLACE takes over temporarily and preserves base state for resumption. | Keep the base state unchanged. An unresolved conflict is an explicit error, not a guess. |
| 8 | Capability/fallback validation | Validate the full composition against declared device and runtime capabilities. Use only configured fallbacks. | Return a typed incompatibility result if no valid fallback exists. |
| 9 | Desired-state output | Emit desired state, resolver version, relevant input/config revisions, evaluation timestamp, selections, exclusions, and reason codes. | Emit a typed resolution failure with diagnostics, not a successful-looking empty state. |

### Clarifications

- The assignment queue selects the programme/playback target; it is distinct from the programme's ordered playlist sequence.
- Programme-entry eligibility and playlist-entry eligibility are separate checks.
- An override composes with or temporarily replaces base state; it does not silently rewrite base progression.
- Conditions are evaluated outside the resolver and passed in as explicit results. Freshness and unknown/error behavior must be declared.
- Resolution is a calculation over a snapshot: it does not advance playback, mutate finite-run counters, publish content, or activate scenes.
- If readiness or device reports affect a policy, the relevant report and timestamp must be explicit inputs. Runtime readiness handling otherwise remains under D-039–D-041.

## 3. Proposed deterministic rules

These rules are the baseline for review; items listed in section 6 are not yet settled.

- **Ordered queues/sequences:** preserve configured order. Do not sort by name, creation time, or database ID unless explicitly specified.
- **Same-level priority:** compare explicit priority, then explicit configured order, then stable unique ID. If the contract requires priority and it is missing, report invalid configuration.
- **Time:** use the supplied instant and effective IANA time zone; intervals are `[start, end)`. Date-specific schedule wins over weekday schedule. DST gap/repeated-time policy still needs a decision.
- **Unknown/stale conditions:** apply the declared policy and include it, its timestamp, and the reason in diagnostics. Unknown must not silently mean eligible.
- **Finite runs:** read persisted state from the input snapshot; do not mutate it during resolution. Counting and reset semantics remain open.
- **Overrides:** check eligibility before priority. WITH and REPLACE have distinct composition semantics. Audio-source conflicts need explicit rules rather than inferred visual priority.
- **Fallbacks:** select only configured, compatible fallbacks. Prevent fallback cycles. Actual preparation and readiness deadlines are handled under D-039–D-041.

## 4. Output and diagnostics

The versioned, serializable output should include these logical fields; exact schema names remain open:

- `resolverVersion`
- `evaluationContext`: evaluation instant, effective time zone, condition timestamps, config revisions, and playback-state revision
- `status`: such as resolved, off-time, no-eligible-candidate, incompatible, or error (final enum to be specified)
- `desiredState`: base target, pinned content revisions, composition/regions, applicable overrides, and configured fallback
- `selections`: selected candidate and rule at each stage
- `exclusions`: rejected candidates with stable reason codes and relevant values
- `warnings` and `errors`: typed non-fatal and fatal findings
- `explanation`: concise human-readable summary generated from the same structured decisions

Do not reconstruct explanations in a separate approximate code path. Never copy secrets or sensitive connector values into diagnostics or logs.

## 5. Initial conformance test vectors

Each vector should become a fixture with explicit input context and expected output/reason codes.

| ID | Situation | Expected result |
|---|---|---|
| PR-001 | Date-specific and weekday schedules both exist. | Use only the date-specific schedule. |
| PR-002 | No date-specific schedule exists, but weekday schedule does. | Use the weekday schedule. |
| PR-003 | Evaluation instant equals a window start. | Window is active. |
| PR-004 | Evaluation instant equals a window end. | Window is inactive. |
| PR-005 | Effective schedule has an uncovered interval. | Off time; no fallback to another schedule. |
| PR-006 | First queue candidate is ineligible; next is eligible. | Select the next eligible candidate in queue order. |
| PR-007 | Higher-priority candidate is ineligible. | Reject it; priority does not override eligibility. |
| PR-008 | Two override candidates tie on priority. | Use configured stable tie-break, or report conflict if none exists. |
| PR-009 | Active override uses WITH. | Base continues and override composition is added; base progression is preserved. |
| PR-010 | Active override uses REPLACE. | Override takes over; base progression is preserved for resumption. |
| PR-011 | Condition is unknown or stale. | Apply declared policy and expose reason/timestamp; never assume true. |
| PR-012 | Device lacks a required capability but compatible fallback is configured. | Select that fallback and explain why. |
| PR-013 | Required capability is unavailable and no valid fallback exists. | Return incompatibility. |
| PR-014 | Selected scene is not ready. | Resolution remains governed by policy; readiness/fallback is handled by runtime rules D-039–D-041. |
| PR-015 | Same versioned inputs and evaluation context are resolved twice. | Identical result, selections, and reason codes. |
| PR-016 | Finite-run state is supplied as input. | Read it without mutating or incrementing it. |

## 6. Open decisions before implementation

1. Queue and sequence advancement: when the next item becomes current; effects of completion, manual advance, errors, and restart.
2. Finite-run counting, reset boundaries, and concurrency/transaction semantics.
3. DST handling for nonexistent and repeated local times.
4. No-eligible-candidate behavior at each level: end, hold, fallback, or off time, and precedence among configured behaviors.
5. Override priority range, tie-breaks, screen/group target overlap, activation/expiry boundaries, and audio-source conflicts.
6. Unknown/stale condition policy vocabulary, freshness limits, and bounded last-known-good state keys/expiry.
7. Fallback configuration location, recursive fallback behavior, and cycle prevention.
8. Concrete input/output schemas, stable reason/error codes, compatibility, and migration/versioning rules.
9. Effective time-zone inheritance if screen, group, and tenant settings differ.
10. Which invalid inputs invalidate the entire resolution versus one candidate, and which failures are recoverable.

## 7. Implementation/review sequence

1. Review and settle the precedence table and open policies.
2. Define typed input/output schemas and stable reason/error codes.
3. Implement one pure reference resolver over a versioned input snapshot.
4. Add these fixtures plus boundary-time, invalid-input, unknown-condition, override-conflict, and DST tests.
5. Make preview, operator diagnostics, and desired-state generation call the same resolver.
6. Add regression tests proving equivalent inputs produce identical results and explanations.

Do not treat provisional rules as settled implementation requirements until the open decisions above are resolved.
