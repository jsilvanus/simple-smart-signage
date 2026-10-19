# Asset library and provenance

- **Status:** Accepted architectural direction
- **Date:** 2026-10-15
- **Scope:** Reusable media, upload attribution, project/scene provenance, and references from scenes.

## Purpose

An asset is a reusable source resource; a scene is a presentation that uses resources; a playlist programs scenes for playback. Uploading an asset must not automatically make it part of only one scene, and using an asset in a scene must not create a duplicate source asset.

The library should let creators find, understand, reuse, and manage media while retaining its origin and attribution.

## Initial formats

The initial planned formats are:
- **MP4** video.
- **PDF** documents such as posters, flyers, and notices. Deferred from the MVP (D-053); the model keeps the type.
- **Images**, initially common web image formats, with SVG accepted only after appropriate sanitisation.

Keep the data model extensible to additional media types. **MP3/audio is a possible later format**, not a requirement for the first upload implementation. If audio support is added, playback must be an explicit scene/device capability. Audio-file support does not permit microphone use, sound detection, recording, speech recognition, or audio analysis; the separate binding no-audio decision remains in force.

## Provenance and attribution

Every asset record should preserve, where known:

- **Asset identity:** stable asset UUID and current metadata/version.
- **Uploaded by:** authenticated user who uploaded the file, plus upload timestamp.
- **Created by / creator attribution:** the person or organisation credited with creating the original material. This may differ from the uploader and can be unknown.
- **Originating project:** the project in which the asset was first uploaded/registered. Record the project identity, not merely a mutable project name.
- **Initial scene:** the scene open when the asset was first uploaded, if there was one. Library-level uploads may have no initial scene.
- **Source/rights details:** optional source URL or note, copyright/licence/permission notes, and attribution text when known.
- **File identity:** original filename, detected media type, byte size, checksum, upload/storage time, and validation status.

Distinguish immutable origin facts from current usage. Moving an asset to another project or using it in additional scenes must not overwrite its original project or initial-scene provenance. Record any later transfer or relationship separately if auditability is needed.

## AI provenance and authenticity metadata

Assets may be human-created, AI-generated, AI-transformed, externally sourced, or of unknown origin. Keep this separate from uploader identity and credited creator attribution. Where available, preserve the generating tool/provider, model, operation, timestamp, source-version links, and relevant disclosure metadata.

Preserve embedded provenance metadata and C2PA-compatible manifests where available. Record validation outcome and validator version only when SiSSi actually validates a manifest. Distinguish present, verified, invalid, and unavailable states; never infer authenticity merely because a manifest exists. Keep this provenance when deriving thumbnails, transcoding, or optimising media, and link each derivative to its source asset/version. If processing removes embedded metadata, retain available provenance in SiSSi's asset record and note the loss on the derivative.

Maintain applicable AI-transparency label icons as versioned global/system assets with source and licence metadata, separate from user-owned library assets.

A tool's assertion that an image or other asset is AI-generated may be incorrect. An authorised human must be able to correct the asset's provenance classification, including changing an erroneous AI-generated claim to a better-supported category or to unknown. Preserve the prior claim and record the correction as an auditable event with the reviewer, timestamp, reason/evidence when supplied, and affected asset version. Do not confuse the correction with cryptographic verification: human review does not make a C2PA manifest valid, and a valid manifest does not necessarily establish every aspect of an asset's authorship. Keep current classification, historical claims, validation status, and disclosure/label decisions distinguishable. Derivatives must inherit the source lineage and any correction-relevant provenance; correcting a source asset should flag dependent derivatives and scene references for appropriate review.

## Reuse, pinning, and scene relationships

- A scene references an asset by stable asset ID and a specific asset version or immutable content hash.
- Support explicit asset-version pinning. An editable scene may follow the latest asset version or pin a chosen version; the selected behavior must be visible to the creator. Published scene revisions always pin the exact versions/hashes used in that revision.
- The library records current scene references separately from the asset's initial scene.
- One asset may be used by multiple scenes and projects, subject to access permissions.
- Removing an asset from a scene removes that usage relationship; it does not delete the library asset.
- Deletion or replacement must check references and avoid breaking published scene revisions or offline playback. Published revisions retain the exact resource versions/hashes they were built against.
- Project and scene access controls apply to both discovery and retrieval. A user must not gain access to a private asset simply because they know its UUID.

## Updating an asset

When a creator uploads a replacement/new version of an existing asset, preserve the previous version and show a propagation prompt listing the scenes that currently reference the asset. Let the creator select which editable scenes should adopt the new version, with clear indication of the currently pinned version and whether each scene follows latest or is pinned.

- Do not silently change the source of a pinned scene reference.
- Propagation updates selected scene references (or their editable source configuration) to the new version; it must not mutate an already published immutable scene revision.
- For published scenes, offer to create a new scene revision/rebuild from the updated asset and publish it through the normal review/publish flow. Do not hot-swap assets underneath a published revision.
- The prompt should distinguish scenes that can be updated now from published revisions that require a new build/publish step, and respect project/scene permissions.
- Provide a safe default: no published output changes until the creator explicitly confirms the update and publishes the resulting revision.
- If the creator declines propagation, retain the new asset version in the library without changing any existing scene references. The creator can update selected scenes later.

The exact interaction may be a checklist/modal with scene name, project, current version/pinning mode, and proposed action. It should be possible to select individual scenes, select all eligible editable scenes, or skip propagation.

## Tags and search

Support creator-editable tags and searchable descriptive metadata. Tags are labels, not provenance: changing tags must not rewrite who uploaded the asset or where it originated. At minimum, filter/search by media type, creator/uploader, originating project, initial scene, tags, and upload date.

## Upload and validation

Treat uploads as untrusted input. Enforce configurable size limits, allow-listed media types, server-side type detection, safe filename handling, checksum calculation, and appropriate content/malware validation. Do not trust a filename extension or browser-supplied MIME type alone. Sanitise SVG and avoid serving untrusted files in the management application's privileged origin.

Preserve the original uploaded file as a managed source asset. Generate thumbnails, previews, PDF page renders, or video metadata as derived artifacts with their own derivation/version metadata; do not silently replace the original.

## Still to specify

The implementation contract still needs exact database schemas, project membership/ownership rules, upload limits, object-storage layout, version replacement semantics, retention/deletion policy, rights/licence fields, derived-preview generation, and the details of asset access URLs and authorisation.

## Related decisions

- [Decision register](decisions/README.md)
- [Content creation and authoring system](creation-system.md)
- [Content and playback model](content-model.md)
