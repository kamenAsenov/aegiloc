# Repository metadata recommendations

These values are maintained here because repository settings are not part of the version-controlled
codebase. A maintainer can apply them from the GitHub repository **About** settings.

## Description

> A conservative, deterministic self-healing layer for Playwright Test.

## Topics

- `playwright`
- `testing`
- `test-automation`
- `typescript`
- `sdet`
- `self-healing-tests`
- `qa-automation`

## Website

Until a dedicated documentation site exists, use the repository URL:

`https://github.com/kamenAsenov/healwright`

No adoption, enterprise-use, revenue, or production-readiness claims should be added without
verifiable public evidence.

## Branch protection and required checks

For `main`, recommend:

- require a pull request before merging;
- require the GitHub Actions `quality` job from `.github/workflows/ci.yml`;
- require branches to be current before merge;
- block force pushes and branch deletion;
- require conversation resolution when review comments exist;
- keep repository administrators subject to the same safety checks where practical.

Signed commits or vigilant-mode signatures are useful when the maintainer workflow supports them,
but they should not be claimed as enforced until the GitHub setting is actually enabled. Tags,
GitHub Releases, and npm publication remain separate explicit approvals.
