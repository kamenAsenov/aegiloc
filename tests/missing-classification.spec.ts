import { errors, expect, test } from '@playwright/test';

import { MissingPrimaryLocatorError, createHealer, loadTargetRegistry } from '../src/index.js';

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('Expected promise to reject');
}

test('classifies a genuinely absent primary locator', async ({ page }) => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const healer = createHealer({ page, registry, primaryActionTimeoutMs: 300 });

  await page.goto('/?mutation=missing-place-order');

  const error = await captureError(healer.target('checkout.placeOrder').click());
  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
});

test('preserves normal waiting when the primary locator appears later', async ({ page }) => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const healer = createHealer({ page, registry, primaryActionTimeoutMs: 500 });

  await page.goto('/?mutation=delayed-place-order');

  await healer.target('checkout.placeOrder').click();
});

test('does not classify a disabled element as locator drift', async ({ page }) => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const healer = createHealer({ page, registry, primaryActionTimeoutMs: 300 });

  await page.goto('/?mutation=disabled-place-order');

  const error = await captureError(healer.target('checkout.placeOrder').click());
  expect(error).toBeInstanceOf(errors.TimeoutError);
  expect(error).not.toBeInstanceOf(MissingPrimaryLocatorError);
});

test('does not classify a target that detaches after being observed', async ({ page }) => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const healer = createHealer({ page, registry, primaryActionTimeoutMs: 300 });

  await page.goto('/?mutation=detached-place-order');

  const error = await captureError(healer.target('checkout.placeOrder').click());
  expect(error).toBeInstanceOf(errors.TimeoutError);
  expect(error).not.toBeInstanceOf(MissingPrimaryLocatorError);
});

test('does not classify an ambiguous locator as drift', async ({ page }) => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const healer = createHealer({ page, registry, primaryActionTimeoutMs: 300 });

  await page.goto('/?mutation=duplicate-place-order');

  const error = await captureError(healer.target('checkout.placeOrder').click());
  expect(error).not.toBeInstanceOf(MissingPrimaryLocatorError);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain('strict mode violation');
});
