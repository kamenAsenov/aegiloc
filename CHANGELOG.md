# Changelog

All notable changes to Healwright are documented here. The project follows Semantic Versioning for
release tags while the public package remains private and unpublished.

## [0.3.1] - 2026-08-16

### Fixed

- Unicode normalization now preserves Cyrillic, Greek, CJK, and other Unicode letters and numbers
  while retaining deterministic diacritic folding.
- Empty and punctuation-only normalized strings no longer receive perfect similarity.
- Edit similarity now compares Unicode code points instead of UTF-16 code units.

### Security

- Known role mismatch, registered tag mismatch, missing accessible identity, and action-incompatible
  element identity are mandatory eligibility failures rather than weighted hints.
- First-pass and guarded second-pass evaluation now enforce the same semantic gates.
- Audit evidence records stable semantic rejection reasons, and proposal generation excludes older
  evidence that does not prove semantic eligibility.

## [0.3.0] - 2026-08-16

### Added

- Reporter-level aggregation of typed Playwright audit attachments.
- Canonical JSONL evidence and deterministic machine-readable run summaries.
- Atomic evidence output, strict malformed-input handling, exact duplicate deduplication, and
  conflicting event-ID rejection.
- Provenance summaries covering runs, tests, projects, retries, commits, and legacy events.
- An independently runnable evidence-verification CLI and strict summary JSON Schema.
- CI verification and retention of canonical Healwright evidence artifacts.
- Synthetic reporter tests and an explicit four-worker Chromium reporter integration gate.

### Changed

- Package version advanced from `0.2.0` to `0.3.0`.
- Package exports now include the evidence-summary schema.
- Proposal generation continues to consume the canonical JSONL history format.

### Security

- Typed attachments, existing worker history, and duplicate event IDs now fail closed when their
  content is malformed, unreadable, or contradictory.

## [0.2.0] - 2026-08-15

### Added

- Provenance-backed, review-only locator proposal generation.
- Independent-run consensus, retry resistance, mixed-commit rejection, stale-registry detection,
  deterministic proposal hashes, and strict proposal verification.
- Guarded healing execution with screenshots, JSONL audit events, and visible
  `PASSED_WITH_HEALING` results.

[0.3.1]: https://github.com/kamenAsenov/healwright/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kamenAsenov/healwright/compare/82513a74882500d5d31a3c8d284a0727565cef77...v0.3.0
[0.2.0]: https://github.com/kamenAsenov/healwright/tree/82513a74882500d5d31a3c8d284a0727565cef77
