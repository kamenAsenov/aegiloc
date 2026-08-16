import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { Ajv2020 } from 'ajv/dist/2020.js';

import {
  RegistryValidationError,
  SUPPORTED_ARIA_ROLES,
  parseTargetRegistry,
} from '../src/index.js';

interface ParityCase {
  readonly name: string;
  readonly value: unknown;
  readonly valid: boolean;
}

interface RegistrySchemaShape {
  readonly $defs: {
    readonly ariaRole: {
      readonly enum: readonly string[];
    };
  };
}

const validTarget = {
  description: 'Place order button',
  primary: { type: 'role', role: 'button', name: 'Place order', exact: true },
  fingerprint: {
    accessibleRole: 'button',
    accessibleName: 'Place order',
    stableAttributes: { 'data-target': 'place-order' },
    visibleText: 'Place order',
    tag: 'button',
    ancestorText: ['Checkout'],
    neighborText: ['Store terms'],
    geometry: { x: 0.5, y: 0.75, width: 0.3, height: 0.08 },
  },
  policy: {
    allowedActions: ['click'],
    executionRisk: 'automatic',
    healing: {
      enabled: true,
      confidenceThreshold: 0.9,
      minimumScoreMargin: 0.15,
    },
  },
};

const validRegistry = {
  $schema: './targets.schema.json',
  version: 1,
  defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
  targets: { 'checkout.placeOrder': validTarget },
};

function runtimeAccepts(value: unknown): boolean {
  try {
    parseTargetRegistry(value);
    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(RegistryValidationError);
    return false;
  }
}

test('JSON Schema and runtime validator accept the checked-in registry', async () => {
  const [schemaSource, registrySource] = await Promise.all([
    readFile(new URL('../registry/targets.schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../registry/targets.json', import.meta.url), 'utf8'),
  ]);
  const schema = JSON.parse(schemaSource) as Record<string, unknown>;
  const registry = JSON.parse(registrySource) as unknown;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

  expect(validate(registry), JSON.stringify(validate.errors)).toBe(true);
  expect(runtimeAccepts(registry)).toBe(true);
});

test('schema ARIA roles remain identical to the runtime allowlist', async () => {
  const schemaSource = await readFile(
    new URL('../registry/targets.schema.json', import.meta.url),
    'utf8',
  );
  const schema = JSON.parse(schemaSource) as RegistrySchemaShape;

  expect(schema.$defs.ariaRole.enum).toEqual(SUPPORTED_ARIA_ROLES);
});

test('JSON Schema and runtime validation agree on safety-sensitive boundaries', async () => {
  const schemaSource = await readFile(
    new URL('../registry/targets.schema.json', import.meta.url),
    'utf8',
  );
  const schema = JSON.parse(schemaSource) as Record<string, unknown>;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const cases: readonly ParityCase[] = [
    { name: 'valid registry', value: validRegistry, valid: true },
    {
      name: 'valid registry without optional schema URI',
      value: {
        version: validRegistry.version,
        defaults: validRegistry.defaults,
        targets: validRegistry.targets,
      },
      valid: true,
    },
    {
      name: 'unknown root property',
      value: { ...validRegistry, unexpected: true },
      valid: false,
    },
    {
      name: 'whitespace schema URI',
      value: { ...validRegistry, $schema: '   ' },
      valid: false,
    },
    { name: 'unsupported version', value: { ...validRegistry, version: 2 }, valid: false },
    {
      name: 'out-of-range default',
      value: {
        ...validRegistry,
        defaults: { confidenceThreshold: 1.01, minimumScoreMargin: 0.15 },
      },
      valid: false,
    },
    { name: 'empty target map', value: { ...validRegistry, targets: {} }, valid: false },
    {
      name: 'whitespace target key',
      value: { ...validRegistry, targets: { '   ': validTarget } },
      valid: false,
    },
    {
      name: 'whitespace description',
      value: {
        ...validRegistry,
        targets: { target: { ...validTarget, description: '   ' } },
      },
      valid: false,
    },
    {
      name: 'unsupported primary role',
      value: {
        ...validRegistry,
        targets: {
          target: {
            ...validTarget,
            primary: { type: 'role', role: 'definitely-not-an-aria-role' },
          },
        },
      },
      valid: false,
    },
    {
      name: 'unsupported fingerprint role',
      value: {
        ...validRegistry,
        targets: {
          target: {
            ...validTarget,
            fingerprint: {
              ...validTarget.fingerprint,
              accessibleRole: 'definitely-not-an-aria-role',
            },
          },
        },
      },
      valid: false,
    },
    {
      name: 'whitespace stable attribute name',
      value: {
        ...validRegistry,
        targets: {
          target: {
            ...validTarget,
            fingerprint: { ...validTarget.fingerprint, stableAttributes: { '   ': 'value' } },
          },
        },
      },
      valid: false,
    },
    {
      name: 'incomplete geometry',
      value: {
        ...validRegistry,
        targets: {
          target: {
            ...validTarget,
            fingerprint: {
              ...validTarget.fingerprint,
              geometry: { x: 0.5, y: 0.5, width: 0.2 },
            },
          },
        },
      },
      valid: false,
    },
    {
      name: 'duplicate allowed action',
      value: {
        ...validRegistry,
        targets: {
          target: {
            ...validTarget,
            policy: { ...validTarget.policy, allowedActions: ['click', 'click'] },
          },
        },
      },
      valid: false,
    },
    {
      name: 'unsupported execution risk',
      value: {
        ...validRegistry,
        targets: {
          target: {
            ...validTarget,
            policy: { ...validTarget.policy, executionRisk: 'business-critical' },
          },
        },
      },
      valid: false,
    },
    {
      name: 'legacy v0.3 policy without execution risk',
      value: {
        ...validRegistry,
        targets: {
          target: {
            ...validTarget,
            policy: {
              allowedActions: validTarget.policy.allowedActions,
              healing: validTarget.policy.healing,
            },
          },
        },
      },
      valid: true,
    },
    {
      name: 'unknown target property',
      value: {
        ...validRegistry,
        targets: { target: { ...validTarget, hiddenOverride: true } },
      },
      valid: false,
    },
  ];

  for (const parityCase of cases) {
    const schemaAccepted = validate(parityCase.value);
    const runtimeAccepted = runtimeAccepts(parityCase.value);

    expect(
      { schemaAccepted, runtimeAccepted },
      `${parityCase.name}: ${JSON.stringify(validate.errors)}`,
    ).toEqual({ schemaAccepted: parityCase.valid, runtimeAccepted: parityCase.valid });
  }
});
