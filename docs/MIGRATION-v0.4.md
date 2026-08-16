# Migrating from v0.3.x to v0.4.0

v0.4 is additive for existing registry and evidence files, with one deliberate safety change in the
checked-in example registry.

## Registry execution risk

Add `policy.executionRisk` to every target:

```json
"executionRisk": "automatic"
```

Use `proposal-only` for actions that must never be redirected automatically. Missing values retain
the v0.3-compatible `automatic` behavior so existing registries do not silently stop working. The
checked-in `checkout.placeOrder` target now declares `proposal-only`; its primary locator still runs
normally, but locator drift produces evidence and preserves the original failure instead of healing.

## Evidence compatibility

v0.3 audit schema version `1` remains accepted. New events add execution policy and operation index
fields. Legacy events without explicit semantic eligibility remain excluded from locator proposals,
as in v0.3.1. Legacy retries are deduplicated conservatively; see the policy reference for the exact
fallback identity.

## CI adoption

Keep the reporter and canonical evidence verification, then add:

```bash
pnpm governance:evaluate
```

Start from [`policy.minimal.json`](../examples/governance/policy.minimal.json), set reviewed limits,
and commit the policy. Upload `health-summary.json` and `health-summary.md` as normal CI artifacts.
The evaluator has no GitHub dependency and can run unchanged in other CI systems.

Review a deliberately failing configuration in
[`policy.failing.json`](../examples/governance/policy.failing.json). Never use a waiver to compensate
for a runtime safety failure; the evaluator will not allow it.
