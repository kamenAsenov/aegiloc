# Realistic local storefront demo

This deterministic example makes the v1.0 evaluation behavior visible without depending on
an external site. It uses the same local checkout fixture for three intentionally different cases.

## Run it

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm example:realistic
```

The command resets only `test-results/realistic-demo`, builds the package, type-checks this consumer
example, runs Chromium, creates and verifies an evidence integrity manifest, and generates a static
report.

## What happens

| Scenario          | UI state                                                    | Expected result                                           |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| Ordinary baseline | No mutation                                                 | Plain Playwright locator succeeds; no healing occurs      |
| Safe drift        | `Apply discount` becomes `Apply Discount`                   | One compatible semantic winner is revalidated and clicked |
| Ambiguous drift   | The terms test-id changes and two matching checkboxes exist | Healwright rejects the tie and leaves both unchecked      |

The final output includes a visible `PASSED_WITH_HEALING` line for the safe case and canonical audit
events for both the successful and rejected assessments.

## Inspect the result

```bash
open test-results/realistic-demo/viewer/index.html
```

Evidence is written to `test-results/realistic-demo/evidence`. Playwright's HTML report is written to
`playwright-report/realistic-demo`. Both locations are ignored by Git.

The example never changes the checked-in registry or test source. The ambiguous case is expected to
pass only because the unsafe action is rejected and the test verifies that product state is
unchanged.
