import { expect, test } from '@playwright/test';

import { RegistryValidationError, parseTargetRegistry } from '../src/index.js';

const validTarget = {
  description: 'Submit checkout',
  primary: { type: 'role', role: 'button', name: 'Submit', exact: true },
  fingerprint: {
    accessibleRole: 'button',
    accessibleName: 'Submit',
    tag: 'button',
  },
  policy: {
    allowedActions: ['click'],
    healing: {
      enabled: true,
      confidenceThreshold: 0.9,
      minimumScoreMargin: 0.15,
    },
  },
};

function registryWithTarget(target: unknown = validTarget): unknown {
  return {
    version: 1,
    defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
    targets: { target },
  };
}

test('accepts every supported primary locator shape', () => {
  const primaryLocators = [
    { type: 'role', role: 'button', name: 'Submit', exact: true },
    { type: 'label', value: 'Email', exact: false },
    { type: 'testId', value: 'submit' },
    { type: 'text', value: 'Submit', exact: true },
    { type: 'css', value: '#submit' },
  ];

  for (const primary of primaryLocators) {
    const parsed = parseTargetRegistry(registryWithTarget({ ...validTarget, primary }));
    expect(parsed.targets.target?.primary).toEqual(primary);
  }
});

test('rejects a null registry root with a precise path', () => {
  expect(() => parseTargetRegistry(null)).toThrow(
    new RegistryValidationError('$', 'expected an object'),
  );
});

test('rejects an array registry root', () => {
  expect(() => parseTargetRegistry([])).toThrow('Invalid target registry at $: expected an object');
});

test('rejects unsupported registry versions', () => {
  expect(() =>
    parseTargetRegistry({
      ...(registryWithTarget() as Record<string, unknown>),
      version: 2,
    }),
  ).toThrow('Invalid target registry at $.version: only registry version 1 is supported');
});

test('rejects unexpected root properties', () => {
  expect(() =>
    parseTargetRegistry({
      ...(registryWithTarget() as Record<string, unknown>),
      autoRewrite: true,
    }),
  ).toThrow('Invalid target registry at $.autoRewrite: unexpected property');
});

test('rejects an empty target map', () => {
  expect(() =>
    parseTargetRegistry({
      ...(registryWithTarget() as Record<string, unknown>),
      targets: {},
    }),
  ).toThrow('Invalid target registry at $.targets: expected at least one target');
});

test('rejects whitespace-only semantic target keys', () => {
  expect(() =>
    parseTargetRegistry({
      ...(registryWithTarget() as Record<string, unknown>),
      targets: { '   ': validTarget },
    }),
  ).toThrow('Invalid target registry at $.targets key: expected a non-empty string');
});

test('rejects unsupported ARIA roles in primary locators', () => {
  expect(() =>
    parseTargetRegistry(
      registryWithTarget({
        ...validTarget,
        primary: { type: 'role', role: 'magic-button', name: 'Submit' },
      }),
    ),
  ).toThrow(
    'Invalid target registry at $.targets.target.primary.role: unsupported ARIA role "magic-button"',
  );
});

test('rejects incomplete normalized geometry', () => {
  expect(() =>
    parseTargetRegistry(
      registryWithTarget({
        ...validTarget,
        fingerprint: {
          ...validTarget.fingerprint,
          geometry: { x: 0.5, y: 0.5, width: 0.2 },
        },
      }),
    ),
  ).toThrow(
    'Invalid target registry at $.targets.target.fingerprint.geometry.height: expected a finite number between 0 and 1',
  );
});

test('rejects duplicate and unsupported allowed actions', () => {
  const invalidActions = [
    ['click', 'click'],
    ['click', 'assert'],
  ];

  for (const allowedActions of invalidActions) {
    expect(() =>
      parseTargetRegistry(
        registryWithTarget({
          ...validTarget,
          policy: { ...validTarget.policy, allowedActions },
        }),
      ),
    ).toThrow(RegistryValidationError);
  }
});
