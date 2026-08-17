# Quick start

This guide runs Healwright from a local checkout. The package is not published to npm.

## Prerequisites

- Node.js 20 or newer;
- pnpm 11;
- Git;
- Chromium installed through Playwright.

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

## Run every release gate

```bash
pnpm release:check
```

This is the strongest local verification and includes a package dry run. It does not publish a
package, push Git, create a tag, or create a GitHub Release.

## Troubleshooting

- If Chromium is missing, run `pnpm exec playwright install chromium`.
- If port `4173` is occupied, stop the existing process; the test configuration intentionally uses a
  fixed deterministic base URL.
- If evidence verification reports a mismatch, rerun `pnpm test` before verifying; focused tests can
  replace the latest local report output.
- If governance reports a policy failure, inspect both health summaries and the checked-in
  [`governance/policy.json`](../governance/policy.json). Do not weaken runtime safety to satisfy a
  budget.
