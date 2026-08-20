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

## Evidence and generated report handling

Treat JSONL history, summaries, health output, screenshots, traces, Playwright reports, and static
Healwright viewers as potentially sensitive test artifacts. They can contain accessible names,
target keys, application structure, commit identifiers, and retained screenshot paths.

- keep generated output under ignored, access-controlled directories;
- use short retention appropriate to the tested environment;
- review screenshots, traces, and report pages before sharing;
- never serve a report directory publicly by default;
- do not add credentials, tokens, customer data, or real filled form values to demo evidence;
- delete the viewer when deleting its source evidence so a stale copy is not retained separately.

The v0.7 viewer escapes evidence strings and has no remote assets or scripts. That reduces rendering
risk but does not make the underlying evidence public-safe. Verify a trusted evidence manifest
before relying on the report; viewer generation alone does not authenticate origin.

## Evidence authentication keys

Authenticated manifests are optional. When enabled:

- generate at least 32 random bytes and store them in a secret manager;
- materialize a temporary owner-only regular file (`chmod 600`) only for the command invocation;
- never pass key bytes as CLI arguments or include the key file in artifacts;
- use a non-secret generation ID such as `ci-2026-q3`, not a hash or fragment of the key;
- rotate on a documented schedule and immediately after suspected disclosure;
- retain the retired verification key only until all evidence signed by it has expired;
- delete temporary key files even when a CI job fails.

HMAC authenticates shared-key possession, not an individual actor, and does not provide
non-repudiation. See the [evidence integrity guide](docs/EVIDENCE-INTEGRITY.md) for the exact rotation
and retention sequence.

## Disclosure expectations

Please allow reasonable time to reproduce, test, and release a fix before public disclosure. A fix
should include a regression test and should not weaken another safety gate to make the reproduction
pass.
