# Quick start

This guide runs Healwright from a local checkout. The package is not published to npm.

## Prerequisites

- Node.js 22 or 24;
- pnpm 11;
- Git;
- Chromium installed through Playwright; Firefox and WebKit for the qualification gate.

## Install and build

```bash
git clone https://github.com/kamenAsenov/healwright.git
cd healwright
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
```

`pnpm build` creates the ignored `dist/` directory with ESM JavaScript, declarations, and source
maps. Nothing is published.

Confirm the local CLI and package prerequisites:

```bash
node dist/cli.js --help
node dist/cli.js doctor
```

## Run the interactive local demo

```bash
pnpm demo
```

This runs ordinary Playwright, one safe locator recovery, and one ambiguous rejection; verifies the
evidence manifest; and prints the absolute path to the v1 local report. Use
`pnpm cli demo --force --open` only when you explicitly want to launch the browser.

## Confirm the ordinary Playwright path

```bash
pnpm test:baseline
pnpm test:primary
```

These tests use the fixture without locator drift. The wrapper resolves each primary locator and
Playwright performs the action normally.

## Run the healing demo

```bash
pnpm test:healing
```

The focused suite applies controlled mutations for `click`, `fill`, `check`, and `selectOption`.
Expected successful recoveries are printed as `PASSED_WITH_HEALING` and include structured audit and
screenshot attachments.

Open the HTML report after the test:

```bash
pnpm exec playwright show-report
```

The report should show the ordinary test status plus visible healing annotations. Local evidence is
written below `test-results/`, which is intentionally ignored by Git.

## Run adversarial cases

```bash
pnpm test:healing:adversarial
pnpm test:missing
pnpm test:modes:browser
```

These cases demonstrate that ambiguous candidates, disabled replacements, contradictory roles,
delayed controls, strict locators, and detached elements are not converted into passing tests.

## Inspect the fixture manually

Start the deterministic app:

```bash
node scripts/serve-fixture.mjs
```

Then open `http://127.0.0.1:4173`. Controlled states use the `mutation` query parameter, for example:

- `?mutation=drifted-discount`
- `?mutation=drifted-cardholder`
- `?mutation=ambiguous-drifted-terms`
- `?mutation=disabled-place-order`

Stop the server with `Ctrl+C`. Playwright starts and stops the same server automatically for tests.

## Run the consumer example

```bash
pnpm example:verify
```

This builds Healwright, starts the existing fixture, and executes the minimal project under
[`examples/basic-playwright`](../examples/basic-playwright). The example imports the package through
its public export rather than reaching into `src/`.

## Run the realistic demo pipeline directly

```bash
pnpm example:realistic
```

This runs an ordinary Playwright flow, one safe locator recovery, and one ambiguous rejection, then
generates:

```text
test-results/realistic-demo/evidence/history.jsonl
test-results/realistic-demo/evidence/summary.json
test-results/realistic-demo/evidence/manifest.json
test-results/realistic-demo/viewer/index.html
```

The viewer verifies the sibling manifest before rendering. Open the last file directly in a browser.
See the [realistic demo](REALISTIC-DEMO.md) and
[report viewer](REPORT-VIEWER.md) guides for the exact behavior and artifact boundaries.

## Verify evidence and governance

Run the complete suite first so the reporter produces canonical artifacts:

```bash
pnpm test
pnpm evidence:verify
pnpm governance:evaluate
```

Expected files:

```text
test-results/healwright/history.jsonl
test-results/healwright/summary.json
test-results/healwright/health-summary.json
test-results/healwright/health-summary.md
```

Evidence verification rejects malformed, conflicting, or non-canonical history. Governance returns
exit `0` for a pass, `1` for a valid policy violation, and `2` for invalid evidence or configuration.

Create and verify a deterministic integrity manifest:

```bash
pnpm evidence:attest
pnpm evidence:manifest:verify
```

For optional HMAC authentication and key rotation, use the explicit CLI flow in the
[evidence integrity guide](EVIDENCE-INTEGRITY.md).

## Run cross-browser and supply-chain qualification

```bash
pnpm exec playwright install firefox webkit
pnpm test:cross-browser
pnpm package:reproducible
pnpm supply-chain:sbom
pnpm supply-chain:sbom:check
```

The browser matrix enforces the checked core contracts and a 150-candidate performance budget. The
supply-chain commands create local generated output only; they do not publish a package.

## Run every release gate

```bash
pnpm release:check
```

This is the strongest local verification and includes a package dry run. It does not publish a
package, push Git, create a tag, or create a GitHub Release.

## Troubleshooting

Use the [outcome-based troubleshooting decision tree](TROUBLESHOOTING.md). It distinguishes setup,
ordinary Playwright failures, safe rejection, guarded execution, evidence trust, and governance
without suggesting unsafe threshold changes.
