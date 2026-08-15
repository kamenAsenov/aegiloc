import { errors, expect, test } from '@playwright/test';

import {
  MissingPrimaryLocatorError,
  executePrimaryAction,
  type PrimaryLocatorProbe,
} from '../src/index.js';

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('Expected promise to reject');
}

function createProbe(
  attachmentResult: 'attached' | 'timeout',
  finalCount: number,
): PrimaryLocatorProbe {
  return {
    waitFor: () =>
      attachmentResult === 'attached'
        ? Promise.resolve()
        : Promise.reject(new errors.TimeoutError('attachment timeout')),
    count: () => Promise.resolve(finalCount),
  };
}

test('classifies only a timed-out target that was never attached and remains absent', async () => {
  const primaryError = new errors.TimeoutError('primary action timeout');
  const error = await captureError(
    executePrimaryAction({
      targetKey: 'checkout.placeOrder',
      action: 'click',
      locator: createProbe('timeout', 0),
      timeoutMs: 100,
      invoke: () => Promise.reject(primaryError),
    }),
  );

  expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
  expect((error as MissingPrimaryLocatorError).cause).toBe(primaryError);
});

test('preserves the original timeout when the target was observed attached', async () => {
  const primaryError = new errors.TimeoutError('actionability timeout');
  const error = await captureError(
    executePrimaryAction({
      targetKey: 'checkout.placeOrder',
      action: 'click',
      locator: createProbe('attached', 0),
      timeoutMs: 100,
      invoke: () => Promise.reject(primaryError),
    }),
  );

  expect(error).toBe(primaryError);
});

test('preserves non-timeout failures without classifying drift', async () => {
  const primaryError = new Error('strict mode violation');
  const error = await captureError(
    executePrimaryAction({
      targetKey: 'checkout.placeOrder',
      action: 'click',
      locator: createProbe('attached', 2),
      timeoutMs: 100,
      invoke: () => Promise.reject(primaryError),
    }),
  );

  expect(error).toBe(primaryError);
});
