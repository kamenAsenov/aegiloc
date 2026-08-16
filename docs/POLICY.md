# Governance policy reference

Healwright governance evaluates canonical audit evidence after a Playwright run. It does not
participate in candidate selection or runtime execution. A malformed supplied policy fails closed.

## Configuration

Policies use version `1` and are validated by both the runtime parser and
[`governance-policy.schema.json`](../registry/governance-policy.schema.json).

| Field                                                      | Meaning                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `failOnUnknownTargets`                                     | Fail when retained evidence references a target absent from the registry     |
| `limits.maxSuccessfulHealsPerRun`                          | Maximum unwaived successful heals for each run ID                            |
| `limits.maxRejectedAttemptsPerRun`                         | Maximum unwaived rejected or protected attempts for each run ID              |
| `limits.targets.<key>.maxSuccessfulHeals`                  | Maximum unwaived successful heals for one exact target                       |
| `limits.targets.<key>.actions.<action>.maxSuccessfulHeals` | Maximum for one exact target/action pair                                     |
| `baseline.successfulHeals`                                 | Fail if total unwaived successful heals grow above the baseline              |
| `baseline.rejectedAttempts`                                | Fail if total unwaived rejected/protected attempts grow above the baseline   |
| `waivers`                                                  | Temporary exact scopes that remove matching attempts from budget counts only |

All budgets are non-negative integers. Policy target/action references must exist in the supplied
registry and match its action allowlist.

## Waivers

```json
{
  "targetKey": "checkout.applyDiscount",
  "action": "click",
  "reason": "Reviewed migration through ticket QA-142",
  "expiresAt": "2026-08-31T23:59:59.000Z"
}
```

`targetKey`, `reason`, and `expiresAt` are mandatory. `action` is optional but exact. Expiry accepts
only valid UTC date-times ending in `Z`. Wildcards, empty reasons, duplicate scopes, and an overlap
between a target-wide and action-specific waiver are rejected. An expired waiver is itself a policy
failure and does not alter counts.

A waiver never changes runtime risk, drift classification, action allowlists, semantic eligibility,
confidence, margin, uniqueness, revalidation, evidence parsing, or proposal verification.

## Retry model

v0.4 audit events carry a per-target/action `operationIndex`. Attempts with the same run, project,
test, target, action, and operation index retain only the highest Playwright retry. For legacy v0.3
events without that index, the evaluator conservatively uses index zero; this prevents retries from
inflating counts but cannot distinguish repeated identical actions inside one legacy test.

## CLI

```bash
pnpm governance:evaluate -- --help
```

Exit `0` means pass, `1` means a valid policy failed, and `2` means an input was malformed,
conflicting, non-canonical, or unreadable. `--evaluated-at` makes expiry evaluation reproducible.
The JSON and Markdown outputs are written atomically and contain bounded identities and counts—not
ranked candidate content, page text, filled values, raw errors, or absolute artifact paths.
