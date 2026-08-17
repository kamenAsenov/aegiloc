# Healwright

[![CI](https://github.com/kamenAsenov/healwright/actions/workflows/ci.yml/badge.svg)](https://github.com/kamenAsenov/healwright/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**A conservative, deterministic self-healing layer for Playwright Test.**

Current status: **v0.4.0 · experimental · pre-1.0 · Chromium-first**

Healwright recovers from genuine UI locator drift through an explicit wrapper, inspectable scoring,
and guarded execution. It is not magic AI: the same target fingerprint and live candidates always
produce the same ranking.

```ts
await healer.target('checkout.placeOrder').click();
```

> [!IMPORTANT]
> Healwright assumes that a false-positive heal is worse than a failed heal. Weak, ambiguous, or
> contradictory evidence fails closed.

## Why it exists

A locator can change while the user-facing control stays the same. Ordinary tests fail safely in
that situation; naive self-healing may do something worse by interacting with a plausible but
incorrect element and hiding a real regression.

Healwright explores a narrower approach: prove that the primary locator is genuinely missing,
identify action-compatible replacements, rank them deterministically, and execute only when every
safety gate agrees.

## What it does

- supports `click`, `fill`, `check`, and `selectOption` through semantic target keys;
- stores locators, fingerprints, action policies, and execution risk in reviewed JSON;
- distinguishes missing locators from waiting, strictness, and actionability failures;
- scores accessible identity, stable attributes, text, context, tag, and low-weight geometry;
- requires confidence, a safe runner-up margin, semantic compatibility, and a unique second pass;
- produces JSON evidence, ranked details, screenshots, proposals, health summaries, and visible
  `PASSED_WITH_HEALING` results.

## What it refuses to do

Healwright does not heal assertions, expected results, authentication, business logic, test data,
API/network failures, or genuine product regressions. It never silently edits source code or the
locator registry, and it does not require an LLM, API key, cloud service, database, OCR, or visual
AI.

## Quick start

Requirements: Node.js 20+, pnpm 11, and Chromium.

```bash
git clone https://github.com/kamenAsenov/healwright.git
cd healwright
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm test:healing
```

Playwright starts the deterministic fixture at `http://127.0.0.1:4173`. Open the report with:

```bash
pnpm exec playwright show-report
```

For a minimal consumer-shaped project, see
[`examples/basic-playwright`](examples/basic-playwright). The complete setup and demo workflow are
in [`docs/QUICKSTART.md`](docs/QUICKSTART.md).

## Minimal wrapper example

```ts
import { createHealer, loadTargetRegistry } from 'healwright';

const registry = await loadTargetRegistry(new URL('./targets.json', import.meta.url));
const healer = createHealer({
  page,
  registry,
  mode: 'guarded',
});

await healer.target('checkout.cardholderName').fill('Ada Lovelace');
await healer.target('checkout.terms').check();
```

Assertions remain ordinary Playwright assertions and are never passed to the healer.

## Safety model

- **Primary first:** Playwright runs the registered locator normally before recovery is considered.
- **Missing means missing:** healing begins only after a timeout, no observed attachment, and a final
  locator count of zero.
- **Semantics before scores:** incompatible role, accessible identity, tag, or action cannot be
  outweighed by a high numeric score.
- **Two-pass agreement:** guarded execution recollects the page and requires the same unique winner
  immediately before the action.
- **Human-controlled change:** proposal artifacts require review; source and registry files are
  never rewritten automatically.

Targets can be marked `automatic` or `proposal-only`. A proposal-only target still produces useful
evidence but can never execute a replacement. Governance waivers affect budget accounting only and
cannot bypass runtime safety.

Read the full [safety model](docs/SAFETY-MODEL.md) and
[technical reference](docs/TECHNICAL-REFERENCE.md).

## Modes

| Mode        | Behavior after proven locator drift                                       |
| ----------- | ------------------------------------------------------------------------- |
| `off`       | Preserve the primary Playwright path; do not collect healing evidence     |
| `observe`   | Rank and audit candidates without executing a replacement                 |
| `guarded`   | Execute only after all first- and second-pass safety gates succeed        |
| `strict-ci` | Rank for diagnostics, record a strict failure decision, and never execute |

## Documentation

- [Quick start and demo](docs/QUICKSTART.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Safety model](docs/SAFETY-MODEL.md)
- [Technical reference](docs/TECHNICAL-REFERENCE.md)
- [Governance policy reference](docs/POLICY.md)
- [Product positioning](docs/PRODUCT-POSITIONING.md)
- [Release process](docs/RELEASE-PROCESS.md)
- [v0.4 migration guide](docs/MIGRATION-v0.4.md)
- [Basic Playwright example](examples/basic-playwright)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md) and [security reporting](SECURITY.md)

## Quality snapshot

The repository includes strict TypeScript, runtime/JSON Schema parity, deterministic property tests,
real Chromium integration tests, adversarial negative cases, external-consumer package checks, and
CI verification of evidence and governance artifacts. The local release gate is:

```bash
pnpm release:check
```

That command validates the project and package dry run; it does not publish anything. npm publishing
also has a separate explicit human-confirmation guard. See the
[release process](docs/RELEASE-PROCESS.md).

## Limitations

- Chromium is the only qualified browser; Firefox and WebKit are planned for v0.5.
- The package is not published to npm and must currently be used from a local checkout or tarball.
- Candidate collection targets common interactive HTML and ARIA patterns, not every custom widget.
- Accessible identity depends on Playwright's public ARIA snapshot representation.
- Fingerprints and registry updates remain intentionally manual and human reviewed.
- Proposal hashes detect later changes but do not authenticate the original local evidence source.
- Reporter aggregation is scoped to one Playwright or merged-report process.
- The public API is pre-1.0 and may change with documented migrations.

See [all current limitations](docs/TECHNICAL-REFERENCE.md#limitations).

## Portfolio note

Healwright is an engineering portfolio project demonstrating strict TypeScript framework design,
public Playwright API integration, deterministic scoring, adversarial test design, evidence
artifacts, package contracts, and CI governance. It is intentionally presented as experimental and
pre-1.0: the project demonstrates a safety-first SDET architecture, not proven production adoption
or commercial maturity.

See the concise [portfolio summary](docs/PORTFOLIO-SUMMARY.md) and honest
[product positioning](docs/PRODUCT-POSITIONING.md).

## License

Released under the [MIT License](LICENSE).
