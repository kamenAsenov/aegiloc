# Changelog

All notable changes to Aegiloc are documented here. The project follows Semantic Versioning for
release tags and is not published to npm.

## [Unreleased]

## [1.1.1] - 2026-08-24

### Changed

- Clarified that Healwright v1.0.1 was the initial GitHub evaluation release and Aegiloc is its
  renamed successor with a deliberately new package and CLI identity, not a drop-in minor rename.
- Documented `proposal-only` as the default recommendation for new `uncheck` targets and
  observe/proposal-first adoption for `hover`, while preserving registry compatibility behavior.
- Reframed target-health values consistently as history-derived test indicators rather than
  production telemetry or evidence of client-system reliability.

### Security

- Added explicit warnings for consent, terms, permissions, subscriptions, destructive controls, and
  hover-dependent interaction context. Runtime healing scope, scoring, and execution gates are
  unchanged.

## [1.1.0] - 2026-08-24

### Added

- Exact pathname, unique-frame, and unique-container gates for context-bounded candidate discovery.
- Placeholder, title, and alt-text primary locators plus `uncheck`, `hover`, and `focus` actions.
- Verified Playwright-native locator alternatives and schema-v3 review-only locator proposals.
- Opt-in successful-primary fingerprint observations and independent-run fingerprint proposals.
- Historical target-health analytics covering healing, ambiguity, confidence, protected attempts,
  score/margin ranges, drift age, and recent outcomes.
- A typed `createAegilocTest` fixture that wires evidence, screenshots, provenance, and visible
  `PASSED_WITH_HEALING` results.
- Comparative research, v1.1 migration guidance, and new public package/schema contracts.

### Changed

- The project, package, binary, evidence paths, report, documentation, and examples now use the
  Aegiloc identity.
- Evidence summaries advance to schema v2 and locator proposal bundles to schema v3; generated
  artifacts should be regenerated.
- The basic consumer example now demonstrates the public typed fixture.

### Security

- Context mismatch fails before candidate collection, proposal suggestions must uniquely resolve to
  the assessed element, and no locator or fingerprint proposal has an automatic apply path.

## [1.0.1] - 2026-08-23

Historical note: releases through v1.0.1 used the former Healwright source-repository identity. No
npm package was published under that name. Historical release-note files retain it intentionally.

### Fixed

- `pnpm demo` now preserves existing demo output and requires an explicit
  `pnpm cli demo --force` rerun after review.
- Troubleshooting now points repeat demo runs to the same explicit force command as the CLI error.
- Evaluator documentation warned that the former unscoped npm package name belonged to an unrelated
  project and that this release had to be run from its source checkout.

### Changed

- Current release identity, report preview, and evaluator-facing documentation now consistently
  describe the v1.0.1 stable-API evaluation release.
- The CI demo step now uses evaluation-release wording instead of the earlier technical-preview
  label.
- Focused Firefox/WebKit qualification now uses the same single-worker execution locally and in CI,
  avoiding resource-contention noise without changing coverage or performance budgets.

### Security

- Healing scope, thresholds, schemas, and public APIs are unchanged; ambiguous or unsafe candidates
  continue to fail closed.

## [1.0.0] - 2026-08-21

### Added

- A guided `aegiloc demo` / `--open` journey and deliberate `view --open` behavior with portable
  fallback paths and overwrite protection.
- A polished self-contained report with run/trust hierarchy, decision timelines, candidate signal
  tables, filters, responsive and keyboard behavior, next-action guidance, and restrictive CSP.
- Manifest-aware report generation that distinguishes canonical validation, integrity verification,
  and optional HMAC authentication.
- A machine-readable public API/schema/support snapshot plus SemVer and compatibility policy.
- Adoption, Page Object/fixture, CI evidence, troubleshooting decision-tree, and v1 release guidance.
- A reproducible screenshot of deterministic report evidence for the README.

### Changed

- Stable v1 support is Node.js 22/24 and `@playwright/test >=1.50.0 <2`, enforced through package
  metadata and a Node compatibility CI matrix.
- The development compiler is TypeScript 6.0.3, validated by strict lint, declaration build, public
  API snapshot, package-consumer contracts, and the complete test suite.
- README and product documentation now lead with the one-command evaluator journey and exact
  Chromium-first / focused Firefox-WebKit scope.
- GitHub Actions are pinned to immutable revisions with readable version comments.
- CycloneDX output includes a deterministic lockfile-derived UUID so GitHub accepts SBOM attestation.

### Security

- Viewer generation binds manifest verification to the exact history and summary input paths,
  escapes evidence in markup/data attributes, and authorizes only a hashed static filter script.
- Demo/browser opening remains explicit, source and registries are not rewritten, and healing scope or
  thresholds are unchanged.

## [0.7.0] - 2026-08-20 (source technical preview)

Prepared for review; not tagged, published to npm, or published as a GitHub Release.

### Added

- Strict evidence manifests with ordered SHA-256 digests, byte lengths, and optional
  HMAC-SHA-256 authentication using external key files.
- `aegiloc attest` and `aegiloc verify` with required-authentication mode, key identity,
  minimum key strength, POSIX permission checks, and symbolic-link rejection.
