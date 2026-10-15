# Privacy and camera boundaries

- **Status:** Accepted
- **Decision:** D-013
- **Date:** 2026-10-15

## Context

SiSSi may optionally use a camera for a narrow local function, such as detecting temporary presence and selecting relevant signage. Camera support must not become a route to identify, profile, or track visitors.

## Binding decision

**SiSSi must never record identity or link a picture to identity or other personal data.** This applies to raw camera input and to observations or outputs derived from it.

In particular, SiSSi must not:

- Identify or attempt to recognise a person using a camera.
- Use face recognition, identity-oriented face templates/embeddings, or persistent person tracking.
- Store or transmit camera images, frames, or video.
- Link camera images, frames, or derived observations to names, accounts, device identifiers, attendance records, religious-affiliation data, or any other personal records.
- Build person-level histories or profiles from camera observations.
- Expose an override that lets an administrator or a displayed web app bypass these restrictions.

## Allowed narrow use

Camera use is optional and off by default. It must be explicitly enabled for an approved use case and app/origin, with appropriate notice and platform permissions.

Where enabled:

1. Process frames transiently on the device.
2. Discard each frame immediately after processing; do not write frames or clips to persistent storage or send them to the server.
3. Return only the minimum non-identifying signal needed for the immediate function, such as a short-lived presence trigger to choose a family-event slide.
4. Do not retain person-level observations or create a persistent tracking identifier.
5. Only produce aggregates if they are designed not to reasonably identify or single out an individual.

A model that estimates broad scene context is not proof of family relationships or exact ages. Prefer neutral context rules and avoid asserting that detected people are a family.

## Product and implementation consequences

- Camera permission is a separate, explicit capability; it is not included in general web-app permissions.
- Camera access and processing must be isolated from device-management credentials and other personal data.
- Logs and diagnostics must not contain frames, image URLs, biometric templates, or person-level camera observations.
- Privacy safeguards must be enforced by the SiSSi client/platform boundary, not merely by instructions to an app developer.
- This decision does not itself establish a lawful basis for camera use. Each deployment still needs a purpose, transparency, and legal assessment appropriate to its setting.

## Change control

This is a binding product constraint. It cannot be relaxed through ordinary configuration, content assignment, or app permissions. Any proposal to change it requires an explicit revision of this accepted decision and a documented review; until then, the prohibition remains in force.
