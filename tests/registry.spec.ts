import { expect, test } from '@playwright/test';

import { RegistryValidationError, loadTargetRegistry, parseTargetRegistry } from '../src/index.js';

test('loads and validates every supported primary locator type', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const locatorTypes = Object.values(registry.targets).map((target) => target.primary.type);

  expect(registry.version).toBe(1);
  expect(new Set(locatorTypes)).toEqual(new Set(['role', 'label', 'testId', 'text', 'css']));
});

test('rejects unsafe confidence values', () => {
  expect(() =>
    parseTargetRegistry({
      version: 1,
      defaults: { confidenceThreshold: 1.01, minimumScoreMargin: 0.15 },
      targets: {
        'checkout.placeOrder': {
          description: 'Place order button',
          primary: { type: 'role', role: 'button', name: 'Place order' },
          fingerprint: { accessibleRole: 'button' },
          policy: {
            allowedActions: ['click'],
            healing: {
              enabled: true,
              confidenceThreshold: 0.95,
              minimumScoreMargin: 0.2,
            },
          },
        },
      },
    }),
  ).toThrow(RegistryValidationError);
});
