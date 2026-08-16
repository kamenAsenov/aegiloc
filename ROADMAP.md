# Healwright roadmap

This roadmap starts from the verified `v0.2.0` baseline. It orders work by safety value: evidence
integrity and operational reliability come before broader healing behavior. A false-positive heal
remains worse than a failed heal at every stage.

## Implemented baseline

### Target model and wrapper

- Explicit `healer.target(key).action()` API with `click`, `fill`, `check`, and `selectOption`.
- Strict, version-controlled JSON target registry with role, label, test-id, text, and CSS primary
  locators.
- Per-target action allowlists, healing enablement, confidence thresholds, and score margins.
- Runtime validation plus a checked-in JSON Schema.

### Drift classification and guarded execution

- The primary Playwright locator runs normally first.
- Healing is considered only after a public-API proof that the primary locator timed out, was never
  attached, and still resolves to zero elements.
- Ordinary waiting, actionability, strictness, detachment, navigation, and page failures are
  preserved as normal Playwright failures.
- Live candidates are filtered by action compatibility and scored deterministically from accessible
  role/name, stable attributes, text, tag, ancestor and neighbor context, and low-weight geometry.
- Both a confidence threshold and runner-up margin are required.
- `guarded` mode performs a fresh second collection, requires the same winner, resolves one exact
  accessible identity, and fails closed if that identity is not unique.

### Modes, evidence, and review

- `off`, `observe`, `guarded`, and `strict-ci` modes.
- Versioned assessment and execution audit events, JSONL sinks, Playwright attachments, sanitized
  errors, masked screenshots, and visible `PASSED_WITH_HEALING` results.
- Versioned provenance for run, test, project, retry, and optional commit identity.
- Review-only locator proposals requiring three independent agreeing runs.
- Retry resistance, legacy-history migration, mixed-commit rejection, deterministic proposal hashes,
  stale-registry detection, strict bundle parsing, and a verification CLI.
- No automatic source or registry rewriting.

### Engineering quality

- Strict TypeScript ESM package, explicit exports, source maps, declarations, and external-consumer
  checks.
- Deterministic fixture application with positive and adversarial mutations.
- Unit, browser, schema-parity, seeded property, package, and CLI tests.
- Chromium-first GitHub Actions pipeline with Playwright report artifacts.

## Upgrade sequence

### v0.3 — Reliable run evidence

Status: implemented in `v0.3.0`.

- Aggregate audit attachments in the Playwright reporter instead of relying on concurrent workers to
  append one shared history file.
- Write canonical JSONL and a machine-readable run summary atomically.
- Reject malformed attachments and conflicting duplicate event IDs.
- Preserve retry and project provenance in deterministic summaries.
- Upload evidence artifacts in CI and keep proposal generation compatible with the canonical output.
- Test reporter output with both synthetic results and a real parallel Playwright run.

This stage makes evidence collection dependable before adding more automation around that evidence.

### v0.3.1 — Unicode and semantic safety hardening

Status: implemented in `v0.3.1`.

- Preserve Unicode letters and numbers during deterministic text normalization, including Cyrillic,
  Greek, accented Latin, CJK, and mixed-script labels.
- Treat empty and punctuation-only normalized values as zero similarity.
- Separate weighted ranking signals from mandatory semantic execution eligibility.
- Reject missing accessible identity, known role or tag contradictions, and action-incompatible
  element identities in both guarded passes.
- Record stable semantic rejection reasons in audit evidence and exclude pre-eligibility evidence
  from locator proposals.

### v0.4 — Policy governance and healing budgets

Status: implemented in `v0.4.0`.

- Explicit `automatic` and `proposal-only` target execution risk, with protected evidence collection
  and enforcement before both initial execution and second-pass resolution.
- Optional run, target, and target/action budgets plus successful/rejected baselines.
- Exact-scope, reasoned, UTC-expiring waivers that affect budget accounting only.
- Retry-aware, deterministic JSON and Markdown health summaries grouped by target, action, project,
  and outcome.
- Provider-neutral CLI exit codes for pass, policy failure, and malformed input, consumed by CI with
  uploaded health artifacts.

### v0.5 — Cross-browser qualification

- Qualify the public-API collector and guarded resolver on Firefox and WebKit.
- Keep Chromium as the fast default while offering an opt-in browser contract matrix.
- Add browser-difference fixtures and require semantic agreement where accessibility snapshots vary.
- Establish performance budgets for candidate collection on large interactive pages.

### v0.6 — Stronger evidence integrity and supply chain

- Add optional authenticated evidence manifests or signatures without making a cloud service or key
  mandatory.
- Detect missing, reordered, replaced, or truncated evidence files against a trusted manifest.
- Add dependency review, SBOM generation, provenance-aware release artifacts, and reproducible package
  checks.
- Document secret rotation and retention guidance for teams that enable authenticated evidence.

### v1.0 — Stable framework contract

- Freeze the public API after an explicit compatibility review.
- Publish migration guides, operational examples, and a troubleshooting reference.
- Add long-running reliability and performance benchmarks.
- Expand consumer examples for fixtures, page objects, CI sharding, and proposal review.
- Define support windows for Node.js and Playwright versions.

## Deliberate non-goals

Healwright will not heal assertions, expected results, business logic, authentication, test data,
network failures, or genuine product regressions. It will not silently rewrite tests or the target
registry. LLMs, OCR, visual AI, external services, databases, and API keys remain unnecessary for
the core framework.

## Release gate for every increment

Each increment must keep formatting, linting, strict type checking, package verification, schema
parity, unit tests, real Chromium tests, adversarial negative tests, and package dry-run checks green.
Documentation and known limitations must match runtime behavior before a commit is proposed.
