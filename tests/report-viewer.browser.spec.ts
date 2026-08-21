import { expect, test } from '@playwright/test';

import {
  assessCandidates,
  createAuditEvidenceSummary,
  createHealingAuditEvent,
  createHealingExecutionAuditEvent,
  rankCandidates,
  renderReportViewer,
  type HealwrightAuditEvent,
} from '../src/index.js';

function interactiveReport(): string {
  const ranked = rankCandidates(
    {
      accessibleRole: 'button',
      accessibleName: 'Place order',
      visibleText: 'Place order',
      tag: 'button',
    },
    [
      {
        id: 'button:place-order:0',
        role: 'button',
        accessibleName: 'Place order',
        visibleText: 'Place order',
        tag: 'button',
        stableAttributes: { 'data-testid': 'place-order-v2' },
        ancestorText: ['Order summary'],
        neighborText: ['Total €42.00'],
      },
    ],
    'click',
  );
  const healed = createHealingAuditEvent({
    eventId: 'assessment-browser-healed',
    timestamp: '2026-08-21T08:00:00.000Z',
    mode: 'guarded',
    modeDecision: 'eligible',
    targetKey: 'checkout.placeOrder',
    action: 'click',
    primaryLocator: { type: 'testId', value: 'place-order' },
    primaryError: new Error('missing'),
    collectionStatus: 'completed',
    assessment: assessCandidates(ranked, {
      enabled: true,
      confidenceThreshold: 0.9,
      minimumScoreMargin: 0.15,
    }),
    rankedCandidates: ranked,
  });
  const execution = createHealingExecutionAuditEvent({
    eventId: 'execution-browser-healed',
    timestamp: '2026-08-21T08:00:01.000Z',
    parentEventId: healed.eventId,
    targetKey: healed.targetKey,
    action: 'click',
    candidateId: ranked[0]?.candidate.id ?? 'missing',
    status: 'succeeded',
    reason: 'succeeded',
    screenshots: [],
  });
  const rejected = createHealingAuditEvent({
    eventId: 'assessment-browser-rejected',
    timestamp: '2026-08-21T08:00:02.000Z',
    mode: 'guarded',
    modeDecision: 'rejected',
    targetKey: 'checkout.acceptTerms',
    action: 'check',
    primaryLocator: { type: 'label', value: 'Accept terms', exact: true },
    primaryError: new Error('missing'),
    collectionStatus: 'completed',
    assessment: assessCandidates([], {
      enabled: true,
      confidenceThreshold: 0.94,
      minimumScoreMargin: 0.18,
    }),
    rankedCandidates: [],
  });
  const events: readonly HealwrightAuditEvent[] = [healed, execution, rejected];
  return renderReportViewer(
    events,
    createAuditEvidenceSummary(events, '2026-08-21T08:01:00.000Z'),
    { title: 'Storefront recovery evidence', evidenceTrust: { level: 'integrity' } },
  );
}

test('report controls filter decisions and expose full scoring evidence', async ({ page }) => {
  await page.setContent(interactiveReport());

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Storefront recovery evidence');
  await expect(page.getByText('Evidence integrity verified')).toBeVisible();
  await expect(page.locator('[data-event-card]')).toHaveCount(2);

  await page.getByLabel('Search target or evidence').fill('acceptTerms');
  await expect(page.locator('[data-event-card]:visible')).toHaveCount(1);
  await expect(page.locator('[data-visible-count]')).toHaveText('1');
  await expect(page.getByRole('heading', { name: 'checkout.acceptTerms' })).toBeVisible();

  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByLabel('Outcome').selectOption('healed');
  await expect(page.locator('[data-event-card]:visible')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'checkout.placeOrder' })).toBeVisible();

  await page.getByText('Compare ranked candidates (1)').click();
  await page.getByText('Scoring signals').click();
  await expect(page.getByRole('columnheader', { name: 'Contribution' })).toBeVisible();
  await expect(page.getByText('Accessible Name', { exact: true })).toBeVisible();
});

test('report remains usable at a narrow viewport with labeled controls', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setContent(interactiveReport());

  await expect(page.getByLabel('Action')).toBeVisible();
  await expect(page.getByLabel('Decision reason')).toBeVisible();
  await page.getByLabel('Action').focus();
  await expect(page.getByLabel('Action')).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
