import { readFile } from 'node:fs/promises';

import { RegistryValidationError } from './errors.js';
import {
  TARGET_ACTIONS,
  EXECUTION_RISKS,
  type AriaRole,
  type PrimaryLocatorDefinition,
  type TargetAction,
  type ExecutionRisk,
  type TargetDefinition,
  type TargetContextDefinition,
  type TargetFingerprint,
  type TargetPolicy,
  type TargetRegistry,
} from './types.js';

export const SUPPORTED_ARIA_ROLES = [
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'meter',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
] as const satisfies readonly AriaRole[];

const ARIA_ROLES = new Set<string>(SUPPORTED_ARIA_ROLES);

const TARGET_ACTION_SET = new Set<string>(TARGET_ACTIONS);
const EXECUTION_RISK_SET = new Set<string>(EXECUTION_RISKS);

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RegistryValidationError(path, 'expected an object');
  }

  return value as Record<string, unknown>;
}

function expectOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpectedKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpectedKey !== undefined) {
    throw new RegistryValidationError(`${path}.${unexpectedKey}`, 'unexpected property');
  }
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RegistryValidationError(path, 'expected a non-empty string');
  }

  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RegistryValidationError(path, 'expected a boolean');
  }

  return value;
}

function expectProbability(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RegistryValidationError(path, 'expected a finite number between 0 and 1');
  }

  return value;
}

function expectOptionalExact(value: Record<string, unknown>, path: string): boolean | undefined {
  return value.exact === undefined ? undefined : expectBoolean(value.exact, `${path}.exact`);
}

function expectRole(value: unknown, path: string): AriaRole {
  const role = expectString(value, path);
  if (!ARIA_ROLES.has(role)) {
    throw new RegistryValidationError(path, `unsupported ARIA role "${role}"`);
  }

  return role as AriaRole;
}

function parsePrimaryLocator(value: unknown, path: string): PrimaryLocatorDefinition {
  const locator = expectRecord(value, path);
  const type = expectString(locator.type, `${path}.type`);

  switch (type) {
    case 'role': {
      expectOnlyKeys(locator, ['type', 'role', 'name', 'exact'], path);
      const role = expectRole(locator.role, `${path}.role`);
      const name =
        locator.name === undefined ? undefined : expectString(locator.name, `${path}.name`);
      const exact = expectOptionalExact(locator, path);
      return {
        type,
        role,
        ...(name === undefined ? {} : { name }),
        ...(exact === undefined ? {} : { exact }),
      };
    }
    case 'label':
    case 'text':
    case 'placeholder':
    case 'title':
    case 'altText': {
      expectOnlyKeys(locator, ['type', 'value', 'exact'], path);
      const exact = expectOptionalExact(locator, path);
      return {
        type,
        value: expectString(locator.value, `${path}.value`),
        ...(exact === undefined ? {} : { exact }),
      };
    }
    case 'testId':
    case 'css':
      expectOnlyKeys(locator, ['type', 'value'], path);
      return { type, value: expectString(locator.value, `${path}.value`) };
    default:
      throw new RegistryValidationError(`${path}.type`, `unsupported locator type "${type}"`);
  }
}

function parseContext(value: unknown, path: string): TargetContextDefinition {
  const context = expectRecord(value, path);
  expectOnlyKeys(context, ['pathname', 'frame', 'container'], path);

  const pathname =
    context.pathname === undefined ? undefined : expectString(context.pathname, `${path}.pathname`);
  if (
    pathname !== undefined &&
    (!pathname.startsWith('/') || pathname.includes('?') || pathname.includes('#'))
  ) {
    throw new RegistryValidationError(
      `${path}.pathname`,
      'expected an exact pathname beginning with / and without query or fragment',
    );
  }
  const frame =
    context.frame === undefined ? undefined : parsePrimaryLocator(context.frame, `${path}.frame`);
  const container =
    context.container === undefined
      ? undefined
      : parsePrimaryLocator(context.container, `${path}.container`);
  if (pathname === undefined && frame === undefined && container === undefined) {
    throw new RegistryValidationError(path, 'expected at least one context constraint');
  }

  return {
    ...(pathname === undefined ? {} : { pathname }),
    ...(frame === undefined ? {} : { frame }),
    ...(container === undefined ? {} : { container }),
  };
}

function expectStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new RegistryValidationError(path, 'expected an array');
  }

  return value.map((entry, index) => expectString(entry, `${path}[${index}]`));
}

function parseFingerprint(value: unknown, path: string): TargetFingerprint {
  const fingerprint = expectRecord(value, path);
  expectOnlyKeys(
    fingerprint,
    [
      'accessibleRole',
      'accessibleName',
      'stableAttributes',
      'visibleText',
      'tag',
      'ancestorText',
      'neighborText',
      'geometry',
    ],
    path,
  );

  if (fingerprint.accessibleRole !== undefined) {
    expectRole(fingerprint.accessibleRole, `${path}.accessibleRole`);
  }
  for (const key of ['accessibleName', 'visibleText', 'tag'] as const) {
    if (fingerprint[key] !== undefined) {
      expectString(fingerprint[key], `${path}.${key}`);
    }
  }
  for (const key of ['ancestorText', 'neighborText'] as const) {
    if (fingerprint[key] !== undefined) {
      expectStringArray(fingerprint[key], `${path}.${key}`);
    }
  }
  if (fingerprint.stableAttributes !== undefined) {
    const attributes = expectRecord(fingerprint.stableAttributes, `${path}.stableAttributes`);
    for (const [name, attributeValue] of Object.entries(attributes)) {
      expectString(name, `${path}.stableAttributes key`);
      expectString(attributeValue, `${path}.stableAttributes.${name}`);
    }
  }
  if (fingerprint.geometry !== undefined) {
    const geometry = expectRecord(fingerprint.geometry, `${path}.geometry`);
    expectOnlyKeys(geometry, ['x', 'y', 'width', 'height'], `${path}.geometry`);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expectProbability(geometry[key], `${path}.geometry.${key}`);
    }
  }

  return fingerprint;
}

