import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  CompositeAuditSink,
  FileScreenshotCapture,
  InMemoryAuditSink,
  MissingPrimaryLocatorError,
  PASSED_WITH_HEALING,
  PlaywrightAttachmentAuditSink,
  PlaywrightHealingResultSink,
  createHealer,
  createPlaywrightAuditProvenance,
  loadTargetRegistry,
  type AuditSink,
} from 'healwright';

async function demoHealer(page: Page, testInfo: TestInfo, inMemory?: InMemoryAuditSink) {
  const registry = await loadTargetRegistry(new URL('../targets.json', import.meta.url));
  const auditSinks: AuditSink[] = [new PlaywrightAttachmentAuditSink(testInfo)];
  if (inMemory !== undefined) auditSinks.push(inMemory);
  return createHealer({
    page,
    registry,
    mode: 'guarded',
    primaryActionTimeoutMs: 300,
    auditSink: new CompositeAuditSink(auditSinks),
    screenshotCapture: new FileScreenshotCapture(
      page,
      testInfo.outputPath('healwright-screenshots'),
    ),
    resultSink: new PlaywrightHealingResultSink(testInfo),
    auditProvenance: createPlaywrightAuditProvenance(testInfo, {
      runId: 'realistic-demo-v1.0',
    }),
  });
}

test('ordinary Playwright remains the baseline when the UI has not drifted', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Apply discount', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('Discount applied');
});

test('a reviewed text locator drift heals when one compatible candidate is clear', async ({
  page,
}, testInfo) => {
  const healer = await demoHealer(page, testInfo);
  await page.goto('/?mutation=drifted-discount');

  await healer.target('checkout.applyDiscount').click();

  await expect(page.getByRole('status')).toHaveText('Discount applied');
  expect(testInfo.annotations).toContainEqual(
    expect.objectContaining({ type: PASSED_WITH_HEALING }),
  );
});

test('ambiguous checkbox drift is rejected without changing product state', async ({
  page,
}, testInfo) => {
  const audit = new InMemoryAuditSink();
  const healer = await demoHealer(page, testInfo, audit);
  await page.goto('/?mutation=ambiguous-drifted-terms');

  await expect(healer.target('checkout.terms').check()).rejects.toBeInstanceOf(
    MissingPrimaryLocatorError,
  );

  for (const checkbox of await page.getByRole('checkbox').all()) {
    await expect(checkbox).not.toBeChecked();
  }
  expect(audit.events).toHaveLength(1);
  expect(audit.events[0]).toMatchObject({
    eventType: 'locator-drift-assessed',
    modeDecision: 'rejected',
    assessment: { eligible: false, reason: 'ambiguous' },
  });
  expect(testInfo.annotations).not.toContainEqual(
    expect.objectContaining({ type: PASSED_WITH_HEALING }),
  );
});
