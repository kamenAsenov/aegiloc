# Known risks

Aegiloc v1.1 is an evaluation release with a stable API. Conservative design reduces some
locator-recovery risks; it does not remove the need for test ownership or product review.

## False-positive execution

The highest-impact risk is executing the wrong compatible element. Aegiloc mitigates this with
missing-locator proof, action filtering, mandatory semantic gates, confidence, runner-up margin,
per-target execution risk, immediate revalidation, and uniqueness. These controls are not a formal
proof of user intent. Sensitive or irreversible operations should remain `proposal-only` or outside
automatic healing.

`uncheck` is particularly sensitive when it removes consent, terms acceptance, permissions,
subscriptions, or a safety control. `hover` can be consequential when it reveals the wrong menu or
changes the context of a later action. Treat new targets for these actions as `proposal-only` until
the exact control is reviewed as reversible and low impact.

## Fingerprint quality

A stale, vague, or incorrectly reviewed fingerprint can produce weak evidence. Geometry is
deliberately low weight, but misleading accessible labels and attributes can still affect ranking.
Registry changes require code review and domain context.

## Accessibility representation

Candidate identity depends on public Playwright accessibility behavior and the application DOM.
Custom widgets, unusual shadow DOM, incomplete names, and browser-specific accessibility trees can
lead to conservative rejection or unqualified behavior.

## Evidence sensitivity

JSONL history, accessible names, target keys, screenshot references, screenshots, traces, and static
reports can disclose application structure or test context. Screenshot masking is bounded and
cannot guarantee that every surrounding secret is hidden. Keep artifacts access-controlled,
short-lived, and reviewed before sharing.

## Evidence authenticity

Unsigned manifests detect change only when the manifest is obtained through a trusted channel.
Optional HMAC authentication proves shared-key possession, not which person or runner acted, and
does not provide non-repudiation. Key compromise allows forged manifests until rotation. A static
report is never itself a signed attestation.

## Platform scope

The full portfolio suite and realistic demo remain Chromium-first. A focused core matrix qualifies
Firefox and WebKit for the frozen Playwright version, not arbitrary versions, mobile engines, or
application widgets. The stable API policy does not broaden browser qualification.

## Performance budget scope

The 150-candidate median/p95 gate is a regression alarm on CI hardware, not a guarantee for every
DOM, browser, or machine. Pages with unusually many compatible controls can still make conservative
collection slow. Healing is exceptional-path behavior, not a substitute for stable primary
locators.

## Supply-chain attestations

Reproducible tarballs, SBOMs, dependency review, and GitHub attestations improve traceability but do
not prove absence of vulnerabilities or authorize publication. Attestations are produced only for
`main` workflow artifacts and remain distinct from npm packages, tags, and releases.

## Distribution identity

No Aegiloc npm package has been published. This repository is distributed as a GitHub source
release only. An exact-name availability check is not ownership or trademark clearance; any future
registry distribution requires a fresh ownership, namespace, provenance, and legal review.

## Generated report content

The static viewer escapes evidence strings, contains no remote assets, and validates summary/history
agreement. It remains a generated artifact opened under a browser's local trust context. Do not add
unreviewed scripts to generated output or serve evidence from a public directory.

## Operational interpretation

`PASSED_WITH_HEALING` is an exceptional result that needs review, not proof that a locator update is
safe forever. Governance budgets and waivers report operational policy; they cannot weaken runtime
safety.

Historical health rates, drift age, score ranges, and recent outcomes are computed only from retained
test evidence supplied to Aegiloc. They are not production telemetry, a field reliability study, or
evidence about systems and runs that were not observed.
