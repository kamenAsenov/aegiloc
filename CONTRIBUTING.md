# Contributing to Aegiloc

Thank you for helping make locator recovery safer and easier to inspect. Aegiloc v1 has a stable
public evaluation contract, so small, focused contributions with explicit safety reasoning are
preferred over broad behavior changes.

## Local setup

Requirements:

- Node.js 22 or 24;
- pnpm 11, as declared by `packageManager`;
- Chromium installed through Playwright.

```bash
git clone https://github.com/kamenAsenov/aegiloc.git
cd aegiloc
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm test:baseline
```

See [`docs/QUICKSTART.md`](docs/QUICKSTART.md) for the demo and report workflow.

## Branches and pull requests

1. Branch from the latest `main` using a descriptive name.
2. Keep commits focused and use a conventional prefix such as `feat:`, `fix:`, `docs:`, or `test:`.
3. Explain the failure mode, the safety effect, and the verification performed in the pull request.
4. Add focused tests for every behavioral change, including an adversarial case when healing could
   choose the wrong element.
5. Keep registry, runtime validation, JSON Schema, examples, and documentation synchronized.
6. Do not include generated reports, evidence, screenshots, `dist/`, or `node_modules/`.

## Useful checks

During development, run the narrowest relevant test first:

```bash
pnpm test:scoring
pnpm test:classification
pnpm test:registry
pnpm test:healing
pnpm test:healing:adversarial
pnpm test:governance
pnpm test:proposals
pnpm example:verify
```

Before requesting review, run:

```bash
pnpm release:check
```

The release check covers formatting, documentation links, linting, strict type checking, the build
and package contract, parallel reporter behavior, the complete suite, canonical evidence,
governance, the consumer example, and a package dry run. It does not publish anything.

## Safety expectations

Aegiloc treats a false-positive heal as worse than a failed heal. A change must not:

- heal assertions, expected results, authentication, business logic, test data, or network errors;
- reinterpret actionability, delayed rendering, strictness, or product failures as locator drift;
- weaken semantic identity, confidence, margin, uniqueness, or second-pass agreement;
- allow `proposal-only` targets to execute a replacement;
- silently rewrite source code or the target registry;
- record filled values, raw error details, query secrets, or unsafe absolute paths in evidence;
- make governance waivers influence runtime eligibility.

Use only public Playwright APIs in framework behavior. New dependencies require a clear maintenance
and safety justification.

## Reporting security issues

Do not open a public pull request containing exploit details or sensitive artifacts. Follow
[`SECURITY.md`](SECURITY.md) for coordinated reporting.
