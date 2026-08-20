# Known risks

Healwright v0.6.0 is a technical preview intended for evaluation. Conservative design reduces some
locator-recovery risks; it does not remove the need for test ownership or product review.

## False-positive execution

The highest-impact risk is executing the wrong compatible element. Healwright mitigates this with
missing-locator proof, action filtering, mandatory semantic gates, confidence, runner-up margin,
per-target execution risk, immediate revalidation, and uniqueness. These controls are not a formal
proof of user intent. Sensitive or irreversible operations should remain `proposal-only` or outside
automatic healing.

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

Canonical ordering and proposal hashes detect several forms of local mismatch and tampering, but
v0.6 does not authenticate who or what produced the original evidence. Do not treat a report as a
signed attestation.

## Platform scope

Chromium is the only configured and qualified browser. Node and Playwright versions outside the
documented ranges are not covered. The API is pre-1.0 and can change with migration guidance.

## Generated report content

The static viewer escapes evidence strings, contains no remote assets, and validates summary/history
agreement. It remains a generated artifact opened under a browser's local trust context. Do not add
unreviewed scripts to generated output or serve evidence from a public directory.

## Operational interpretation

`PASSED_WITH_HEALING` is an exceptional result that needs review, not proof that a locator update is
safe forever. Governance budgets and waivers report operational policy; they cannot weaken runtime
safety.
