import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  CompositeAuditSink,
  FileScreenshotCapture,
  InMemoryAuditSink,
  PASSED_WITH_HEALING,
  PlaywrightAttachmentAuditSink,
  PlaywrightHealingResultSink,
  createPlaywrightAuditProvenance,
  createHealer,
  loadTargetRegistry,
} from '../src/index.js';

async function guardedHealer(page: Page, testInfo: TestInfo) {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const memory = new InMemoryAuditSink();
  const healer = createHealer({
    page,
    registry,
    mode: 'guarded',
    primaryActionTimeoutMs: 300,
    auditSink: new CompositeAuditSink([memory, new PlaywrightAttachmentAuditSink(testInfo)]),
    screenshotCapture: new FileScreenshotCapture(
      page,
      testInfo.outputPath('healwright-screenshots'),
    ),
    resultSink: new PlaywrightHealingResultSink(testInfo),
    auditProvenance: createPlaywrightAuditProvenance(testInfo, {
      runId: `fixture-run-${testInfo.testId}`,
      commitSha: 'abcdef0123456789',
    }),
  });

  return { healer, memory };
}

function expectSuccessfulHealing(memory: InMemoryAuditSink, testInfo: TestInfo): void {
  expect(memory.events).toHaveLength(2);
  expect(memory.events[0]).toMatchObject({
    eventType: 'locator-drift-assessed',
    mode: 'guarded',
    modeDecision: 'eligible',
    assessment: { eligible: true, reason: 'eligible' },
    provenance: { version: 1, projectName: 'chromium', retry: 0 },
  });
  expect(memory.events[1]).toMatchObject({
    eventType: 'locator-heal-execution',
    status: 'succeeded',
    reason: 'succeeded',
    screenshots: [{ phase: 'before' }, { phase: 'after' }],
    provenance: { version: 1, projectName: 'chromium', retry: 0 },
  });
  expect(testInfo.annotations).toContainEqual(
    expect.objectContaining({ type: PASSED_WITH_HEALING }),
  );
  expect(
    testInfo.attachments.some((attachment) => attachment.name.startsWith(PASSED_WITH_HEALING)),
  ).toBe(true);
  expect(
    testInfo.attachments
      .filter((attachment) => attachment.name.startsWith('healwright-'))
      .map((attachment) => attachment.contentType),
  ).toEqual(expect.arrayContaining(['image/png', 'image/png']));
}

test('heals compatible click locator drift', async ({ page }, testInfo) => {
  const { healer, memory } = await guardedHealer(page, testInfo);
  await page.goto('/?mutation=drifted-discount');

  await healer.target('checkout.applyDiscount').click();

  await expect(page.getByRole('status')).toHaveText('Discount applied');
  expectSuccessfulHealing(memory, testInfo);
});

test('heals compatible fill locator drift without auditing the value', async ({
  page,
}, testInfo) => {
  const { healer, memory } = await guardedHealer(page, testInfo);
  await page.goto('/?mutation=drifted-cardholder');

  await healer.target('checkout.cardholderName').fill('Ada Lovelace');

  await expect(page.getByRole('textbox', { name: 'Cardholder Name' })).toHaveValue('Ada Lovelace');
  expect(JSON.stringify(memory.events)).not.toContain('Ada Lovelace');
  expectSuccessfulHealing(memory, testInfo);
});

test('heals compatible checkbox locator drift', async ({ page }, testInfo) => {
  const { healer, memory } = await guardedHealer(page, testInfo);
  await page.goto('/?mutation=drifted-terms');

  await healer.target('checkout.terms').check();

  await expect(page.getByRole('checkbox')).toBeChecked();
  expectSuccessfulHealing(memory, testInfo);
});

test('heals compatible select locator drift and preserves the action result', async ({
  page,
}, testInfo) => {
  const { healer, memory } = await guardedHealer(page, testInfo);
  await page.goto('/?mutation=drifted-country');

  const selected = await healer.target('checkout.shippingCountry').selectOption('GB');

  expect(selected).toEqual(['GB']);
  await expect(page.getByRole('combobox')).toHaveValue('GB');
  expectSuccessfulHealing(memory, testInfo);
});
