import { expect, test } from '@playwright/test';

test('places an order with ordinary Playwright locators', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Cardholder name').fill('Ada Lovelace');
  await page.getByRole('checkbox', { name: 'I agree to the store terms' }).check();
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page.getByRole('status')).toHaveText('Order placed successfully');
});
