import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import fc from 'fast-check';

import {
  GovernanceEvidenceError,
  GovernancePolicyError,
  assessCandidates,
  createHealingAuditEvent,
  createHealingExecutionAuditEvent,
  evaluateGovernance,
  loadTargetRegistry,
  parseGovernancePolicy,
  rankCandidates,
  renderHealthSummary,
  type ExecutionRisk,
  type GovernancePolicy,
  type AegilocAuditEvent,
  type TargetAction,
} from '../src/index.js';

const evaluatedAt = '2026-08-16T12:00:00.000Z';
const provenance = (retry = 0, projectName = 'chromium', runId = 'run-1') => ({
  runId,
  testId: 'checkout-test',
  projectName,
  retry,
  commitSha: 'abcdef0123456789',
});

function policy(value: Omit<GovernancePolicy, 'version'> = {}): GovernancePolicy {
  return { version: 1, ...value };
}

function eventsFor({
  id,
  targetKey = 'checkout.applyDiscount',
  action = 'click',
  risk = 'automatic',
  outcome = 'successful',
  retry = 0,
  projectName = 'chromium',
  runId = 'run-1',
  operationIndex = 0,
}: {
  readonly id: string;
  readonly targetKey?: string;
  readonly action?: TargetAction;
  readonly risk?: ExecutionRisk;
  readonly outcome?: 'successful' | 'rejected' | 'failed' | 'observed' | 'protected';
  readonly retry?: number;
  readonly projectName?: string;
  readonly runId?: string;
  readonly operationIndex?: number;
}): readonly AegilocAuditEvent[] {
  const ranked = rankCandidates(
    { accessibleRole: 'button', accessibleName: 'Apply discount', tag: 'button' },
    [
      {
        id: `button:${id}`,
        role: 'button',
        accessibleName: 'Apply discount',
        tag: 'button',
        stableAttributes: {},
        visibleText: 'Apply discount',
        ancestorText: [],
        neighborText: [],
      },
    ],
    action,
  );
  const assessment = assessCandidates(ranked, {
    enabled: true,
    confidenceThreshold: 0.8,
    minimumScoreMargin: 0.1,
  });
  const assessmentEvent = createHealingAuditEvent({
    eventId: `assessment-${id}`,
    timestamp: `2026-08-16T10:${String(Number(id.replace(/\D/g, '')) % 60).padStart(2, '0')}:00.000Z`,
    provenance: provenance(retry, projectName, runId),
    operationIndex,
    mode: outcome === 'observed' ? 'observe' : 'guarded',
    modeDecision:
      outcome === 'observed'
        ? 'observed'
        : outcome === 'rejected' || outcome === 'protected'
          ? 'rejected'
          : 'eligible',
    targetKey,
    action,
    executionRisk: risk,
    primaryLocator: { type: 'text', value: 'Apply discount', exact: true },
    primaryError: new Error('not serialized'),
    collectionStatus: 'completed',
    assessment,
    rankedCandidates: ranked,
  });
  if (outcome === 'rejected' || outcome === 'observed' || outcome === 'protected') {
    return [assessmentEvent];
  }
  return [
    assessmentEvent,
    createHealingExecutionAuditEvent({
      eventId: `execution-${id}`,
      timestamp: `2026-08-16T11:${String(Number(id.replace(/\D/g, '')) % 60).padStart(2, '0')}:00.000Z`,
      provenance: provenance(retry, projectName, runId),
      operationIndex,
      parentEventId: assessmentEvent.eventId,
      targetKey,
      action,
      executionRisk: risk,
      candidateId: `button:${id}`,
      status: outcome === 'successful' ? 'succeeded' : 'failed',
      reason: outcome === 'successful' ? 'succeeded' : 'action-failed',
      screenshots: [],
    }),
  ];
}

test.beforeAll(async () => {
  await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
});

test('no policy preserves backward-compatible summary behavior, including empty evidence', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const summary = evaluateGovernance([], registry, undefined, { evaluatedAt });
  expect(summary).toMatchObject({
    policyConfigured: false,
    status: 'pass',
    totals: { attempts: 0, successfulHeals: 0, rejectedAttempts: 0 },
    groups: [],
  });
});

