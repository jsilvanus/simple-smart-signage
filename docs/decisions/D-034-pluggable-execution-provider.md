# D-034 — Pluggable execution provider for scene authoring and builds

- **Status:** Accepted architectural direction; provider contract and isolation profile remain to be specified
- **Date:** 2026-10-15

## Context

SiSSi needs to run Node.js/Vite for interactive scene authoring and preview, and to validate/build AI-, MCP-, or user-authored scene code before publication. That code is untrusted and may be broken or malicious. The application should not become tightly coupled to one container runtime, and a successful build must not be treated as proof that code is safe.

## Decision

- Define a runtime-independent **execution provider** boundary owned by the SiSSi server-side execution controller. SiSSi requests defined operations and receives execution status, bounded logs/diagnostics, and references to outputs; runtime-specific details stay inside the provider.
- **Podman is the first provider target.** Prefer rootless execution where practical and supported. This is a deployment choice, not a guarantee that hostile code is safe.
- Distinguish long-running **authoring/preview sessions** from **disposable validation/build jobs**. They may share a base image, but have separate lifecycles and security policies. A production artifact must be built/validated from a controlled workspace snapshot rather than trusted merely because a persistent preview session ran successfully.
- Provide defined lifecycle operations such as prepare workspace, start preview or task, inspect status, retrieve bounded logs/diagnostics, stop execution, and locate output artifacts. Do not expose a general-purpose shell or arbitrary host path API to MCP or scene code.
- Treat images, uploaded files, dependencies, workspace contents, and generated code as untrusted. Apply resource/time limits, workspace isolation, controlled dependency/network access, no injected secrets, and least privilege. Do not expose a public Podman socket or grant workloads host/container-management privileges.
- Publishing consumes a validated candidate artifact and remains a separate permissioned, reviewed workflow. Publish immutable scene revisions, never the development container itself. Build, security-policy, and publication approval are separate gates; failures retain the last-known-good published revision.
- Keep the provider interface open to other implementations, such as gVisor- or VM-backed execution, without changing the scene-authoring API.

## Consequences and open questions

The first implementation needs a provider contract, workspace/task state model, log and diagnostic format, artifact handoff, cleanup/retention policy, preview proxy integration, dependency caching policy, and deployment-specific isolation tests. Whether a worker needs an in-container supervisor/API or can be controlled entirely by the trusted server-side provider remains undecided; do not add an API inside the worker without a demonstrated need.

## Reference

- [Content creation and authoring](../creation-system.md)
- [Architecture planes and concepts](../architecture/planes-and-concepts.md)
- [Implementation plan](../plan.md)
