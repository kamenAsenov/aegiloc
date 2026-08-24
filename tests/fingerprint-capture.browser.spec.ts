import { expect, test } from '@playwright/test';

import {
  InMemoryFingerprintObservationSink,
  createHealer,
  type TargetRegistry,
} from '../src/index.js';

const registry = {
  version: 1,
  defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
  targets: {
    continue: {
      description: 'Continue',
      primary: { type: 'role', role: 'button', name: 'Continue', exact: true },
      fingerprint: { accessibleRole: 'button', accessibleName: 'Continue', tag: 'button' },
      policy: {
        allowedActions: ['click'],
        healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
      },
    },
  },
} as const satisfies TargetRegistry;

test('records an opt-in fingerprint only after the primary action succeeds', async ({ page }) => {
  await page.setContent('<button data-testid="continue">Continue</button>');
  const sink = new InMemoryFingerprintObservationSink();
  const healer = createHealer({
    page,
    registry,
    mode: 'off',
    auditProvenance: {
      runId: 'capture-run',
      testId: 'capture test',
      projectName: 'chromium',
      retry: 0,
    },
    fingerprintObservation: { enabled: true, sink },
  });

  await healer.target('continue').click();

  expect(sink.observations).toHaveLength(1);
  expect(sink.observations[0]).toMatchObject({
    eventType: 'primary-fingerprint-observed',
    targetKey: 'continue',
    fingerprint: {
      accessibleRole: 'button',
      accessibleName: 'Continue',
      stableAttributes: { 'data-testid': 'continue' },
      tag: 'button',
    },
  });
});

test('does not record a fingerprint when the ordinary action fails', async ({ page }) => {
  await page.setContent('<button disabled>Continue</button>');
  const sink = new InMemoryFingerprintObservationSink();
  const healer = createHealer({
    page,
    registry,
    mode: 'off',
    fingerprintObservation: { enabled: true, sink },
  });

  await expect(healer.target('continue').click({ timeout: 50 })).rejects.toThrow();
  expect(sink.observations).toEqual([]);
});
