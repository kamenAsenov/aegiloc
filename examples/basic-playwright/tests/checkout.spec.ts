import { expect, test } from '@playwright/test';
import {
  CompositeAuditSink,
  FileScreenshotCapture,
  PASSED_WITH_HEALING,
  PlaywrightAttachmentAuditSink,
  PlaywrightHealingResultSink,
  createHealer,
  createPlaywrightAuditProvenance,
  loadTargetRegistry,
} from 'healwright';

test('recovers a reviewed discount-button locator drift', async ({ page }, testInfo) => {
  const registry = await loadTargetRegistry(new URL('../targets.json', import.meta.url));
  const healer = createHealer({
    page,
    registry,
    mode: 'guarded',
    primaryActionTimeoutMs: 300,
    auditSink: new CompositeAuditSink([new PlaywrightAttachmentAuditSink(testInfo)]),
    screenshotCapture: new FileScreenshotCapture(
      page,
      testInfo.outputPath('healwright-screenshots'),
    ),
    resultSink: new PlaywrightHealingResultSink(testInfo),
    auditProvenance: createPlaywrightAuditProvenance(testInfo, {
      runId: `basic-example-${testInfo.testId}`,
    }),
  });

  await page.goto('/?mutation=drifted-discount');
  await healer.target('checkout.applyDiscount').click();

  await expect(page.getByRole('status')).toHaveText('Discount applied');
  expect(testInfo.annotations).toContainEqual(
    expect.objectContaining({ type: PASSED_WITH_HEALING }),
  );
});
