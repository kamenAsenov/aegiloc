import { expect, test } from '@playwright/test';

import {
  InMemoryAuditSink,
  collectCandidates,
  createHealer,
  type TargetContextError,
  type TargetRegistry,
} from '../src/index.js';

const policy = {
  allowedActions: ['click'] as const,
  healing: { enabled: true, confidenceThreshold: 0.8, minimumScoreMargin: 0.15 },
};

test('candidate collection stays inside a unique container', async ({ page }) => {
  await page.setContent(`
    <button>Outside action</button>
    <section data-area="checkout"><button>Inside action</button></section>
  `);

  const candidates = await collectCandidates(page, 'click', {
    targetKey: 'checkout.action',
    context: { container: { type: 'css', value: '[data-area="checkout"]' } },
  });

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.accessibleName).toBe('Inside action');
});

test('primary locator and healing candidates share the same iframe and container scope', async ({
  page,
}) => {
  await page.setContent(`
    <button>Outside replacement</button>
    <iframe title="Payment frame" srcdoc='<section data-area="payment"><button>Confirm payment</button></section>'></iframe>
  `);
  const registry: TargetRegistry<'payment.confirm'> = {
    version: 1,
    defaults: { confidenceThreshold: 0.8, minimumScoreMargin: 0.15 },
    targets: {
      'payment.confirm': {
        description: 'Confirm payment',
        context: {
          frame: { type: 'title', value: 'Payment frame', exact: true },
          container: { type: 'css', value: '[data-area="payment"]' },
        },
        primary: { type: 'testId', value: 'missing-confirm-payment' },
        fingerprint: {
          accessibleRole: 'button',
          accessibleName: 'Confirm payment',
          visibleText: 'Confirm payment',
          tag: 'button',
        },
        policy,
      },
    },
  };
  const auditSink = new InMemoryAuditSink();
  const healer = createHealer({ page, registry, auditSink, primaryActionTimeoutMs: 500 });

  await healer.target('payment.confirm').click();

  await expect(page.getByRole('button', { name: 'Outside replacement' })).toBeVisible();
  expect(auditSink.events.map((event) => event.eventType)).toEqual([
    'locator-drift-assessed',
    'locator-heal-execution',
  ]);
});

test('ambiguous container fails before assessment and never executes', async ({ page }) => {
  await page.setContent(`
    <section data-area="checkout"><button>Submit</button></section>
    <section data-area="checkout"><button>Submit</button></section>
  `);
  const auditSink = new InMemoryAuditSink();
  const registry: TargetRegistry<'checkout.submit'> = {
    version: 1,
    defaults: { confidenceThreshold: 0.8, minimumScoreMargin: 0.15 },
    targets: {
      'checkout.submit': {
        description: 'Checkout submit',
        context: { container: { type: 'css', value: '[data-area="checkout"]' } },
        primary: { type: 'role', role: 'button', name: 'Submit', exact: true },
        fingerprint: { accessibleRole: 'button', accessibleName: 'Submit', tag: 'button' },
        policy,
      },
    },
  };

  const healer = createHealer({ page, registry, auditSink, primaryActionTimeoutMs: 50 });
  await expect(healer.target('checkout.submit').click()).rejects.toMatchObject({
    name: 'TargetContextError',
    failure: 'container-ambiguous',
  } satisfies Partial<TargetContextError>);
  expect(auditSink.events).toEqual([]);
});

test('pathname mismatch is a context failure, never locator drift', async ({ page }) => {
  await page.setContent('<button>Submit</button>');
  const auditSink = new InMemoryAuditSink();
  const registry: TargetRegistry<'checkout.submit'> = {
    version: 1,
    defaults: { confidenceThreshold: 0.8, minimumScoreMargin: 0.15 },
    targets: {
      'checkout.submit': {
        description: 'Checkout submit',
        context: { pathname: '/checkout' },
        primary: { type: 'role', role: 'button', name: 'Submit', exact: true },
        fingerprint: { accessibleRole: 'button', accessibleName: 'Submit', tag: 'button' },
        policy,
      },
    },
  };

  const healer = createHealer({ page, registry, auditSink, primaryActionTimeoutMs: 50 });
  await expect(healer.target('checkout.submit').click()).rejects.toMatchObject({
    name: 'TargetContextError',
    failure: 'pathname-mismatch',
  } satisfies Partial<TargetContextError>);
  expect(auditSink.events).toEqual([]);
});

test('custom test-id attributes participate in deterministic candidate identity', async ({
  page,
}) => {
  await page.setContent('<button data-qa-id="checkout-submit">Submit</button>');

  const [candidate] = await collectCandidates(page, 'click', {
    testIdAttribute: 'data-qa-id',
  });

  expect(candidate?.id).toContain('checkout-submit');
  expect(candidate?.stableAttributes['data-qa-id']).toBe('checkout-submit');
});

