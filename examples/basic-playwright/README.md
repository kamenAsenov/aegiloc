# Basic Playwright consumer example

This directory shows the smallest practical Healwright integration: one Playwright config, one
semantic target registry, and one test using only public package exports.

The example intentionally uses the repository's deterministic checkout fixture. It has no cloud
dependency, API key, AI service, database, Docker requirement, or external application.

## Run from the Healwright repository

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm example:verify
```

The command builds the package first, then runs this config. The controlled `drifted-discount`
mutation changes the button's exact visible text while preserving its accessible meaning. The
registered primary locator fails, the compatible candidate clears both guarded passes, and the
result is visibly marked `PASSED_WITH_HEALING`.

The config resolves `healwright/reporter` from its own module scope before giving Playwright the
absolute reporter path. This keeps local-checkout self-resolution and an installed consumer on the
same public reporter export.

Open the example report with:

```bash
pnpm exec playwright show-report playwright-report/basic-playwright
```

Example evidence is isolated under:

```text
test-results/basic-playwright/evidence/
```

## Consumer structure

```text
basic-playwright/
├── playwright.config.ts
├── targets.json
├── tsconfig.json
└── tests/checkout.spec.ts
```

The repository-level command deliberately resolves `healwright` through the built public package
exports. In a separate consumer repository, add `@playwright/test` and a reviewed Healwright tarball
or future published version as development dependencies; no source-path import is required.

## Important boundary

The final `expect(...)` assertion remains ordinary Playwright code. Only the target action goes
through Healwright; expected results are never eligible for healing.
