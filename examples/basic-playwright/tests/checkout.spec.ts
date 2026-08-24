import { expect } from '@playwright/test';
import { PASSED_WITH_HEALING, createAegilocTest, loadTargetRegistry } from 'aegiloc';

const registry = await loadTargetRegistry(new URL('../targets.json', import.meta.url));
const test = createAegilocTest({
  registry,
  mode: 'guarded',
  primaryActionTimeoutMs: 300,
  runId: (testInfo) => `basic-example-${testInfo.testId}`,
});

test('recovers a reviewed discount-button locator drift', async ({ healer, page }, testInfo) => {
  await page.goto('/?mutation=drifted-discount');
  await healer.target('checkout.applyDiscount').click();

  await expect(page.getByRole('status')).toHaveText('Discount applied');
  expect(testInfo.annotations).toContainEqual(
    expect.objectContaining({ type: PASSED_WITH_HEALING }),
  );
});
