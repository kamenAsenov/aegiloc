# Technical reference

This document retains the detailed operational material that would make the project README too
dense for first-time readers. Start with the [README](../README.md) and
[architecture](ARCHITECTURE.md) if you are new to Healwright.

## Runtime modes

| Mode        | Missing-locator behavior                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `off`       | Runs only the primary Playwright action; no classification, collection, or audit event               |
| `observe`   | Classifies, ranks, and audits candidates, then preserves the missing-primary failure                 |
| `guarded`   | Executes only after the candidate passes policy twice and resolves to one unique accessible identity |
| `strict-ci` | Ranks for diagnostics but always records a strict CI failure decision                                |

`guarded` is the default. A first-pass `eligible` result is necessary but never sufficient to
execute. Healwright recollects and reranks the live page, requires the same winner and safe margin,
checks current execution risk, then resolves an exact accessible role/name/tag locator. A candidate
test ID further narrows the locator when available. Exactly one element must match.

## Target registry

Targets are human-reviewed and version controlled in [`registry/targets.json`](../registry/targets.json).
The companion JSON Schema provides editor support, while the runtime parser rejects unknown fields,
invalid roles, unsupported actions, duplicate actions, malformed fingerprints, and unsafe policy
values.

```json
{
  "checkout.placeOrder": {
    "description": "Final checkout submission button",
    "primary": {
      "type": "role",
      "role": "button",
      "name": "Place order",
      "exact": true
    },
    "fingerprint": {
      "accessibleRole": "button",
      "accessibleName": "Place order",
      "visibleText": "Place order",
      "tag": "button",
      "ancestorText": ["Checkout"]
    },
    "policy": {
      "allowedActions": ["click"],
      "executionRisk": "proposal-only",
      "healing": {
        "enabled": true,
        "confidenceThreshold": 0.95,
        "minimumScoreMargin": 0.2
      }
    }
  }
}
```

Supported primary locator types are role, label, test-id, text, and CSS. Supported wrapper actions
are `click`, `fill`, `check`, and `selectOption`. Every action checks its allowlist before resolving
the primary locator.

`automatic` permits guarded execution after every safety gate passes. `proposal-only` collects and
ranks evidence but never executes a replacement. Older v0.3 registries without `executionRisk`
retain the documented `automatic` compatibility default; v0.4 registries should declare it
explicitly. See [`MIGRATION-v0.4.md`](MIGRATION-v0.4.md).

## Deterministic scoring

The scoring engine is pure: identical fingerprints and candidate snapshots produce the same ranking.
Equal scores use the candidate ID as a stable tie-breaker. Text normalization is locale-independent
and Unicode-aware; it preserves letters and numbers across scripts, folds diacritics deterministically,
and assigns zero similarity to empty or punctuation-only values.

| Signal            | Weight | Notes                                   |
| ----------------- | -----: | --------------------------------------- |
| Accessible name   |    24% | Token and edit similarity               |
| Accessible role   |    22% | Exact normalized match                  |
| Stable attributes |    20% | Per-attribute similarity                |
| Visible text      |    12% | Token and edit similarity               |
| Ancestor context  |     7% | Best match for expected context         |
| Neighbor context  |     6% | Best match for expected nearby text     |
| Element tag       |     6% | Exact normalized match                  |
| Geometry          |     3% | Low-weight normalized position and size |

Only signals present in the stored fingerprint participate in normalization. Weighted signals rank
candidates but cannot compensate for mandatory semantic failures. Stable assessment reasons are
`eligible`, `disabled`, `no-candidates`, `semantic-ineligible`, `low-confidence`, and `ambiguous`.

```ts
import { assessCandidates, collectCandidates, rankCandidates } from 'healwright';

const definition = registry.targets['checkout.placeOrder'];
const candidates = await collectCandidates(page, 'click');
const ranked = rankCandidates(definition.fingerprint, candidates, 'click');
const assessment = assessCandidates(ranked, definition.policy.healing);
```

## Audit events and privacy

Every assessed drift produces a versioned `locator-drift-assessed` event before guarded execution.
A guarded decision can then produce `locator-heal-execution` with status `succeeded`, `failed`, or
`rejected`, a stable reason, its parent assessment, and safe screenshot references.

Events record the mode, target, action, execution risk, retry-stable operation index, sanitized
failure category, collection status, thresholds, margin, semantic eligibility, and ranked per-signal
details. Optional provenance records the run, Playwright test ID, project, retry, and commit SHA.