test('uncheck, hover, and focus preserve the ordinary primary-locator path', async ({ page }) => {
  await page.setContent(`
    <label><input id="newsletter" type="checkbox" checked> Newsletter</label>
    <button id="details" onmouseover="this.dataset.hovered='yes'">Details</button>
    <input id="email" placeholder="Email">
  `);
  const registry: TargetRegistry<'newsletter' | 'details' | 'email'> = {
    version: 1,
    defaults: { confidenceThreshold: 0.8, minimumScoreMargin: 0.15 },
    targets: {
      newsletter: {
        description: 'Newsletter',
        primary: { type: 'css', value: '#newsletter' },
        fingerprint: { accessibleRole: 'checkbox', accessibleName: 'Newsletter', tag: 'input' },
        policy: { ...policy, allowedActions: ['uncheck'] },
      },
      details: {
        description: 'Details',
        primary: { type: 'role', role: 'button', name: 'Details', exact: true },
        fingerprint: { accessibleRole: 'button', accessibleName: 'Details', tag: 'button' },
        policy: { ...policy, allowedActions: ['hover'] },
      },
      email: {
        description: 'Email',
        primary: { type: 'placeholder', value: 'Email', exact: true },
        fingerprint: { accessibleRole: 'textbox', accessibleName: 'Email', tag: 'input' },
        policy: { ...policy, allowedActions: ['focus'] },
      },
    },
  };
  const healer = createHealer({ page, registry, mode: 'off' });

  await healer.target('newsletter').uncheck();
  await healer.target('details').hover();
  await healer.target('email').focus();

  await expect(page.locator('#newsletter')).not.toBeChecked();
  await expect(page.locator('#details')).toHaveAttribute('data-hovered', 'yes');
  await expect(page.locator('#email')).toBeFocused();
});

test('guarded healing supports uncheck after genuine locator drift', async ({ page }) => {
  await page.setContent(
    '<label><input name="newsletter" type="checkbox" checked> Newsletter</label>',
  );
  const auditSink = new InMemoryAuditSink();
  const registry: TargetRegistry<'newsletter'> = {
    version: 1,
    defaults: { confidenceThreshold: 0.8, minimumScoreMargin: 0.15 },
    targets: {
      newsletter: {
        description: 'Newsletter',
        primary: { type: 'testId', value: 'missing-newsletter' },
        fingerprint: {
          accessibleRole: 'checkbox',
          accessibleName: 'Newsletter',
          tag: 'input',
          stableAttributes: { name: 'newsletter', type: 'checkbox' },
        },
        policy: { ...policy, allowedActions: ['uncheck'] },
      },
    },
  };
  const healer = createHealer({ page, registry, auditSink, primaryActionTimeoutMs: 300 });

  await healer.target('newsletter').uncheck();

  await expect(page.getByRole('checkbox', { name: 'Newsletter' })).not.toBeChecked();
  expect(auditSink.events.at(-1)).toMatchObject({
    eventType: 'locator-heal-execution',
    status: 'succeeded',
  });
});

test('guarded healing supports hover after genuine locator drift', async ({ page }) => {
  await page.setContent(
    '<button data-testid="details-v2" onmouseover="this.dataset.hovered=\'yes\'">Details</button>',
  );
  const auditSink = new InMemoryAuditSink();
  const registry: TargetRegistry<'details'> = {
    version: 1,
    defaults: { confidenceThreshold: 0.8, minimumScoreMargin: 0.15 },
    targets: {
      details: {
        description: 'Details',
        primary: { type: 'testId', value: 'missing-details' },
        fingerprint: {
          accessibleRole: 'button',
          accessibleName: 'Details',
          visibleText: 'Details',
          tag: 'button',
          stableAttributes: { 'data-testid': 'details-v2' },
        },
        policy: { ...policy, allowedActions: ['hover'] },
      },
    },
  };
  const healer = createHealer({ page, registry, auditSink, primaryActionTimeoutMs: 300 });

  await healer.target('details').hover();

  await expect(page.getByRole('button', { name: 'Details' })).toHaveAttribute(
    'data-hovered',
    'yes',
  );
  expect(auditSink.events.at(-1)).toMatchObject({
    eventType: 'locator-heal-execution',
    status: 'succeeded',
  });
});

test('guarded healing supports focus after genuine locator drift', async ({ page }) => {
  await page.setContent('<label>Email <input name="email"></label>');
  const auditSink = new InMemoryAuditSink();
  const registry: TargetRegistry<'email'> = {
    version: 1,
    defaults: { confidenceThreshold: 0.8, minimumScoreMargin: 0.15 },
    targets: {
      email: {
        description: 'Email',
        primary: { type: 'testId', value: 'missing-email' },
        fingerprint: {
          accessibleRole: 'textbox',
          accessibleName: 'Email',
          tag: 'input',
          stableAttributes: { name: 'email' },
        },
        policy: { ...policy, allowedActions: ['focus'] },
      },
    },
  };
  const healer = createHealer({ page, registry, auditSink, primaryActionTimeoutMs: 300 });

  await healer.target('email').focus();

  await expect(page.getByRole('textbox', { name: 'Email' })).toBeFocused();
  expect(auditSink.events.at(-1)).toMatchObject({
    eventType: 'locator-heal-execution',
    status: 'succeeded',
  });
});
