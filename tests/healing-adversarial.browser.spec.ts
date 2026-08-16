import { errors, expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  FileScreenshotCapture,
  InMemoryAuditSink,
  InMemoryHealingResultSink,
  MissingPrimaryLocatorError,
  collectCandidates,
  createHealer,
  loadTargetRegistry,
  type CandidateCollector,
} from '../src/index.js';

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('Expected promise to reject');
}

async function guardedHarness(
  page: Page,
  testInfo: TestInfo,
  candidateCollector?: CandidateCollector,
) {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const auditSink = new InMemoryAuditSink();
  const resultSink = new InMemoryHealingResultSink();
  const healer = createHealer({
    page,
    registry,
    mode: 'guarded',
    primaryActionTimeoutMs: 300,
    auditSink,
    resultSink,
    screenshotCapture: new FileScreenshotCapture(
      page,
      testInfo.outputPath('healwright-screenshots'),
    ),
    ...(candidateCollector === undefined ? {} : { candidateCollector }),
  });

  return { healer, auditSink, resultSink };
}

test('fails safely when two candidates are semantically indistinguishable', async ({
  page,
}, testInfo) => {
  const { healer, auditSink, resultSink } = await guardedHarness(page, testInfo);
  await page.goto('/?mutation=ambiguous-drifted-terms');

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  for (const checkbox of await page.getByRole('checkbox').all()) {
    await expect(checkbox).not.toBeChecked();
  }
  expect(auditSink.events).toHaveLength(1);
  expect(auditSink.events[0]).toMatchObject({
    eventType: 'locator-drift-assessed',
    modeDecision: 'rejected',
    assessment: { eligible: false, reason: 'ambiguous' },
  });
  expect(resultSink.results).toHaveLength(0);
});

test('does not turn a disabled replacement into a passing test', async ({ page }, testInfo) => {
  const { healer, auditSink, resultSink } = await guardedHarness(page, testInfo);
  await page.goto('/?mutation=drifted-disabled-terms');

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(errors.TimeoutError);
  for (const checkbox of await page.getByRole('checkbox').all()) {
    await expect(checkbox).not.toBeChecked();
  }
  expect(auditSink.events[1]).toMatchObject({
    eventType: 'locator-heal-execution',
    status: 'failed',
    reason: 'action-failed',
    errorName: 'TimeoutError',
  });
  expect(resultSink.results).toHaveLength(0);
});

test('rejects a live candidate whose accessible role contradicts the target', async ({
  page,
}, testInfo) => {
  const { healer, auditSink, resultSink } = await guardedHarness(page, testInfo);
  await page.goto('/?mutation=drifted-wrong-role-terms');

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  await expect(page.locator('input[name="terms"]')).not.toBeChecked();
  expect(auditSink.events).toHaveLength(1);
  expect(auditSink.events[0]).toMatchObject({
    eventType: 'locator-drift-assessed',
    modeDecision: 'rejected',
    assessment: {
      eligible: false,
      reason: 'semantic-ineligible',
      semanticRejectionReasons: ['role-mismatch'],
    },
  });
  expect(resultSink.results).toHaveLength(0);
});

test('rejects a candidate set that changes between assessment and execution', async ({
  page,
}, testInfo) => {
  let collectionCalls = 0;
  const raceCollector: CandidateCollector = async (candidatePage, action) => {
    const candidates = await collectCandidates(candidatePage, action);
    collectionCalls += 1;
    if (collectionCalls === 1) {
      await candidatePage
        .locator('.checkbox-row')
        .evaluate((row) => row.after(row.cloneNode(true)));
    }
    return candidates;
  };
  const { healer, auditSink, resultSink } = await guardedHarness(page, testInfo, raceCollector);
  await page.goto('/?mutation=drifted-terms');

  const error = await captureError(healer.target('checkout.terms').check());

  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  expect(collectionCalls).toBe(2);
  expect(auditSink.events[1]).toMatchObject({
    eventType: 'locator-heal-execution',
    status: 'rejected',
    reason: 'revalidation-changed',
  });
  for (const checkbox of await page.getByRole('checkbox').all()) {
    await expect(checkbox).not.toBeChecked();
  }
  expect(resultSink.results).toHaveLength(0);
});
