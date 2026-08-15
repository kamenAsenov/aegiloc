import { expect, test } from '@playwright/test';

import { createHealer, loadTargetRegistry } from '../src/index.js';

test('executes primary locators through the explicit target API', async ({ page }) => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const healer = createHealer({ page, registry });

  await page.goto('/');

  await healer.target('checkout.cardholderName').fill('Ada Lovelace');
  await healer.target('checkout.shippingCountry').selectOption('GB');
  await healer.target('checkout.terms').check();
  await healer.target('checkout.applyDiscount').click();
  await expect(page.getByRole('status')).toHaveText('Discount applied');
  await healer.target('checkout.placeOrder').click();

  await expect(page.getByLabel('Shipping country')).toHaveValue('GB');
  await expect(page.getByRole('status')).toHaveText('Order placed successfully');
});