test('successful-heal budgets fail at zero, pass exactly at the limit, and fail above it', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const one = eventsFor({ id: '1' });
  const two = [...one, ...eventsFor({ id: '2', operationIndex: 1 })];
  expect(
    evaluateGovernance(one, registry, policy({ limits: { maxSuccessfulHealsPerRun: 0 } }), {
      evaluatedAt,
    }).status,
  ).toBe('fail');
  expect(
    evaluateGovernance(one, registry, policy({ limits: { maxSuccessfulHealsPerRun: 1 } }), {
      evaluatedAt,
    }).status,
  ).toBe('pass');
  expect(
    evaluateGovernance(two, registry, policy({ limits: { maxSuccessfulHealsPerRun: 1 } }), {
      evaluatedAt,
    }).violations[0]?.code,
  ).toBe('successful-heals-per-run-exceeded');
});

test('counts successful, rejected, failed, observed, and protected outcomes separately', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const events = [
    ...eventsFor({ id: '1', operationIndex: 0 }),
    ...eventsFor({ id: '2', outcome: 'rejected', operationIndex: 1 }),
    ...eventsFor({ id: '3', outcome: 'failed', operationIndex: 2 }),
    ...eventsFor({ id: '4', outcome: 'observed', operationIndex: 3 }),
    ...eventsFor({
      id: '5',
      targetKey: 'checkout.placeOrder',
      outcome: 'protected',
      risk: 'proposal-only',
      operationIndex: 4,
    }),
  ];
  expect(evaluateGovernance(events, registry, undefined, { evaluatedAt }).totals).toEqual({
    attempts: 5,
    successfulHeals: 1,
    rejectedAttempts: 2,
    protectedAttempts: 1,
    failedAttempts: 1,
    observedAttempts: 1,
    waivedAttempts: 0,
    discardedRetryAttempts: 0,
  });
});

test('groups multiple projects independently and deterministically', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const events = [
    ...eventsFor({ id: '1', projectName: 'webkit', operationIndex: 0 }),
    ...eventsFor({ id: '2', projectName: 'chromium', operationIndex: 1 }),
  ];
  const summary = evaluateGovernance(events.reverse(), registry, undefined, { evaluatedAt });
  expect(summary.projects).toEqual(['chromium', 'webkit']);
  expect(summary.groups.map((group) => group.projectName)).toEqual(['chromium', 'webkit']);
});

test('retains only the highest retry for a stable operation identity', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const events = [
    ...eventsFor({ id: '1', retry: 0, operationIndex: 0 }),
    ...eventsFor({ id: '2', retry: 1, operationIndex: 0 }),
  ];
  const summary = evaluateGovernance(events, registry, undefined, { evaluatedAt });
  expect(summary.totals).toMatchObject({
    attempts: 1,
    successfulHeals: 1,
    discardedRetryAttempts: 1,
  });
});

test('enforces target and target/action budgets', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const events = eventsFor({ id: '1' });
  const summary = evaluateGovernance(
    events,
    registry,
    policy({
      limits: {
        targets: {
          'checkout.applyDiscount': {
            maxSuccessfulHeals: 0,
            actions: { click: { maxSuccessfulHeals: 0 } },
          },
        },
      },
    }),
    { evaluatedAt },
  );
  expect(summary.violations.map((violation) => violation.code)).toEqual([
    'target-action-successful-heals-exceeded',
    'target-successful-heals-exceeded',
  ]);
});

test('enforces configured growth baselines', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const events = [
    ...eventsFor({ id: '1' }),
    ...eventsFor({ id: '2', outcome: 'rejected', operationIndex: 1 }),
  ];
  const summary = evaluateGovernance(
    events,
    registry,
    policy({ baseline: { successfulHeals: 0, rejectedAttempts: 0 } }),
    { evaluatedAt },
  );
  expect(summary.violations.map((violation) => violation.code)).toEqual([
    'rejected-attempts-baseline-regression',
    'successful-heals-baseline-regression',
  ]);
});

test('fails on unknown evidence identities only when configured', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const events = eventsFor({ id: '1', targetKey: 'unknown.target', outcome: 'rejected' });
  expect(evaluateGovernance(events, registry, policy(), { evaluatedAt }).status).toBe('pass');
  expect(
    evaluateGovernance(events, registry, policy({ failOnUnknownTargets: true }), {
      evaluatedAt,
    }).violations[0]?.code,
  ).toBe('unknown-target');
});

