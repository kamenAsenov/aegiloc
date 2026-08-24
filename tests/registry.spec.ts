import { expect, test } from '@playwright/test';

import {
  RegistryValidationError,
  loadTargetRegistry,
  parseTargetRegistry,
  resolveExecutionRisk,
} from '../src/index.js';

test('loads and validates every supported primary locator type', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const locatorTypes = Object.values(registry.targets).map((target) => target.primary.type);

  expect(registry.version).toBe(1);
  expect(new Set(locatorTypes)).toEqual(new Set(['role', 'label', 'testId', 'text', 'css']));
});

test('uses explicit v0.4 risk and automatic compatibility for v0.3 registries', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const placeOrder = registry.targets['checkout.placeOrder'];
  const applyDiscount = registry.targets['checkout.applyDiscount'];
  expect(placeOrder).toBeDefined();
  expect(applyDiscount).toBeDefined();
  if (placeOrder === undefined || applyDiscount === undefined) return;

  expect(resolveExecutionRisk(placeOrder.policy)).toBe('proposal-only');
  expect(resolveExecutionRisk(applyDiscount.policy)).toBe('automatic');
  expect(
    resolveExecutionRisk({
      allowedActions: ['click'],
      healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
    }),
  ).toBe('automatic');
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

test('accepts v1.1 context, test-id attribute, locator, and action extensions', () => {
  const registry = parseTargetRegistry({
    version: 1,
    defaults: {
      confidenceThreshold: 0.9,
      minimumScoreMargin: 0.15,
      testIdAttribute: 'data-qa-id',
    },
    targets: {
      'checkout.email': {
        description: 'Checkout email field',
        context: {
          pathname: '/checkout',
          frame: { type: 'title', value: 'Payment frame', exact: true },
          container: { type: 'css', value: '[data-area="payment"]' },
        },
        primary: { type: 'placeholder', value: 'Email', exact: true },
        fingerprint: { accessibleRole: 'textbox', accessibleName: 'Email', tag: 'input' },
        policy: {
          allowedActions: ['fill', 'focus'],
          healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
        },
      },
      'checkout.newsletter': {
        description: 'Newsletter checkbox',
        primary: { type: 'testId', value: 'newsletter' },
        fingerprint: { accessibleRole: 'checkbox', tag: 'input' },
        policy: {
          allowedActions: ['uncheck', 'hover'],
          healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
        },
      },
    },
  });

  expect(registry.defaults.testIdAttribute).toBe('data-qa-id');
  expect(registry.targets['checkout.email']?.context?.pathname).toBe('/checkout');
});

test('rejects empty, malformed, and query-bearing target contexts', () => {
  const base = {
    version: 1,
    defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
    targets: {
      target: {
        description: 'Target',
        primary: { type: 'text', value: 'Target' },
        fingerprint: { accessibleRole: 'button' },
        policy: {
          allowedActions: ['click'],
          healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
        },
      },
    },
  };

  expect(() =>
    parseTargetRegistry({
      ...base,
      targets: { target: { ...base.targets.target, context: {} } },
    }),
  ).toThrow('expected at least one context constraint');
  expect(() =>
    parseTargetRegistry({
      ...base,
      targets: {
        target: { ...base.targets.target, context: { pathname: '/checkout?unsafe=true' } },
      },
    }),
  ).toThrow('without query or fragment');
  expect(() =>
    parseTargetRegistry({
      ...base,
      defaults: { ...base.defaults, testIdAttribute: 'data test' },
    }),
  ).toThrow('valid HTML attribute name');
});