Action values such as filled text are never serialized. Raw error messages and absolute screenshot
paths are omitted. Collected URL attributes are reduced to pathnames. Candidate text is bounded, and
common text-like controls are masked in framework screenshots.

Sinks are composable:

```ts
import {
  CompositeAuditSink,
  JsonlAuditSink,
  PlaywrightAttachmentAuditSink,
  createHealer,
} from 'healwright';

const auditSink = new CompositeAuditSink([
  new JsonlAuditSink(testInfo.outputPath('healwright-history.jsonl')),
  new PlaywrightAttachmentAuditSink(testInfo),
]);

const healer = createHealer({ page, registry, mode: 'observe', auditSink });
```

An audit-write failure becomes `AuditWriteError`; execution cannot continue without its required
trail. A pre-action screenshot failure also prevents execution. A replacement actionability failure
is preserved and never emits a passing marker.

## Reporter and canonical history

For parallel runs, `PlaywrightAttachmentAuditSink` sends typed attachments to the coordinator. The
Healwright reporter writes:

```text
test-results/healwright/history.jsonl
test-results/healwright/summary.json
```

The summary covers assessment decisions, execution outcomes, target/action counts, successful
heals, runs, tests, projects, retries, commits, and legacy events. Identical duplicates are
deduplicated. Conflicting event reuse, malformed attachments, missing bodies, and name/body mismatch
fail the run. Output is deterministic and written atomically.

```bash
pnpm evidence:verify
```

For proposal-quality evidence, configure one stable run ID per suite execution and reuse it across
retries. `GITHUB_RUN_ID` works in GitHub Actions; local independent runs can set
`HEALWRIGHT_RUN_ID`. Falling back to a test ID is safe for auditing but repeated executions will not
count as independent proposal evidence.

## Reviewable locator proposals

Generate local review artifacts with:

```bash
pnpm proposal:generate -- \
  --history test-results/healwright/history.jsonl \
  --registry registry/targets.json \
  --json test-results/healwright/proposals.json \
  --markdown test-results/healwright/proposals.md
```

The default requires three distinct provenance run IDs agreeing on the same target, action, and
accessible role/name identity. Retries and repeated actions within one run cannot inflate consensus.
Qualifying chains must connect an eligible assessment to successful guarded execution under
matching provenance.

Rejected evidence includes legacy observations without semantic proof, mixed or partial commit
provenance, reused assessments, orphaned executions, unsafe screenshot references, unsupported
roles, missing identity, stale registry state, changed thresholds, no-longer-allowed actions,
missing screenshot phases, conflicting candidates, and an already-current suggestion.

Each accepted proposal includes the current locator, suggested exact role locator, score/margin
ranges, bounded provenance, event and screenshot references, a target-definition digest, a
deterministic SHA-256 proposal ID, and `review-required` status.

```bash
pnpm proposal:verify -- \
  --proposal test-results/healwright/proposals.json \
  --registry registry/targets.json
```

Neither command modifies history, source, or registry input. Output paths are prevented from
overwriting those inputs.

## Governance and health summaries

Governance consumes canonical history after Playwright finishes. It supports successful/rejected
per-run limits, target and target/action successful-heal limits, growth baselines, unknown-target
enforcement, retry deduplication, and exact temporary waivers.

```bash
pnpm governance:evaluate -- \
  --history test-results/healwright/history.jsonl \
  --registry registry/targets.json \
  --policy governance/policy.json \
  --json test-results/healwright/health-summary.json \
  --markdown test-results/healwright/health-summary.md
```

Exit `0` is a pass, `1` is a valid policy failure, and `2` is malformed, conflicting,
non-canonical, or unreadable input. Output is ordered by target, action, project, and outcome and
contains bounded identities rather than raw candidate content.

Waivers require an exact target, optional exact action, non-empty reason, and future UTC expiry.
Wildcards, duplicates, overlaps, malformed dates, and expired waivers fail closed. See
[`POLICY.md`](POLICY.md).

## Deterministic fixture

The local checkout app supports controlled query-string mutations:

| Mutation                   | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `missing-place-order`      | Genuine primary-locator absence                               |
| `delayed-place-order`      | Normal Playwright waiting                                     |
| `disabled-place-order`     | Actionability failure                                         |
| `duplicate-place-order`    | Strict-locator ambiguity                                      |
| `detached-place-order`     | Target observed, then removed                                 |
| `drifted-terms`            | Genuine test-id drift with a semantically identical candidate |
| `drifted-cardholder`       | Exact-label case drift for `fill`                             |
| `drifted-country`          | CSS ID drift for `selectOption`                               |
| `drifted-discount`         | Exact-text case drift for `click`                             |
| `drifted-place-order`      | Protected final-action accessible-name drift                  |
| `ambiguous-drifted-terms`  | Two indistinguishable checkbox candidates                     |
| `drifted-disabled-terms`   | Compatible but non-actionable replacement                     |
| `drifted-wrong-role-terms` | Same control data with a contradictory accessible role        |

The suite combines unit, integration, browser, schema-parity, seeded property, package, CLI, and
adversarial tests. Fast-check uses the fixed seed `20260815` so property failures are reproducible.

## Package contract

`pnpm build` emits typed ESM to `dist/`. Intentional entry points are:

- `healwright` — framework API;
- `healwright/reporter` — Playwright reporter;
- `healwright/registry-schema` — target registry schema;
- `healwright/proposal-schema` — review proposal schema;
- `healwright/evidence-summary-schema` — run summary schema;
- `healwright/evidence-manifest-schema` — evidence integrity/authentication schema;
- `healwright/governance-policy-schema` — governance configuration schema;
- `healwright/health-summary-schema` — health result schema.

`pnpm package:check` compiles an external-style consumer, imports runtime entry points through Node
package resolution, verifies build artifacts, exercises evidence/proposal/governance CLIs and their
tamper failures, and inspects `pnpm pack --dry-run --json`. It creates no publication.

The `healwright` package bin resolves to `dist/cli.js`. Its `attest` and `verify` commands map to the
public evidence-manifest APIs. Its `view` command is also available as the public
`generateReportViewer` and `renderReportViewer` APIs. Report generation requires canonical
history and an exactly matching summary and produces escaped static HTML without remote assets.

## Project structure

```text
.
├── docs/                       # Architecture, safety, product, policy, and release references
├── examples/basic-playwright/  # Minimal consumer-shaped Playwright project
├── examples/realistic-demo/    # Ordinary, healed, and ambiguous local evaluation flow
├── examples/governance/        # Passing and deliberately failing policies
├── fixtures/app/               # Deterministic checkout UI and controlled mutations
├── governance/                 # Checked-in run policy
├── package-tests/              # External-consumer TypeScript contract
├── performance/                # Version-controlled collection performance budget
├── registry/                   # Target, evidence, proposal, policy, and health schemas
├── scripts/                    # Fixture, evidence, proposal, governance, package, release tools
├── src/                        # Framework implementation and public exports
├── tests/                      # Unit, integration, property, browser, and adversarial tests
├── playwright.config.ts        # Full Chromium test and reporter configuration
├── playwright.cross-browser.config.ts # Firefox/WebKit core qualification
└── .github/workflows/ci.yml    # Complete quality pipeline
```

## Limitations

- The full portfolio suite and realistic demo are Chromium-first; the core browser contract is also
  qualified on Firefox and WebKit through the dedicated matrix.
- This repository is not currently published to a registry. The unscoped `healwright` npm name is
  occupied by an unrelated project and must not be used to install this source release.
- Candidate collection covers common interactive HTML and ARIA patterns, not arbitrary widgets.
- Accessible identity uses Playwright's public ARIA snapshot representation.
- Fingerprints and registry changes remain manual; proposals have no auto-apply path.
- Proposal consensus requires configured run provenance; legacy history remains readable but is not
  confidence evidence.
- Pre-v0.3.1 history without semantic-eligibility proof is excluded from proposals.
- v0.3 events without operation indexes conservatively treat repeated same-target actions as one
  retry identity.
- Protected observations never execute, and the current proposal generator requires successful
  guarded execution, so protected-only evidence cannot generate a proposal.
- Commit provenance is optional, but mixed or partially recorded commits fail proposal generation.
- Optional manifests authenticate evidence with a shared HMAC key; unsigned manifests and shared-key
  attribution still require an external trust and key-management policy.
- Guarded execution requires exact, unique accessible identity; otherwise it fails closed even after
  a high ranking.
- Reporter aggregation is local to one Playwright or merged-report process; cross-machine storage is
  the CI or consumer's responsibility.
- Waivers are budget-only and still require human review and removal.
- The public API follows the stable v1 contract in [`COMPATIBILITY.md`](COMPATIBILITY.md); this does
  not imply production adoption or support for unexported internals.
