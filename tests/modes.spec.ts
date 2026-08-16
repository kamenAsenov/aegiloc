import { errors, expect, test, type Locator, type Page } from '@playwright/test';

import {
  ArtifactCaptureError,
  AuditWriteError,
  InMemoryAuditSink,
  InMemoryHealingResultSink,
  MissingPrimaryLocatorError,
  PASSED_WITH_HEALING,
  createHealer,
  type AuditModeDecision,
  type CandidateSnapshot,
  type CapturedScreenshot,
  type HealingAuditEvent,
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
  readonly candidateActionCalls: () => number;
  readonly probeCalls: () => number;
}

function missingPage(candidateCount = 1): MissingPageHarness {
  let actionCalls = 0;
  let candidateActionCalls = 0;
  let probeCalls = 0;
  const timeout = (): errors.TimeoutError => new errors.TimeoutError('primary locator timed out');
  const primaryLocator = {
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
  const candidateLocator = {
    and: (): Locator => candidateLocator,
    check: (): Promise<void> => {
      candidateActionCalls += 1;
      return Promise.resolve();
    },
    count: (): Promise<number> => Promise.resolve(candidateCount),
  } as unknown as Locator;
  const page = {
    getByRole: (): Locator => candidateLocator,
    getByTestId: (testId: string): Locator =>
      testId === 'checkout-terms' ? primaryLocator : candidateLocator,
    locator: (): Locator => candidateLocator,
  } as unknown as Page;

  return {
    page,
    actionCalls: () => actionCalls,
    candidateActionCalls: () => candidateActionCalls,
    probeCalls: () => probeCalls,
  };
}

function screenshot(phase: CapturedScreenshot['phase']): CapturedScreenshot {
  const name = `${phase}.png`;
  return {
    phase,
    name,
    filePath: `/tmp/${name}`,
    auditPath: `test-results/${name}`,
    contentType: 'image/png',
  };
}

const screenshotCapture = {
  capture: ({ phase }: { readonly phase: CapturedScreenshot['phase'] }) =>
    Promise.resolve(screenshot(phase)),
};

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

const nonExecutingModes: readonly [HealingMode, AuditModeDecision][] = [
  ['observe', 'observed'],
  ['strict-ci', 'strict-ci-failure'],
];

for (const [mode, expectedDecision] of nonExecutingModes) {
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
    expect(harness.candidateActionCalls()).toBe(0);
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
          eligibility: { eligible: true, reasons: [] },
        },
      ],
    });
    const assessmentEvent = auditSink.events.find(
      (event): event is HealingAuditEvent => event.eventType === 'locator-drift-assessed',
    );
    expect(assessmentEvent?.rankedCandidates[0]?.score).toBeCloseTo(1, 5);
  });
}

test('guarded mode revalidates, executes, audits, and records a healed result', async () => {
  const harness = missingPage();
  const auditSink = new InMemoryAuditSink();
  const resultSink = new InMemoryHealingResultSink();
  let collectionCalls = 0;
  const healer = createHealer({
    page: harness.page,
    registry,
    mode: 'guarded',
    auditSink,
    resultSink,
    screenshotCapture,
    auditProvenance: {
      runId: 'run-guarded-1',
      testId: 'guarded-healing-test',
      projectName: 'chromium',
      retry: 0,
      commitSha: 'abcdef0123456789',
    },
    primaryActionTimeoutMs: 300,
    candidateCollector: () => {
      collectionCalls += 1;
      return Promise.resolve([compatibleCandidate]);
    },
  });

  await healer.target('checkout.terms').check();

  expect(collectionCalls).toBe(2);
  expect(harness.actionCalls()).toBe(1);
  expect(harness.candidateActionCalls()).toBe(1);
  expect(auditSink.events).toHaveLength(2);
  expect(auditSink.events[0]).toMatchObject({
    eventType: 'locator-drift-assessed',
    modeDecision: 'eligible',
    assessment: { eligible: true, semanticRejectionReasons: [] },
    rankedCandidates: [{ eligibility: { eligible: true, reasons: [] } }],
    provenance: { runId: 'run-guarded-1', testId: 'guarded-healing-test' },
  });
  expect(auditSink.events[1]).toMatchObject({
    eventType: 'locator-heal-execution',
    parentEventId: auditSink.events[0]?.eventId,
    status: 'succeeded',
    reason: 'succeeded',
    provenance: { runId: 'run-guarded-1', testId: 'guarded-healing-test' },
    screenshots: [{ phase: 'before' }, { phase: 'after' }],
  });
  expect(resultSink.results[0]).toMatchObject({
    status: PASSED_WITH_HEALING,
    targetKey: 'checkout.terms',
    action: 'check',
  });
});