test('an active exact waiver adjusts budgets and remains visible', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const summary = evaluateGovernance(
    eventsFor({ id: '1' }),
    registry,
    policy({
      limits: { maxSuccessfulHealsPerRun: 0 },
      waivers: [
        {
          targetKey: 'checkout.applyDiscount',
          action: 'click',
          reason: 'Temporary migration window',
          expiresAt: '2026-08-17T00:00:00.000Z',
        },
      ],
    }),
    { evaluatedAt },
  );
  expect(summary.status).toBe('pass');
  expect(summary.totals.waivedAttempts).toBe(1);
  expect(summary.waivers[0]).toMatchObject({ status: 'active', matchedAttempts: 1 });
});

test('an expired waiver fails evaluation and cannot adjust a budget', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const summary = evaluateGovernance(
    eventsFor({ id: '1' }),
    registry,
    policy({
      limits: { maxSuccessfulHealsPerRun: 0 },
      waivers: [
        {
          targetKey: 'checkout.applyDiscount',
          reason: 'Expired migration window',
          expiresAt: '2026-08-16T11:59:59.000Z',
        },
      ],
    }),
    { evaluatedAt },
  );
  expect(summary.waivers[0]?.status).toBe('expired');
  expect(summary.violations.map((violation) => violation.code)).toContain('expired-waiver');
  expect(summary.violations.map((violation) => violation.code)).toContain(
    'successful-heals-per-run-exceeded',
  );
});

test('target/action waiver scope does not cover another action or target', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const events = [
    ...eventsFor({ id: '1' }),
    ...eventsFor({
      id: '2',
      targetKey: 'checkout.terms',
      action: 'check',
      operationIndex: 1,
    }),
  ];
  const summary = evaluateGovernance(
    events,
    registry,
    policy({
      limits: { maxSuccessfulHealsPerRun: 0 },
      waivers: [
        {
          targetKey: 'checkout.applyDiscount',
          action: 'click',
          reason: 'Only the discount migration',
          expiresAt: '2026-08-17T00:00:00.000Z',
        },
      ],
    }),
    { evaluatedAt },
  );
  expect(summary.totals.waivedAttempts).toBe(1);
  expect(summary.violations[0]).toMatchObject({
    code: 'successful-heals-per-run-exceeded',
    actual: 1,
  });
});

test('waivers cannot bypass proposal-only execution protection', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const unsafe = eventsFor({
    id: '1',
    targetKey: 'checkout.placeOrder',
    risk: 'automatic',
    outcome: 'successful',
  });
  const summary = evaluateGovernance(
    unsafe,
    registry,
    policy({
      waivers: [
        {
          targetKey: 'checkout.placeOrder',
          action: 'click',
          reason: 'Cannot waive safety',
          expiresAt: '2026-08-17T00:00:00.000Z',
        },
      ],
    }),
    { evaluatedAt },
  );
  expect(summary.violations.map((violation) => violation.code)).toEqual([
    'execution-risk-mismatch',
    'protected-target-executed',
  ]);
  expect(summary.status).toBe('fail');
});

test('rejects malformed dates, missing reasons, wildcards, duplicates, and conflicts', () => {
  const base = {
    version: 1,
    waivers: [
      {
        targetKey: 'checkout.applyDiscount',
        reason: 'Temporary',
        expiresAt: '2026-08-17T00:00:00.000Z',
      },
    ],
  };
  for (const value of [
    { ...base, waivers: [{ ...base.waivers[0], expiresAt: '2026-08-17' }] },
    {
      ...base,
      waivers: [{ targetKey: 'checkout.applyDiscount', expiresAt: '2026-08-17T00:00:00.000Z' }],
    },
    { ...base, waivers: [{ ...base.waivers[0], targetKey: 'checkout.*' }] },
    { ...base, waivers: [base.waivers[0], base.waivers[0]] },
    {
      ...base,
      waivers: [base.waivers[0], { ...base.waivers[0], action: 'click' }],
    },
  ]) {
    expect(() => parseGovernancePolicy(value)).toThrow(GovernancePolicyError);
  }
});

test('rejects unknown policy references and actions not allowed by the registry', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  expect(() =>
    evaluateGovernance(
      [],
      registry,
      parseGovernancePolicy({
        version: 1,
        limits: { targets: { 'unknown.target': { maxSuccessfulHeals: 0 } } },
      }),
      { evaluatedAt },
    ),
  ).toThrow(GovernancePolicyError);
  expect(() =>
    evaluateGovernance(
      [],
      registry,
      parseGovernancePolicy({
        version: 1,
        limits: {
          targets: {
            'checkout.applyDiscount': {
              actions: { fill: { maxSuccessfulHeals: 0 } },
            },
          },
        },
      }),
      { evaluatedAt },
    ),
  ).toThrow(GovernancePolicyError);
});

