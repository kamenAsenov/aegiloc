import { expect, test } from '@playwright/test';

import { collectCandidates } from '../src/index.js';

test('collects public-API semantic and context signals from the live page', async ({ page }) => {
  await page.goto('/');

  const candidates = await collectCandidates(page, 'click');
  const placeOrder = candidates.find((candidate) => candidate.accessibleName === 'Place order');

  expect(placeOrder).toMatchObject({
    role: 'button',
    accessibleName: 'Place order',
    visibleText: 'Place order',
    tag: 'button',
    stableAttributes: {
      'data-target': 'place-order',
      type: 'submit',
    },
  });
  expect(placeOrder?.ancestorText).toContain('Checkout');
  expect(placeOrder?.geometry?.x).toBeGreaterThan(0);
  expect(placeOrder?.geometry?.y).toBeGreaterThan(0);
});

test('limits candidates to elements compatible with the requested action', async ({ page }) => {
  await page.goto('/');

  const fillCandidates = await collectCandidates(page, 'fill');
  const selectCandidates = await collectCandidates(page, 'selectOption');

  expect(fillCandidates.map((candidate) => candidate.accessibleName)).toContain('Cardholder name');
  expect(fillCandidates.every((candidate) => candidate.tag !== 'button')).toBe(true);
  expect(selectCandidates).toHaveLength(1);
  expect(selectCandidates[0]).toMatchObject({
    role: 'combobox',
    accessibleName: 'Shipping country',
    tag: 'select',
  });
});
