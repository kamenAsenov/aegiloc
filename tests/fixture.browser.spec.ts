import { expect } from '@playwright/test';

import {
  AUDIT_ATTACHMENT_PREFIX,
  PASSED_WITH_HEALING,
  createAegilocTest,
  type TargetRegistry,
} from '../src/index.js';

const registry = {
  version: 1,
  defaults: { confidenceThreshold: 0.8, minimumScoreMargin: 0.15 },
  targets: {
    'checkout.applyDiscount': {
      description: 'Apply discount',
      primary: { type: 'testId', value: 'old-discount' },
      fingerprint: {
        accessibleRole: 'button',
        accessibleName: 'Apply discount',
        visibleText: 'Apply discount',
        tag: 'button',
      },
      policy: {
        allowedActions: ['click'],
        healing: { enabled: true, confidenceThreshold: 0.8, minimumScoreMargin: 0.15 },
      },
    },
  },
} as const satisfies TargetRegistry;

const test = createAegilocTest({
  registry,
  runId: 'fixture-contract-run',
  primaryActionTimeoutMs: 300,
});

test('provides a typed healer with Playwright-native evidence attachments', async ({
  page,
  healer,
}, testInfo) => {
  await page.setContent('<button>Apply discount</button>');

  await healer.target('checkout.applyDiscount').click();

  expect(
    testInfo.attachments.some((attachment) => attachment.name.startsWith(AUDIT_ATTACHMENT_PREFIX)),
  ).toBe(true);
  expect(
    testInfo.attachments.some((attachment) => attachment.name.startsWith(PASSED_WITH_HEALING)),
  ).toBe(true);
});
