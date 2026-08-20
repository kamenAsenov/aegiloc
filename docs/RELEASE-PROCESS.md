# Release process

Healwright uses Semantic Versioning tags while the public API is pre-1.0. A tag records a verified
repository checkpoint; npm publication is a separate, manual decision.

## 1. Choose the version and scope

- Update `package.json` to the intended version.
- Add a dated section to `CHANGELOG.md` with user-visible additions, changes, fixes, and safety notes.
- Update status text, migration guidance, examples, and the roadmap where behavior changed.
- Keep schema versions independent unless their actual data contracts change.

Pre-1.0 minor versions may change the public API with explicit migration notes. Patch versions should
remain backward compatible.

## 2. Prepare an isolated branch

```bash
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git switch -c release/vX.Y.Z
```

Do not build a release on a branch that is behind or diverged from `origin/main` without reviewing
the differences.

## 3. Run the local release gate

Install from the lockfile and ensure Chromium is available:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm release:check
```

The release check runs formatting, documentation-link validation, linting, strict type checking,
build and package verification, parallel reporter execution, the complete suite, evidence
verification, governance evaluation, the consumer and realistic examples, static report generation,
and `pnpm pack --dry-run --json`.

Review the package contents and confirm that generated evidence, screenshots, reports, credentials,
and unrelated local files are absent.

## 4. Review and merge

```bash
git status --short
git diff --check
git diff --stat origin/main...HEAD
```

Use focused conventional commits. Open a pull request explaining the behavior, safety effect,
verification results, limitations, and migration impact. Required GitHub Actions checks must pass on
the reviewed commit.

## 5. Tag the green commit

After the approved change reaches `main`, fetch again and verify the exact remote commit:

```bash
git fetch origin main --tags
git rev-parse main
git rev-parse origin/main
git tag -a vX.Y.Z <green-commit-sha> -m "vX.Y.Z"
git push origin vX.Y.Z
```

Never move an existing release tag. If the wrong commit was tagged but not published, stop and
document the correction rather than silently replacing public history.

## 6. Draft a GitHub Release

Use the matching file under `docs/releases/` as the starting point. The release should link the tag,
summarize safety boundaries and known limitations, and state whether the package is published.

Creating or publishing a GitHub Release is a separate maintainer action. Prepared Markdown in the
repository is not a published GitHub Release.

## 7. npm publication is explicit and non-automatic

CI does not publish to npm. No release script publishes as a side effect. Package metadata is ready
for a future publication decision, but the `prepublishOnly` guard requires the maintainer to set the
exact confirmation value documented by `scripts/guard-publish.mjs` and then runs the full release
gate.

Before any first npm publication, additionally verify:

- package-name ownership and registry access;
- the exact tarball contents and package provenance;
- the public support and deprecation policy;
- whether the reviewed current version should be the first registry release rather than assuming a
  source milestone must be published.

Do not put an npm token in the repository, command history, CI logs, or release artifacts.
