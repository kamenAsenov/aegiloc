# Cross-browser qualification

Healwright remains Chromium-first for its full portfolio suite and realistic demo. v0.7 also runs a
focused core qualification suite on Playwright Firefox and WebKit.

```bash
pnpm exec playwright install firefox webkit
pnpm test:cross-browser
```

The qualification covers ordinary locators, candidate collection contracts, drift classification,
all four healed actions, adversarial ambiguity and role contradictions, execution risk, modes,
guarded second-pass behavior, and the candidate-collection performance budget. The current matrix
runs 44 scenarios per additional browser.

## Performance contract

[`performance/candidate-collection-budget.json`](../performance/candidate-collection-budget.json)
defines a 150-candidate stress case with one warm-up and five measured samples. Each browser must
remain within a 2.5-second median and 3.5-second p95. This generous upper bound is a regression alarm,
not a latency objective for ordinary pages.

Candidate collection uses one public `Locator.evaluateAll()` DOM snapshot followed by bounded
concurrent public `Locator.ariaSnapshot()` calls. Ordering remains deterministic, and a missing ARIA
snapshot continues to remove evidence rather than fabricate identity.

## Scope

Qualification means the checked contracts pass for the Playwright/browser versions in the frozen
lockfile and CI runner. It is not a promise about arbitrary browser versions, custom browser builds,
mobile engines, every accessibility implementation, or every application widget. Consumers should
run the matrix against their supported environment before relying on automatic healing.