test('observe mode reports semantic rejection without executing the candidate', async () => {
  const harness = missingPage();
  const auditSink = new InMemoryAuditSink();
  const healer = createHealer({
    page: harness.page,
    registry,
    mode: 'observe',
    auditSink,
    primaryActionTimeoutMs: 300,
    candidateCollector: () => Promise.resolve([{ ...compatibleCandidate, role: 'button' }]),
  });

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  expect(harness.candidateActionCalls()).toBe(0);
  expect(auditSink.events).toHaveLength(1);
  expect(auditSink.events[0]).toMatchObject({
    eventType: 'locator-drift-assessed',
    modeDecision: 'observed',
    assessment: {
      eligible: false,
      reason: 'semantic-ineligible',
      semanticRejectionReasons: ['role-mismatch'],
    },
    rankedCandidates: [{ eligibility: { eligible: false, reasons: ['role-mismatch'] } }],
  });
});

test('guarded mode fails closed on a first-pass semantic contradiction', async () => {
  const harness = missingPage();
  const auditSink = new InMemoryAuditSink();
  let collectionCalls = 0;
  const healer = createHealer({
    page: harness.page,
    registry,
    mode: 'guarded',
    auditSink,
    primaryActionTimeoutMs: 300,
    candidateCollector: () => {
      collectionCalls += 1;
      return Promise.resolve([{ ...compatibleCandidate, role: 'button' }]);
    },
  });

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  expect(collectionCalls).toBe(1);
  expect(harness.candidateActionCalls()).toBe(0);
  expect(auditSink.events).toHaveLength(1);
  expect(auditSink.events[0]).toMatchObject({
    modeDecision: 'rejected',
    assessment: { eligible: false, reason: 'semantic-ineligible' },
  });
});

test('guarded mode rejects a candidate that becomes semantically invalid between passes', async () => {
  const harness = missingPage();
  const auditSink = new InMemoryAuditSink();
  let collectionCalls = 0;
  const healer = createHealer({
    page: harness.page,
    registry,
    mode: 'guarded',
    auditSink,
    screenshotCapture,
    primaryActionTimeoutMs: 300,
    candidateCollector: () => {
      collectionCalls += 1;
      return Promise.resolve([
        collectionCalls === 1 ? compatibleCandidate : { ...compatibleCandidate, role: 'button' },
      ]);
    },
  });

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  expect(collectionCalls).toBe(2);
  expect(harness.candidateActionCalls()).toBe(0);
  expect(auditSink.events[1]).toMatchObject({
    eventType: 'locator-heal-execution',
    status: 'rejected',
    reason: 'semantic-revalidation-failed',
  });
});

test('guarded mode rejects a candidate that becomes ambiguous during revalidation', async () => {
  const harness = missingPage();
  const auditSink = new InMemoryAuditSink();
  let collectionCalls = 0;
  const healer = createHealer({
    page: harness.page,
    registry,
    mode: 'guarded',
    auditSink,
    screenshotCapture,
    primaryActionTimeoutMs: 300,
    candidateCollector: () => {
      collectionCalls += 1;
      return Promise.resolve(
        collectionCalls === 1
          ? [compatibleCandidate]
          : [compatibleCandidate, { ...compatibleCandidate, id: 'input:accept-terms:1' }],
      );
    },
  });

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  expect(harness.candidateActionCalls()).toBe(0);
  expect(auditSink.events[1]).toMatchObject({
    eventType: 'locator-heal-execution',
    status: 'rejected',
    reason: 'revalidation-changed',
  });
});

test('guarded mode fails closed when the pre-action screenshot cannot be captured', async () => {
  const harness = missingPage();
  const auditSink = new InMemoryAuditSink();
  const artifactFailure = new Error('screenshot storage unavailable');
  const healer = createHealer({
    page: harness.page,
    registry,
    mode: 'guarded',
    auditSink,
    primaryActionTimeoutMs: 300,
    candidateCollector: () => Promise.resolve([compatibleCandidate]),
    screenshotCapture: { capture: () => Promise.reject(artifactFailure) },
  });

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(ArtifactCaptureError);
  expect(harness.candidateActionCalls()).toBe(0);
  expect(auditSink.events[1]).toMatchObject({
    eventType: 'locator-heal-execution',
    status: 'failed',
    reason: 'artifact-capture-failed',
    errorName: 'Error',
  });
});

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
