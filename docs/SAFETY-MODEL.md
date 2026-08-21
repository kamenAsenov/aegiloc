# Safety model

Healwright is designed around one ordering principle: **a false-positive heal is worse than a failed
heal**. Locator recovery is therefore a narrow exception to ordinary Playwright behavior, not a
general retry mechanism.

## When healing may begin

The primary locator always runs first. Recovery begins only when all of these checks agree:

1. the normal Playwright action ended with a public `TimeoutError`;
2. a concurrent `locator.waitFor({ state: 'attached' })` never observed the target;
3. a post-failure `locator.count()` still returns zero.

If the element was attached at any point, or the failure is strictness, actionability, navigation,
page closure, or another non-timeout error, Healwright preserves the original Playwright failure.

## Conditions required for guarded execution

Every condition below is mandatory:

- the target exists in a strictly validated registry;
- the requested action is explicitly allowed;
- healing is enabled for the target;
- the primary failure proves genuine absence;
- a live candidate is compatible with the requested action;
- required accessible identity is present;
- known role and registered tag do not contradict the fingerprint;
- the top deterministic score meets the target confidence threshold;
- its lead over the second candidate meets the minimum margin;
- target execution risk is `automatic`;
- an immediate second collection chooses the same winner under the same gates;
- current execution risk is still `automatic`;
- the candidate resolves to exactly one accessible role/name/tag identity;
- the assessment audit event was written successfully;
- the pre-action screenshot was captured successfully.

Only then does Healwright apply the original requested action to the candidate. Actionability remains
Playwright's responsibility. A replacement action failure is recorded and propagated rather than
turned into a pass.

## Healing is forbidden for

- assertions and expected results;
- authentication or authorization;
- application business logic and genuine regressions;
- test-data creation or setup;
- API, backend, and network failures;
- delayed, disabled, hidden, detached, or ambiguous primary locators;
- semantically incompatible candidates;
- low-confidence or low-margin rankings;
- malformed registry, evidence, proposal, or policy input;
- `proposal-only` targets;
- failed audit or required screenshot writes.

The wrapper exposes actions, not assertions, which keeps expected outcomes outside the healing
surface.

## Why proposal-only exists

The risk of redirecting an action depends on business meaning, not just the Playwright method. Two
targets may both use `click` while only one is safe to recover automatically. The checked-in fixture
demonstrates this distinction:

- `checkout.applyDiscount` is `automatic`;
- `checkout.placeOrder` is `proposal-only`.

A proposal-only target still collects compatible candidates and records diagnostic evidence in
`observe`, `guarded`, or `strict-ci` workflows, but no replacement can execute. The policy is
recorded in audit events and checked again immediately before candidate resolution.

## Why scores cannot override semantics

Weighted similarity is useful for ordering compatible candidates, but arithmetic must not make an
incompatible element safe. Role, accessible identity, registered tag, and action compatibility are
mandatory gates evaluated separately from the score. Geometry has deliberately low weight and can
never rescue a semantic contradiction.

## Why there is no automatic source rewrite

A successful recovery is evidence that a reviewed locator may need updating; it is not permission
to change the repository. Healwright can generate a proposal containing provenance, score ranges,
margin, screenshot references, current-locator state, and an integrity hash. Its status is always
`review-required`.

No runtime or CLI path edits tests, application code, or `registry/targets.json`. A human reviews the
evidence and makes any change through the normal branch and pull-request process.

## Evidence privacy and integrity

Audit events omit raw error messages and action values such as filled text. Collected URL attributes
are reduced to paths, text is bounded, screenshot references are relative and validated, and common
text controls are masked during framework screenshots.

Typed reporter attachments are aggregated centrally and written atomically. Malformed attachments,
conflicting event IDs, attachment/body mismatches, non-canonical history, broken assessment/execution
chains, and inconsistent risk metadata fail closed.

Proposal hashes detect modification after generation. Evidence manifests additionally detect
file replacement, truncation, and reordering; optional HMAC authentication covers the manifest with
an external shared key. Unsigned manifests and compromised shared keys still require an external
artifact trust policy. See [`EVIDENCE-INTEGRITY.md`](EVIDENCE-INTEGRITY.md).

## Governance cannot weaken runtime safety

Governance is post-run accounting. Exact, expiring waivers can exclude matching attempts from budget
counts only. They cannot affect drift classification, action allowlists, execution risk, semantic
eligibility, scoring, margin, uniqueness, second-pass agreement, evidence parsing, or proposal
verification.

See [`POLICY.md`](POLICY.md) for the full waiver and budget contract and [`SECURITY.md`](../SECURITY.md)
for responsible reporting.
