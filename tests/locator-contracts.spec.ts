import { expect, test } from '@playwright/test';

import { resolvePrimaryLocator } from '../src/index.js';

test('role locator resolves an exact accessible name', async ({ page }) => {
  await page.setContent('<button>Save</button><button>Save draft</button>');

  const locator = resolvePrimaryLocator(page, {
    type: 'role',
    role: 'button',
    name: 'Save',
    exact: true,
  });

  await expect(locator).toHaveCount(1);
  await expect(locator).toHaveText('Save');
});

test('role locator keeps Playwright partial-name matching when exact is omitted', async ({
  page,
}) => {
  await page.setContent('<button>Save</button><button>Save draft</button>');

  const locator = resolvePrimaryLocator(page, {
    type: 'role',
    role: 'button',
    name: 'Save',
  });

  await expect(locator).toHaveCount(2);
});

test('role locator supports intentionally unnamed role queries', async ({ page }) => {
  await page.setContent('<button>First</button><button>Second</button><a href="/">Link</a>');

  const locator = resolvePrimaryLocator(page, { type: 'role', role: 'button' });

  await expect(locator).toHaveCount(2);
});

test('label locator resolves an exactly associated control', async ({ page }) => {
  await page.setContent(
    '<label for="email">Email</label><input id="email"><label>Email updates<input></label>',
  );

  const locator = resolvePrimaryLocator(page, { type: 'label', value: 'Email', exact: true });

  await expect(locator).toHaveCount(1);
  await expect(locator).toHaveId('email');
});

test('label locator preserves partial matching when exact is omitted', async ({ page }) => {
  await page.setContent('<label>Billing email<input id="billing"></label>');

  const locator = resolvePrimaryLocator(page, { type: 'label', value: 'email' });

  await expect(locator).toHaveId('billing');
});

test('test-id locator resolves the configured Playwright test-id contract', async ({ page }) => {
  await page.setContent('<button data-testid="submit-order">Submit</button>');

  const locator = resolvePrimaryLocator(page, { type: 'testId', value: 'submit-order' });

  await expect(locator).toHaveText('Submit');
});

test('text locator honors exact matching', async ({ page }) => {
  await page.setContent('<span>Apply</span><span>Apply discount</span>');

  const locator = resolvePrimaryLocator(page, { type: 'text', value: 'Apply', exact: true });

  await expect(locator).toHaveCount(1);
  await expect(locator).toHaveText('Apply');
});

test('text locator preserves partial matching when exact is omitted', async ({ page }) => {
  await page.setContent('<span>Apply</span><span>Apply discount</span>');

  const locator = resolvePrimaryLocator(page, { type: 'text', value: 'Apply' });

  await expect(locator).toHaveCount(2);
});

test('CSS locator supports a scoped explicit selector', async ({ page }) => {
  await page.setContent(
    '<section data-area="checkout"><button class="submit">Order</button></section><button class="submit">Other</button>',
  );

  const locator = resolvePrimaryLocator(page, {
    type: 'css',
    value: '[data-area="checkout"] > button.submit',
  });

  await expect(locator).toHaveCount(1);
  await expect(locator).toHaveText('Order');
});

test('resolved locators remain live across a DOM replacement', async ({ page }) => {
  await page.setContent('<button data-version="1">Continue</button>');
  const locator = resolvePrimaryLocator(page, {
    type: 'role',
    role: 'button',
    name: 'Continue',
    exact: true,
  });

  await page.setContent('<button data-version="2">Continue</button>');

  await expect(locator).toHaveAttribute('data-version', '2');
});
