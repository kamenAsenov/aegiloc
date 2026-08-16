import { expect, test } from '@playwright/test';

import {
  InMemoryAuditSink,
  InMemoryHealingResultSink,
  MissingPrimaryLocatorError,
  collectCandidates,
  createHealer,
  loadTargetRegistry,
  type TargetRegistry,
  type ExecutionRisk,
} from '../src/index.js';

async function registryWithStaleProtectedPrimary(): Promise<TargetRegistry> {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const protectedTarget = registry.targets['checkout.placeOrder'];
  if (protectedTarget === undefined) throw new Error('Fixture registry is missing placeOrder');
  const { neighborText: fixtureOnlyNeighborContext, ...exactFingerprint } =
    protectedTarget.fingerprint;
  void fixtureOnlyNeighborContext;
  return {
    ...registry,
    targets: {
      ...registry.targets,
      'checkout.placeOrder': {
        ...protectedTarget,
        primary: { type: 'css', value: '#stale-place-order' } as const,
        fingerprint: exactFingerprint,
      },
    },
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
}

test('same click action obeys explicit per-target execution risk', async ({ page }) => {
  const registry = await registryWithStaleProtectedPrimary();
  const auditSink = new InMemoryAuditSink();
  const resultSink = new InMemoryHealingResultSink();
  const healer = createHealer({
    page,
    registry,
    mode: 'guarded',
    primaryActionTimeoutMs: 300,
    auditSink,
    resultSink,
  });

  await page.goto('/?mutation=drifted-discount');
  await healer.target('checkout.applyDiscount').click();
  await expect(page.getByRole('status')).toHaveText('Discount applied');

  await page.goto('/');
  const error = await captureError(healer.target('checkout.placeOrder').click());
  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  await expect(page.getByRole('status')).toBeEmpty();
  expect(auditSink.events.at(-1)).toMatchObject({
    eventType: 'locator-drift-assessed',
    targetKey: 'checkout.placeOrder',
    action: 'click',
    modeDecision: 'rejected',
    operationIndex: 0,
    executionPolicy: { risk: 'proposal-only', automaticExecutionAllowed: false },
    assessment: { eligible: true, reason: 'eligible' },
  });
  expect(resultSink.results).toHaveLength(1);
});

test('observe mode records protected candidate evidence without execution', async ({ page }) => {
  const registry = await registryWithStaleProtectedPrimary();
  const auditSink = new InMemoryAuditSink();
  const healer = createHealer({
    page,
    registry,
    mode: 'observe',
    primaryActionTimeoutMs: 300,
    auditSink,
  });
  await page.goto('/');
  expect(await captureError(healer.target('checkout.placeOrder').click())).toBeInstanceOf(
    MissingPrimaryLocatorError,
  );
  await expect(page.getByRole('status')).toBeEmpty();
  expect(auditSink.events).toHaveLength(1);
  expect(auditSink.events[0]).toMatchObject({
    modeDecision: 'observed',
    executionPolicy: { risk: 'proposal-only', automaticExecutionAllowed: false },
    assessment: { eligible: true },
  });
});

test('second-pass validation preserves a policy that becomes protected after assessment', async ({
  page,
}) => {
  const source = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const target = source.targets['checkout.applyDiscount'];
  if (target === undefined) throw new Error('Fixture registry is missing applyDiscount');
  const mutablePolicy = {
    ...target.policy,
    executionRisk: 'automatic' as ExecutionRisk,
  };
  const registry: TargetRegistry = {
    ...source,
    targets: {
      ...source.targets,
      'checkout.applyDiscount': {
        ...target,
        primary: { type: 'css', value: '#stale-discount-button' },
        policy: mutablePolicy,
      },
    },
  };
  const auditSink = new InMemoryAuditSink();
  let collectionCalls = 0;
  const healer = createHealer({
    page,
    registry,
    mode: 'guarded',
    primaryActionTimeoutMs: 300,
    auditSink,
    candidateCollector: async (candidatePage, action) => {
      collectionCalls += 1;
      const candidates = await collectCandidates(candidatePage, action);
      mutablePolicy.executionRisk = 'proposal-only';
      return candidates;
    },
  });
  await page.goto('/');

  expect(await captureError(healer.target('checkout.applyDiscount').click())).toBeInstanceOf(
    MissingPrimaryLocatorError,
  );
  await expect(page.getByRole('status')).toBeEmpty();
  expect(collectionCalls).toBe(1);
  expect(auditSink.events[1]).toMatchObject({
    eventType: 'locator-heal-execution',
    status: 'rejected',
    reason: 'execution-risk-protected',
  });
});