test('canonical order does not change policy output', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const events = [
    ...eventsFor({ id: '1' }),
    ...eventsFor({ id: '2', outcome: 'rejected', operationIndex: 1 }),
  ];
  fc.assert(
    fc.property(
      fc.shuffledSubarray(events, { minLength: events.length, maxLength: events.length }),
      (permutation) => {
        expect(evaluateGovernance(permutation, registry, policy(), { evaluatedAt })).toEqual(
          evaluateGovernance(events, registry, policy(), { evaluatedAt }),
        );
      },
    ),
    { numRuns: 25, seed: 20260816 },
  );
});

test('rejects conflicting event IDs and malformed chains', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const [assessment] = eventsFor({ id: '1', outcome: 'rejected' });
  expect(assessment).toBeDefined();
  expect(() =>
    evaluateGovernance(
      [assessment!, { ...assessment!, targetKey: 'checkout.terms' }],
      registry,
      undefined,
      { evaluatedAt },
    ),
  ).toThrow(GovernanceEvidenceError);
  const execution = eventsFor({ id: '2' })[1];
  expect(execution).toBeDefined();
  expect(() => evaluateGovernance([execution!], registry, undefined, { evaluatedAt })).toThrow(
    GovernanceEvidenceError,
  );
});

test('sanitizes Markdown table cells and diagnostics', async () => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const summary = evaluateGovernance(
    eventsFor({ id: '1', targetKey: 'unknown|<target>', outcome: 'rejected' }),
    registry,
    policy({ failOnUnknownTargets: true }),
    { evaluatedAt },
  );
  const report = renderHealthSummary(summary);
  expect(report).toContain('unknown\\|&lt;target&gt;');
  expect(report).not.toContain('<target>');
});

test('runtime policy parsing and checked-in JSON Schema agree on structural boundaries', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../registry/governance-policy.schema.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    formats: {
      'date-time': (value: string) => {
        const normalized =
          value.endsWith('Z') && !value.includes('.') ? value.replace(/Z$/, '.000Z') : value;
        return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === normalized;
      },
    },
  }).compile(schema);
  const cases = [
    { value: { version: 1 }, valid: true },
    { value: { version: 2 }, valid: false },
    { value: { version: 1, limits: { maxSuccessfulHealsPerRun: 0 } }, valid: true },
    { value: { version: 1, limits: {} }, valid: false },
    { value: { version: 1, limits: { maxSuccessfulHealsPerRun: -1 } }, valid: false },
    {
      value: {
        version: 1,
        waivers: [
          {
            targetKey: 'checkout.applyDiscount',
            reason: 'Temporary',
            expiresAt: '2026-08-17T00:00:00.000Z',
          },
        ],
      },
      valid: true,
    },
    {
      value: {
        version: 1,
        waivers: [
          { targetKey: 'checkout.*', reason: 'Too broad', expiresAt: '2026-08-17T00:00:00.000Z' },
        ],
      },
      valid: false,
    },
    {
      value: {
        version: 1,
        waivers: [
          {
            targetKey: 'checkout.applyDiscount',
            reason: 'Invalid calendar date',
            expiresAt: '2026-02-30T00:00:00.000Z',
          },
        ],
      },
      valid: false,
    },
  ];
  for (const item of cases) {
    let runtime = true;
    try {
      parseGovernancePolicy(item.value);
    } catch {
      runtime = false;
    }
    expect({ schema: validate(item.value), runtime }).toEqual({
      schema: item.valid,
      runtime: item.valid,
    });
  }
});

test('generated health summary satisfies its checked-in JSON Schema', async () => {
  const [registry, schemaSource] = await Promise.all([
    loadTargetRegistry(new URL('../registry/targets.json', import.meta.url)),
    readFile(new URL('../registry/health-summary.schema.json', import.meta.url), 'utf8'),
  ]);
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    formats: { 'date-time': true },
  }).compile(JSON.parse(schemaSource) as Record<string, unknown>);
  const summary = evaluateGovernance(eventsFor({ id: '1' }), registry, policy(), { evaluatedAt });
  expect(validate(summary), JSON.stringify(validate.errors)).toBe(true);
});