- Adversarial tests for missing, truncated, replaced, reordered, malformed, weak-key, wrong-key,
  and unauthenticated evidence.
- Deterministic CycloneDX 1.6 SBOM generation, byte-for-byte package reproducibility checks,
  dependency review, and GitHub build/SBOM attestation workflows.
- Firefox and WebKit core qualification plus a version-controlled median/p95 candidate-collection
  performance budget.
- Evidence-integrity, supply-chain, cross-browser, rotation, retention, and v0.7 release guidance.

### Changed

- Candidate collection now uses one public `Locator.evaluateAll()` DOM snapshot and bounded
  concurrent public `Locator.ariaSnapshot()` calls while preserving deterministic order.
- The complete release gate covers manifests, SBOM determinism, package reproducibility, and the
  additional browser matrix.
- Package metadata and CLI/report status identify `0.7.0 Technical Preview` consistently.

### Security

- Authenticated manifests fail closed on key mismatch or modified authenticated fields and use
  constant-time signature comparison.
- Key files remain external, are never logged, and must be owner-only regular files on POSIX.
- CI attestations are restricted to `main` pushes; pull requests receive read-only dependency review
  and unpublished artifact checks.

## [0.6.0] - 2026-08-18 (source technical preview)

Prepared for review; not tagged, published to npm, or published as a GitHub Release.

### Added

- A compiled `aegiloc` CLI with help, non-destructive initialization, registry validation, local
  diagnostics, and static report generation.
- A self-contained evidence viewer with canonical summary/history agreement, HTML escaping, clear
  empty states, ranked assessment details, successful heals, and rejected or protected outcomes.
- A deterministic realistic storefront demo covering ordinary Playwright, one safe heal, and one
  ambiguous fail-closed case with generated evidence and report output.
- Dedicated CLI, viewer, demo, known-risk, non-use, and technical-preview release documentation.
- Focused CLI, overwrite, validation, report, XSS, mismatch, smoke, and realistic Chromium tests.

### Changed

- Package metadata and documentation now identify `0.6.0 Technical Preview` consistently and expose
  `dist/cli.js` through the `aegiloc` bin entry.
- The complete release gate and CI include the realistic demo and generated-viewer verification.
- Portfolio and repository-readiness documentation from the untagged v0.5 preparation work is
  incorporated into this reviewable preview milestone.

### Security

- Report generation rejects malformed or mismatched evidence, escapes evidence-derived strings, and
  emits no remote scripts, assets, or telemetry.
- Initialization and report output refuse silent overwrite unless `--force` is explicit.
- Runtime healing scope and fail-closed rules are unchanged.

## [0.4.0] - 2026-08-16

### Added

- Explicit `automatic` and `proposal-only` target execution risk, recorded in audit evidence and
  enforced before guarded execution and second-pass resolution.
- Strict provider-neutral governance policies with run, target, target/action, and regression
  budgets; unknown-target enforcement; and deterministic retry handling.
- Exact-target temporary waivers with optional exact actions, mandatory reasons, strict UTC expiry,
  duplicate/overlap rejection, and budget-only semantics.
- Versioned deterministic JSON and sanitized Markdown health summaries plus JSON Schemas.
- Governance CLI with distinct pass, policy-failure, and malformed-input exit codes.
- GitHub Actions governance gating and health artifact upload.

### Changed

- Audit events include explicit execution risk and retry-stable operation indexes. Legacy v0.3
  events and registries remain readable with documented conservative defaults.
- `checkout.placeOrder` is proposal-only while `checkout.applyDiscount` remains automatic,
  demonstrating that business risk is not inferred from the shared `click` action.

### Security

- Governance waivers are structurally unable to influence locator safety or runtime execution.
- Canonical evidence, unknown identities, expired waivers, protected executions, and contradictory
  policy references fail closed.

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
- CI verification and retention of canonical Aegiloc evidence artifacts.
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

[0.4.0]: https://github.com/kamenAsenov/aegiloc/compare/v0.3.1...v0.4.0
[0.6.0]: https://github.com/kamenAsenov/aegiloc/compare/v0.4.0...v0.6.0
[0.7.0]: https://github.com/kamenAsenov/aegiloc/compare/v0.6.0...v0.7.0
[1.0.0]: https://github.com/kamenAsenov/aegiloc/compare/v0.4.0...v1.0.0
[1.0.1]: https://github.com/kamenAsenov/aegiloc/compare/v1.0.0...v1.0.1
[1.1.0]: https://github.com/kamenAsenov/aegiloc/compare/v1.0.1...v1.1.0
[1.1.1]: https://github.com/kamenAsenov/aegiloc/compare/v1.1.0...v1.1.1
[Unreleased]: https://github.com/kamenAsenov/aegiloc/compare/v1.1.1...HEAD
[0.3.1]: https://github.com/kamenAsenov/aegiloc/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kamenAsenov/aegiloc/compare/82513a74882500d5d31a3c8d284a0727565cef77...v0.3.0
[0.2.0]: https://github.com/kamenAsenov/aegiloc/tree/82513a74882500d5d31a3c8d284a0727565cef77
