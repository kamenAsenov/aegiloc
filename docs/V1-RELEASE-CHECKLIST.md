# v1.0.0 release checklist

This checklist records observed repository state and release evidence. A checked item means the
command or GitHub check actually passed; unchecked items are work remaining, not implied results.

## Factual baseline — 2026-08-20

- [x] v0.7 was merged through PR [#3](https://github.com/kamenAsenov/healwright/pull/3).
- [x] merged `main` baseline is `936bca2661ad137e3b24d2c5437fecd278289b3b`.
- [x] `release/v1.0.0` was created from that exact commit with a clean worktree.
- [x] no `v0.7.0` tag or GitHub Release exists.
- [x] existing tags are `v0.3.0`, `v0.3.1`, and `v0.4.0`.
- [x] npm publication remains outside this mission.
- [x] TypeScript 6.0.3 from Dependabot PR #4 was incorporated with a clean lockfile and passed the
      complete v1 gate. The PR's original failure was isolated to formatting of its generated
      lockfile; no lint rule or production quality gate was weakened.

## Baseline verification actually run

Environment: macOS, Node.js `24.19.0`, pnpm `11.19.0`.

- [x] `pnpm install --frozen-lockfile` — already up to date.
- [x] `pnpm format:check` — passed.
- [x] `pnpm docs:check` — 76 local links across 28 Markdown files.
- [x] `pnpm lint` — passed.
- [x] `pnpm typecheck` — passed.
- [x] `pnpm build` — passed.
- [x] `pnpm package:check` — 83 runtime exports, 58 build artifacts, and 165 dry-run package files.
- [x] `pnpm test:unit` — 190 passed.
- [x] v0.7 `main` quality job — passed, including Chromium and focused Firefox/WebKit suites.
- [ ] v0.7 `main` supply-chain job — package provenance passed, but SBOM attestation failed because
      `actions/attest@v4` rejected the generated document as an unsupported SBOM format.
- [x] root cause confirmed in the official action: CycloneDX detection requires `bomFormat`,
      `specVersion`, and `serialNumber`; v1 now emits a deterministic lockfile-derived UUID.

## v1 scope decisions

- Preserve the proven healing runtime and all fail-closed thresholds.
- Stabilize the existing public API rather than redesigning or broadening automatic healing.
- Make the static local report the primary product surface; no hosted service, telemetry, account,
  database, or frontend build system.
- Add a guided repository demo command and optional explicit browser opening.
- Treat `v1.0.0` as a stable API and schema contract for a carefully scoped evaluation release, not
  a claim of production adoption.
- Keep Chromium as the full-suite browser and Firefox/WebKit as the focused core qualification.
- Create a GitHub tag and Release only after the exact merged release commit is green.
- Do not publish to npm.

## Implementation gates

- [x] v1 product/UX brief accepted by implementation and tests.
- [x] report overview, event timeline, candidate comparison, filters, trust state, and next actions.
- [x] accessible and responsive report behavior with safe evidence escaping.
- [x] guided `healwright demo` and explicit `--open` behavior.
- [x] first-user README and realistic screenshot from generated product output.
- [x] adoption, Page Object/fixture, CI/retention, proposal review, and troubleshooting guidance.
- [x] public API inventory snapshot and compatibility policy.
- [x] Node/Playwright support matrix consistent across metadata, CI, docs, and tests.
- [x] deterministic package contents and locally validated attestable SBOM structure.
- [x] immutable GitHub Action revisions with update provenance comments.
- [x] TypeScript 6.0.3 fast qualification: format, docs, lint, typecheck, build, public API snapshot,
      package contracts, and 198 unit tests.
- [x] no safety-boundary regression in adversarial tests.

## Final release gates

- [x] `pnpm release:check` — passed locally on Node.js 24.19.0 and TypeScript 6.0.3:
  - 83 runtime exports, 64 build artifacts, and 173 dry-run package files;
  - reproducible 351827-byte tarball with SHA-256
    `565553d01b73432538498aba3cec75c14d9b01d4eabfd184ba4a899fa107d093`;
  - deterministic CycloneDX 1.6 SBOM with 102 components;
  - 4 parallel healing tests, 244 Chromium tests, and 88 focused Firefox/WebKit tests;
  - 10 canonical evidence events, an integrity manifest, and governance PASS with 0 violations;
  - 1 basic consumer test and 3 realistic demo tests.
- [x] pull-request dependency review, Node 22/24 compatibility, quality, and supply-chain jobs — all
      passed in [CI run 32504809275](https://github.com/kamenAsenov/healwright/actions/runs/32504809275).
- [x] release branch diff/security/package audit — `git diff --check` passed, no repository-local
      absolute paths or common credential patterns were found, the committed screenshot is a
      1440×1040 PNG, and the dry-run package contains the reviewed 173-file manifest.
- [x] exact reviewed release commit merged to `main` as
      [`c414136`](https://github.com/kamenAsenov/healwright/commit/c4141360b7642b458c8de5875270c84005ad66f8)
- [x] post-merge `main` CI, including provenance and SBOM attestations — passed in
      [CI run 32505903244](https://github.com/kamenAsenov/healwright/actions/runs/32505903244)
- [x] annotated `v1.0.0` tag on the verified merged commit
- [x] [GitHub Release](https://github.com/kamenAsenov/healwright/releases/tag/v1.0.0) with honest scope
      and limitations
- [x] npm publication explicitly reported as not performed
