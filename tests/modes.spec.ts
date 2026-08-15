import { errors, expect, test, type Locator, type Page } from '@playwright/test';

import {
  AuditWriteError,
  InMemoryAuditSink,
  MissingPrimaryLocatorError,
  createHealer,
  type CandidateSnapshot,
  type AuditModeDecision,
  type HealingMode,
  type TargetRegistry,
} from '../src/index.js';

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('Expected promise to reject');
}

const registry = {
  version: 1,
  defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
  targets: {
    'checkout.terms': {
      description: 'Store terms acceptance checkbox',
      primary: { type: 'testId', value: 'checkout-terms' },
      fingerprint: {
        accessibleRole: 'checkbox',
        accessibleName: 'I agree to the store terms',
        stableAttributes: { name: 'terms', type: 'checkbox' },
        tag: 'input',
        neighborText: ['I agree to the store terms'],
      },
      policy: {
        allowedActions: ['check'],
        healing: {
          enabled: true,
          confidenceThreshold: 0.94,
          minimumScoreMargin: 0.18,
        },
      },
    },
  },
} as const satisfies TargetRegistry<'checkout.terms'>;

const compatibleCandidate: CandidateSnapshot = {
  id: 'input:accept-terms:0',
  role: 'checkbox',
  accessibleName: 'I agree to the store terms',
  stableAttributes: { 'data-testid': 'accept-terms', name: 'terms', type: 'checkbox' },
  visibleText: '',
  tag: 'input',
  ancestorText: [],
  neighborText: ['I agree to the store terms'],
};

interface MissingPageHarness {
  readonly page: Page;
  readonly actionCalls: () => number;
  readonly probeCalls: () => number;
}

function missingPage(): MissingPageHarness {
  let actionCalls = 0;
  let probeCalls = 0;
  const timeout = (): errors.TimeoutError => new errors.TimeoutError('primary locator timed out');
  const locator = {
    check: (): Promise<void> => {
      actionCalls += 1;
      return Promise.reject(timeout());
    },
    waitFor: (): Promise<void> => {
      probeCalls += 1;
      return Promise.reject(timeout());
    },
    count: (): Promise<number> => Promise.resolve(0),
  } as unknown as Locator;
  const page = {
    getByTestId: (): Locator => locator,
  } as unknown as Page;

  return {
    page,
    actionCalls: () => actionCalls,
    probeCalls: () => probeCalls,
  };
}

test('off mode runs only the primary action and emits no audit event', async () => {
  const harness = missingPage();
  const auditSink = new InMemoryAuditSink();
  const healer = createHealer({
    page: harness.page,
    registry,
    mode: 'off',
    auditSink,
    primaryActionTimeoutMs: 300,
  });

  const error = await captureError(healer.target('checkout.terms').check());
  expect(error).toBeInstanceOf(errors.TimeoutError);
  expect(error).not.toBeInstanceOf(MissingPrimaryLocatorError);
  expect(auditSink.events).toHaveLength(0);
  expect(harness.actionCalls()).toBe(1);
  expect(harness.probeCalls()).toBe(0);
});

const assessedModes: readonly [HealingMode, AuditModeDecision][] = [
  ['observe', 'observed'],
  ['guarded', 'eligible'],
  ['strict-ci', 'strict-ci-failure'],
];

for (const [mode, expectedDecision] of assessedModes) {
  test(`${mode} mode assesses drift, audits it, and does not execute the candidate`, async () => {
    const harness = missingPage();
    const auditSink = new InMemoryAuditSink();
    const healer = createHealer({
      page: harness.page,
      registry,
      mode,
      auditSink,
      primaryActionTimeoutMs: 300,
      candidateCollector: () => Promise.resolve([compatibleCandidate]),
    });

    const error = await captureError(healer.target('checkout.terms').check());
    expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
    expect(harness.actionCalls()).toBe(1);
    expect(harness.probeCalls()).toBe(1);
    expect(auditSink.events).toHaveLength(1);
    expect(auditSink.events[0]).toMatchObject({
      mode,
      modeDecision: expectedDecision,
      targetKey: 'checkout.terms',
      action: 'check',
      assessment: { eligible: true, reason: 'eligible' },
      collection: { status: 'completed' },
      rankedCandidates: [
        {
          rank: 1,
          id: 'input:accept-terms:0',
          role: 'checkbox',
          accessibleName: 'I agree to the store terms',
          tag: 'input',
        },
      ],
    });
    expect(auditSink.events[0]?.rankedCandidates[0]?.score).toBeCloseTo(1, 5);
  });
}

test('a disabled healing policy skips candidate collection and records a rejection', async () => {
  const harness = missingPage();
  const auditSink = new InMemoryAuditSink();
  let collectionCalls = 0;
  const disabledRegistry = {
    ...registry,
    targets: {
      'checkout.terms': {
        ...registry.targets['checkout.terms'],
        policy: {
          ...registry.targets['checkout.terms'].policy,
          healing: {
            ...registry.targets['checkout.terms'].policy.healing,
            enabled: false,
          },
        },
      },
    },
  } as const satisfies TargetRegistry<'checkout.terms'>;
  const healer = createHealer({
    page: harness.page,
    registry: disabledRegistry,
    mode: 'guarded',
    auditSink,
    primaryActionTimeoutMs: 300,
    candidateCollector: () => {
      collectionCalls += 1;
      return Promise.resolve([compatibleCandidate]);
    },
  });

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  expect(collectionCalls).toBe(0);
  expect(auditSink.events[0]).toMatchObject({
    modeDecision: 'rejected',
    collection: { status: 'skipped-policy-disabled', candidateCount: 0 },
    assessment: { eligible: false, reason: 'disabled' },
  });
});

test('candidate collection failures are sanitized, audited, and rejected', async () => {
  const harness = missingPage();
  const auditSink = new InMemoryAuditSink();
  const healer = createHealer({
    page: harness.page,
    registry,
    mode: 'guarded',
    auditSink,
    primaryActionTimeoutMs: 300,
    candidateCollector: () => Promise.reject(new Error('secret collection details')),
  });

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  expect(auditSink.events[0]).toMatchObject({
    modeDecision: 'rejected',
    collection: { status: 'failed', candidateCount: 0, errorName: 'Error' },
    assessment: { eligible: false, reason: 'no-candidates' },
  });
  expect(JSON.stringify(auditSink.events[0])).not.toContain('secret collection details');
});

test('audit sink failures fail closed with an explicit framework error', async () => {
  const harness = missingPage();
  const sinkFailure = new Error('audit storage unavailable');
  const healer = createHealer({
    page: harness.page,
    registry,
    mode: 'guarded',
    primaryActionTimeoutMs: 300,
    candidateCollector: () => Promise.resolve([compatibleCandidate]),
    auditSink: {
      write: () => Promise.reject(sinkFailure),
    },
  });

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(AuditWriteError);
  expect((error as AuditWriteError).cause).toBe(sinkFailure);
  expect(harness.actionCalls()).toBe(1);
});
