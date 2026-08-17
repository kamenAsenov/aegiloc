# Security and safety policy

## Supported versions

Healwright is experimental and pre-1.0. Security and safety fixes are applied to the latest code on
`main`; older tags are retained for reproducibility but are not maintained as separate support
lines.

## Reporting an issue

Prefer GitHub's private **Report a vulnerability** flow on the repository Security tab when it is
available. If private vulnerability reporting is unavailable, contact the repository owner through
their GitHub profile before publishing details. Please do not attach real credentials, customer
data, filled form values, or unredacted screenshots.

Include, when safe:

- the affected commit or tag and Playwright/Node versions;
- a minimal deterministic reproduction;
- the expected fail-closed behavior and the observed behavior;
- whether an incorrect candidate was executed;
- which evidence, screenshot, report, or proposal artifacts were written;
- a suggested mitigation, if known.

## High-priority issue classes

The following are security or safety issues for Healwright:

- a false-positive heal that executes an incompatible or ambiguous element;
- bypass of confidence, margin, semantic identity, uniqueness, revalidation, or execution-risk
  policy;
- execution of a replacement for a `proposal-only` target;
- evidence, proposal, policy, or summary tampering that is accepted as valid;
- any path that silently rewrites test source or the locator registry;
- sensitive values, raw secrets, unsafe URLs, or private absolute paths leaking into artifacts;
- unsafe candidate execution after audit or screenshot capture failed;
- malformed or conflicting inputs being accepted when they should fail closed.

Ordinary locator failures, unsupported candidate patterns, and intentionally conservative rejected
heals are usually correctness issues rather than vulnerabilities unless they enable one of the
unsafe outcomes above.

## Disclosure expectations

Please allow reasonable time to reproduce, test, and release a fix before public disclosure. A fix
should include a regression test and should not weaken another safety gate to make the reproduction
pass.
