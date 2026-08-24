# Basic Playwright consumer example

This directory shows the smallest practical Aegiloc integration: one Playwright config, one
semantic target registry, and the public typed fixture API.

The example intentionally uses the repository's deterministic checkout fixture. It has no cloud
dependency, API key, AI service, database, Docker requirement, or external application.

## Run from the Aegiloc repository

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm example:verify
```

The command builds the package first, then runs this config. The controlled `drifted-discount`
mutation changes the button's exact visible text while preserving its accessible meaning. The
registered primary locator fails, the compatible candidate clears both guarded passes, and the
fixture records screenshots, audit attachments, provenance, and a visible `PASSED_WITH_HEALING`
result.

The config resolves `aegiloc/reporter` from its own module scope before giving Playwright the
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
├── tsconfig.eslint.json
├── tsconfig.json
└── tests/checkout.spec.ts
```

The repository-level command deliberately resolves `aegiloc` through the built public package
exports. In a separate consumer repository, add `@playwright/test` and a reviewed Aegiloc tarball
or future published version as development dependencies; no source-path import is required.

`tsconfig.eslint.json` is repository tooling only. It lets type-aware ESLint analyze the example
before `dist/` exists by mapping the public package names to their source entry points. The runnable
example's `tsconfig.json` and `example:verify` continue to resolve the built package contract.

## Important boundary

The final `expect(...)` assertion remains ordinary Playwright code. Only the target action goes
through Aegiloc; expected results are never eligible for healing.