function parsePolicy(value: unknown, path: string): TargetPolicy {
  const policy = expectRecord(value, path);
  expectOnlyKeys(policy, ['allowedActions', 'executionRisk', 'healing'], path);

  const actionValues = expectStringArray(policy.allowedActions, `${path}.allowedActions`);
  if (actionValues.length === 0) {
    throw new RegistryValidationError(`${path}.allowedActions`, 'expected at least one action');
  }

  const actions = actionValues.map((action, index) => {
    if (!TARGET_ACTION_SET.has(action)) {
      throw new RegistryValidationError(
        `${path}.allowedActions[${index}]`,
        `unsupported action "${action}"`,
      );
    }
    return action as TargetAction;
  });
  if (new Set(actions).size !== actions.length) {
    throw new RegistryValidationError(`${path}.allowedActions`, 'actions must be unique');
  }

  const healing = expectRecord(policy.healing, `${path}.healing`);
  expectOnlyKeys(
    healing,
    ['enabled', 'confidenceThreshold', 'minimumScoreMargin'],
    `${path}.healing`,
  );

  let executionRisk: ExecutionRisk | undefined;
  if (policy.executionRisk !== undefined) {
    const value = expectString(policy.executionRisk, `${path}.executionRisk`);
    if (!EXECUTION_RISK_SET.has(value)) {
      throw new RegistryValidationError(
        `${path}.executionRisk`,
        `unsupported execution risk "${value}"`,
      );
    }
    executionRisk = value as ExecutionRisk;
  }

  return {
    allowedActions: actions,
    ...(executionRisk === undefined ? {} : { executionRisk }),
    healing: {
      enabled: expectBoolean(healing.enabled, `${path}.healing.enabled`),
      confidenceThreshold: expectProbability(
        healing.confidenceThreshold,
        `${path}.healing.confidenceThreshold`,
      ),
      minimumScoreMargin: expectProbability(
        healing.minimumScoreMargin,
        `${path}.healing.minimumScoreMargin`,
      ),
    },
  };
}

function parseTarget(value: unknown, path: string): TargetDefinition {
  const target = expectRecord(value, path);
  expectOnlyKeys(target, ['description', 'context', 'primary', 'fingerprint', 'policy'], path);

  return {
    description: expectString(target.description, `${path}.description`),
    ...(target.context === undefined
      ? {}
      : { context: parseContext(target.context, `${path}.context`) }),
    primary: parsePrimaryLocator(target.primary, `${path}.primary`),
    fingerprint: parseFingerprint(target.fingerprint, `${path}.fingerprint`),
    policy: parsePolicy(target.policy, `${path}.policy`),
  };
}

export function parseTargetRegistry(value: unknown): TargetRegistry {
  const registry = expectRecord(value, '$');
  expectOnlyKeys(registry, ['$schema', 'version', 'defaults', 'targets'], '$');

  if (registry.$schema !== undefined) {
    expectString(registry.$schema, '$.$schema');
  }
  if (registry.version !== 1) {
    throw new RegistryValidationError('$.version', 'only registry version 1 is supported');
  }

  const defaults = expectRecord(registry.defaults, '$.defaults');
  expectOnlyKeys(
    defaults,
    ['confidenceThreshold', 'minimumScoreMargin', 'testIdAttribute'],
    '$.defaults',
  );
  const testIdAttribute =
    defaults.testIdAttribute === undefined
      ? undefined
      : expectString(defaults.testIdAttribute, '$.defaults.testIdAttribute');
  if (testIdAttribute !== undefined && !/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(testIdAttribute)) {
    throw new RegistryValidationError(
      '$.defaults.testIdAttribute',
      'expected a valid HTML attribute name',
    );
  }

  const rawTargets = expectRecord(registry.targets, '$.targets');
  if (Object.keys(rawTargets).length === 0) {
    throw new RegistryValidationError('$.targets', 'expected at least one target');
  }

  const targets = Object.fromEntries(
    Object.entries(rawTargets).map(([key, target]) => {
      expectString(key, '$.targets key');
      return [key, parseTarget(target, `$.targets.${key}`)];
    }),
  );

  return {
    version: 1,
    defaults: {
      confidenceThreshold: expectProbability(
        defaults.confidenceThreshold,
        '$.defaults.confidenceThreshold',
      ),
      minimumScoreMargin: expectProbability(
        defaults.minimumScoreMargin,
        '$.defaults.minimumScoreMargin',
      ),
      ...(testIdAttribute === undefined ? {} : { testIdAttribute }),
    },
    targets,
  };
}

export async function loadTargetRegistry(filePath: string | URL): Promise<TargetRegistry> {
  const contents = await readFile(filePath, 'utf8');
  let value: unknown;

  try {
    value = JSON.parse(contents) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse error';
    throw new RegistryValidationError('$', message);
  }

  return parseTargetRegistry(value);
}
