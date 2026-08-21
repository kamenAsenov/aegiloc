# Realistic demo

The realistic demo is a deterministic local checkout flow under
[`examples/realistic-demo`](../examples/realistic-demo). It exists so a new developer can evaluate
ordinary behavior, safe recovery, rejection, evidence, and the report viewer with one command.

## Run

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm demo
```

No public website, account, API key, Docker service, database, or network fixture is required.

## Scenario 1: ordinary Playwright

The fixture has no mutation. A normal `getByRole` locator clicks **Apply discount** and the status
changes. Healwright is not invoked. This keeps ordinary Playwright as the baseline rather than
making every action dependent on recovery logic.

## Scenario 2: safe locator drift

The fixture changes visible text from `Apply discount` to `Apply Discount`. The registered exact
text locator is genuinely absent, while the live button retains compatible accessible identity,
tag, text, and context. The unique winner clears confidence and margin gates, agrees on the second
pass, and is clicked. The test prints `PASSED_WITH_HEALING`.

## Scenario 3: ambiguous drift

The fixture changes the terms checkbox test-id and duplicates the replacement. Both candidates have
the same semantic signals and score. The margin is zero, Healwright rejects the assessment, neither
checkbox is checked, and no healed result is attached. The test passes because it verifies this
fail-closed behavior.

## Outputs

```text
test-results/realistic-demo/evidence/history.jsonl
test-results/realistic-demo/evidence/summary.json
test-results/realistic-demo/evidence/manifest.json
test-results/realistic-demo/viewer/index.html
playwright-report/realistic-demo/index.html
```

The command creates and verifies an unsigned integrity manifest and renders the viewer from those
exact manifest inputs. A repeat `pnpm demo` refuses to replace `test-results/realistic-demo`; review
the output, then rerun explicitly with `pnpm cli demo --force`. The internal
`pnpm example:realistic` CI pipeline deliberately clears only that ignored output directory before
execution so automated demonstrations remain deterministic. Neither path deletes or edits source
files.

Run `pnpm cli demo --force --open` to request opening explicitly, or open the static viewer with:

```bash
open test-results/realistic-demo/viewer/index.html
```

Use `xdg-open` on Linux or `start` on Windows.
