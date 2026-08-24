# Adoption guide

## When to use Aegiloc

Use Aegiloc when a small set of reviewed Playwright actions has meaningful semantic identity,
locator-only drift is a recurring maintenance cost, and the team can retain and review exceptional
pass evidence. Start in `observe`, then use `guarded` only for reversible, low-risk actions with a
strong fingerprint.

Do not use it to make a generally flaky suite appear green. Read [when not to use
Aegiloc](WHEN-NOT-TO-USE.md) before enabling execution.

## Minimal integration

Keep target definitions in a version-controlled JSON registry. The basic shape is:

```json
{
  "version": 1,
  "defaults": { "confidenceThreshold": 0.9, "minimumScoreMargin": 0.15 },
  "targets": {
    "checkout.applyDiscount": {
      "description": "Apply a discount during checkout",
      "primary": { "type": "text", "value": "Apply discount", "exact": true },
      "fingerprint": {
        "accessibleRole": "button",
        "accessibleName": "Apply discount",
        "visibleText": "Apply discount",
        "tag": "button",
        "ancestorText": ["Order summary"]
      },
      "policy": {
        "allowedActions": ["click"],
        "executionRisk": "automatic",
        "healing": {
          "enabled": true,
          "confidenceThreshold": 0.92,
          "minimumScoreMargin": 0.18
        }
      }
    }
  }
}
```

Load it once and keep the wrapper explicit in the test:

```ts
import { createHealer, loadTargetRegistry } from 'aegiloc';

const registry = await loadTargetRegistry('aegiloc.targets.json');
const healer = createHealer({ page, registry, mode: 'guarded' });

await healer.target('checkout.applyDiscount').click();
```

See the runnable [`examples/basic-playwright`](../examples/basic-playwright) project for reporter and
artifact configuration using only public package APIs.

## Fixtures and Page Objects

Use the typed fixture to create one healer per Playwright `Page`. Page Objects should own semantic
target keys, not private selectors that bypass the registry:

```ts
import { createAegilocTest, type Healer } from 'aegiloc';
import registry from '../aegiloc.targets.json' with { type: 'json' };

export const test = createAegilocTest({
  registry,
  mode: 'observe',
  runId: (testInfo) => process.env.GITHUB_RUN_ID ?? testInfo.testId,
});

export class CheckoutPage {
  public constructor(private readonly healer: Healer<keyof typeof registry.targets>) {}

  public async applyDiscount(): Promise<void> {
    await this.healer.target('checkout.applyDiscount').click();
  }
}
```

Keep assertions as normal Playwright assertions. Never wrap an expected result in healing logic.
Move reviewed reversible targets from `observe` to `guarded` only after inspecting candidate and
ambiguity evidence.

## Scope repeated targets explicitly

When the same semantic control can appear on multiple routes, in frames, or in repeated cards,
declare exact context in the registry. A context mismatch fails before candidate discovery.

```json
{
  "context": {
    "pathname": "/checkout",
    "container": {
      "type": "role",
      "role": "region",
      "name": "Order summary",
      "exact": true
    }
  }
}
```

## Choose execution risk explicitly

Use `automatic` only when all of these are true:

- the action is reversible and low impact;
- the registered semantic identity is strong and reviewed;
- a wrong interaction cannot commit money, permissions, deletion, identity, or external side effects;
- the team reviews `PASSED_WITH_HEALING` and keeps evidence.

Use `proposal-only` for checkout submission, destructive actions, permission changes, messages,
authentication, or any action where a plausible wrong target has material consequences. It still
collects reviewable evidence but blocks automatic execution.

For new `uncheck` targets, `proposal-only` is the default recommendation—particularly for consent,
terms, permissions, subscriptions, and destructive controls. Start `hover` targets in `observe` or
`proposal-only`; a wrong hover can reveal a different menu or alter the context for a later action.
Move either to `automatic` only after reviewing that exact target as reversible and low impact. This
guidance does not change the parser's compatibility default for older registries, so declare
`executionRisk` explicitly.

## Review a healed pass

1. Treat `PASSED_WITH_HEALING` as exceptional, not as an ordinary green test.
2. Open the report and confirm the primary locator was genuinely absent.
3. Compare the winning and runner-up candidates, semantic gates, confidence, and margin.
4. Inspect the before/after screenshots and ordinary Playwright trace where retained.
5. Generate a proposal only after independent agreeing observations.
6. Review any registry edit as source code. Aegiloc never applies it automatically.

```bash
pnpm proposal:generate
pnpm proposal:verify
pnpm fingerprint:propose
```

Fingerprint observations are a separate opt-in review loop. They are recorded only after successful
primary actions and can propose a fingerprint update after independent-run consensus; they never
learn from a failed or healed action.

## CI and evidence handling

Use the Aegiloc reporter with the ordinary Playwright reporters. Retain canonical history,
summary, manifest, health summary, screenshots, and traces according to your data policy. These may
contain target names, accessible text, selectors, paths, commit identifiers, and application state.
Health and viewer metrics are history-derived indicators from the retained test runs supplied to
Aegiloc. They are not production telemetry and do not establish reliability in client systems.

Recommended CI order:

1. run Playwright and aggregate reporter attachments;
2. verify canonical evidence;
3. create and verify the integrity manifest;
4. evaluate governance budgets;
5. upload access-controlled artifacts with short retention;
6. review healed passes before accepting a locator proposal.

An unsigned manifest detects changes only when obtained through a trusted channel. Optional HMAC
authentication proves shared-key possession, not individual signer identity or non-repudiation. See
[evidence integrity](EVIDENCE-INTEGRITY.md) and [known risks](KNOWN-RISKS.md).
