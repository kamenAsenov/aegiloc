import { errors, expect, test } from '@playwright/test';

import {
  InMemoryAuditSink,
  MissingPrimaryLocatorError,
  createHealer,
  loadTargetRegistry,
  type AuditModeDecision,
  type HealingMode,
} from '../src/index.js';

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('Expected promise to reject');
}

test('off mode runs only the primary action and emits no audit event', async ({ page }) => {
  const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
  const auditSink = new InMemoryAuditSink();
  const healer = createHealer({
    page,
    registry,
    mode: 'off',
    auditSink,
    primaryActionTimeoutMs: 300,
  });

  await page.goto('/?mutation=drifted-terms');

  const error = await captureError(healer.target('checkout.terms').check());
  expect(error).toBeInstanceOf(errors.TimeoutError);
  expect(error).not.toBeInstanceOf(MissingPrimaryLocatorError);
  expect(auditSink.events).toHaveLength(0);
});

const assessedModes: readonly [HealingMode, AuditModeDecision][] = [
  ['observe', 'observed'],
  ['guarded', 'eligible'],
  ['strict-ci', 'strict-ci-failure'],
];

for (const [mode, expectedDecision] of assessedModes) {
  test(`${mode} mode assesses drift, audits it, and does not execute the candidate`, async ({
    page,
  }) => {
    const registry = await loadTargetRegistry(new URL('../registry/targets.json', import.meta.url));
    const auditSink = new InMemoryAuditSink();
    const healer = createHealer({
      page,
      registry,
      mode,
      auditSink,
      primaryActionTimeoutMs: 300,
    });

    await page.goto('/?mutation=drifted-terms');

    const error = await captureError(healer.target('checkout.terms').check());
    expect(error).toBeInstanceOf(MissingPrimaryLocatorError);
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    expect(auditSink.events).toHaveLength(1);
    expect(auditSink.events[0]).toMatchObject({
      mode,
      modeDecision: expectedDecision,
      targetKey: 'checkout.terms',
      action: 'check',
      assessment: { eligible: true, reason: 'eligible' },
      collection: { status: 'completed' },
    });
  });
}
