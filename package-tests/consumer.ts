import type { Page } from '@playwright/test';
import {
  InMemoryAuditSink,
  NoopHealingResultSink,
  createHealer,
  type TargetRegistry,
} from 'healwright';
import HealwrightReporter, { healingStatusLines } from 'healwright/reporter';

declare const page: Page;

const registry = {
  version: 1,
  defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
  targets: {
    'checkout.submit': {
      description: 'Submit checkout',
      primary: { type: 'role', role: 'button', name: 'Submit', exact: true },
      fingerprint: { accessibleRole: 'button', accessibleName: 'Submit', tag: 'button' },
      policy: {
        allowedActions: ['click'],
        healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
      },
    },
  },
} as const satisfies TargetRegistry<'checkout.submit'>;

const healer = createHealer({
  page,
  registry,
  mode: 'guarded',
  auditSink: new InMemoryAuditSink(),
  resultSink: new NoopHealingResultSink(),
});

const target = healer.target('checkout.submit');
void target.click;
void HealwrightReporter;
void healingStatusLines;
