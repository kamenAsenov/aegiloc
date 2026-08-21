# Adoption guide

## When to use Healwright

Use Healwright when a small set of reviewed Playwright actions has meaningful semantic identity,
locator-only drift is a recurring maintenance cost, and the team can retain and review exceptional
pass evidence. Start in `observe`, then use `guarded` only for reversible, low-risk actions with a
strong fingerprint.

Do not use it to make a generally flaky suite appear green. Read [when not to use
Healwright](WHEN-NOT-TO-USE.md) before enabling execution.

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
import { createHealer, loadTargetRegistry } from 'healwright';

const registry = await loadTargetRegistry('healwright.targets.json');
const healer = createHealer({ page, registry, mode: 'guarded' });

await healer.target('checkout.applyDiscount').click();
```

See the runnable [`examples/basic-playwright`](../examples/basic-playwright) project for reporter and
artifact configuration using only public package APIs.

## Fixtures and Page Objects

Create one healer per Playwright `Page` and expose it through a fixture. Page Objects should own
semantic target keys, not private selectors that bypass the registry:

```ts
import { test as base } from '@playwright/test';
import { createHealer, type Healer } from 'healwright';
import registry from '../healwright.targets.json' with { type: 'json' };

export const test = base.extend<{ healer: Healer<typeof registry> }>({
  healer: async ({ page }, use) => {
    await use(createHealer({ page, registry, mode: 'guarded' }));
  },
});

export class CheckoutPage {
  public constructor(private readonly healer: Healer<typeof registry>) {}

  public async applyDiscount(): Promise<void> {
    await this.healer.target('checkout.applyDiscount').click();
  }
}
```

Keep assertions as normal Playwright assertions. Never wrap an expected result in healing logic.

## Choose execution risk explicitly

Use `automatic` only when all of these are true:

- the action is reversible and low impact;
- the registered semantic identity is strong and reviewed;
- a wrong interaction cannot commit money, permissions, deletion, identity, or external side effects;
- the team reviews `PASSED_WITH_HEALING` and keeps evidence.

Use `proposal-only` for checkout submission, destructive actions, permission changes, messages,
authentication, or any action where a plausible wrong target has material consequences. It still
collects reviewable evidence but blocks automatic execution.

## Review a healed pass

1. Treat `PASSED_WITH_HEALING` as exceptional, not as an ordinary green test.
2. Open the report and confirm the primary locator was genuinely absent.
3. Compare the winning and runner-up candidates, semantic gates, confidence, and margin.
4. Inspect the before/after screenshots and ordinary Playwright trace where retained.
5. Generate a proposal only after independent agreeing observations.
6. Review any registry edit as source code. Healwright never applies it automatically.

```bash
pnpm proposal:generate
pnpm proposal:verify
```

## CI and evidence handling

Use the Healwright reporter with the ordinary Playwright reporters. Retain canonical history,
summary, manifest, health summary, screenshots, and traces according to your data policy. These may
contain target names, accessible text, selectors, paths, commit identifiers, and application state.

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
