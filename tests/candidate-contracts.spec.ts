import { expect, test } from '@playwright/test';

import { collectCandidates, parseAriaIdentity } from '../src/index.js';

test('parses escaped accessible names from ARIA snapshots', () => {
  expect(parseAriaIdentity('- button "Say \\"hello\\""')).toEqual({
    role: 'button',
    accessibleName: 'Say "hello"',
  });
});

test('parses roles that have no accessible name', () => {
  expect(parseAriaIdentity('- checkbox')).toEqual({ role: 'checkbox' });
});

test('ignores malformed ARIA snapshot content', () => {
  expect(parseAriaIdentity('not an aria snapshot')).toEqual({});
  expect(parseAriaIdentity('')).toEqual({});
});

test('excludes display-none, visibility-hidden, and zero-size candidates', async ({ page }) => {
  await page.setContent(`
    <button style="display:none">Display hidden</button>
    <button style="visibility:hidden">Visibility hidden</button>
    <button style="display:block;width:0;height:0;padding:0;border:0;overflow:hidden">Zero size</button>
    <button>Visible</button>
  `);

  const candidates = await collectCandidates(page, 'click');

  expect(candidates.map((candidate) => candidate.accessibleName)).toEqual(['Visible']);
});

test('captures only allowlisted stable attributes and caps audited text', async ({ page }) => {
  await page.setContent(`
    <button
      id="dom-id"
      name="submit"
      type="button"
      title="Submit order"
      data-testid="contract-id"
      data-target="checkout-submit"
      data-secret="must-not-be-collected"
      class="volatile-class"
      value="volatile-value"
    >${'X'.repeat(300)}</button>
  `);

  const [snapshot] = await collectCandidates(page, 'click');

  expect(snapshot?.id).toBe('button:contract-id:0');
  expect(snapshot?.visibleText).toHaveLength(240);
  expect(snapshot?.stableAttributes).toMatchObject({
    id: 'dom-id',
    name: 'submit',
    type: 'button',
    title: 'Submit order',
    'data-testid': 'contract-id',
    'data-target': 'checkout-submit',
  });
  expect(snapshot?.stableAttributes).not.toHaveProperty('data-secret');
  expect(snapshot?.stableAttributes).not.toHaveProperty('class');
  expect(snapshot?.stableAttributes).not.toHaveProperty('value');
});

test('normalizes link attributes to pathnames without query secrets', async ({ page }) => {
  await page.setContent(
    '<a href="https://example.test/orders/42?token=secret#receipt">Order details</a>',
  );

  const [snapshot] = await collectCandidates(page, 'click');

  expect(snapshot?.stableAttributes.href).toBe('/orders/42');
  expect(JSON.stringify(snapshot)).not.toContain('token=secret');
});

test('collects checkbox, radio, and switch candidates only for check actions', async ({ page }) => {
  await page.setContent(`
    <label><input type="checkbox">Terms</label>
    <label><input type="radio" name="plan">Pro plan</label>
    <button role="switch" aria-label="Notifications">Toggle</button>
    <button>Unrelated</button>
  `);

  const candidates = await collectCandidates(page, 'check');

  expect(candidates.map((candidate) => candidate.role)).toEqual(['checkbox', 'radio', 'switch']);
});

test('collects native and ARIA-editable candidates for fill actions', async ({ page }) => {
  await page.setContent(`
    <label>Name<input type="text"></label>
    <label>Notes<textarea></textarea></label>
    <div role="textbox" aria-label="Biography" contenteditable="true"></div>
    <button>Unrelated</button>
  `);

  const candidates = await collectCandidates(page, 'fill');

  expect(candidates.map((candidate) => candidate.accessibleName)).toEqual([
    'Name',
    'Notes',
    'Biography',
  ]);
});

test('limits and orders nested ancestor context from nearest to farthest', async ({ page }) => {
  await page.setContent(`
    <section aria-label="Level 4">
      <section aria-label="Level 3">
        <section aria-label="Level 2">
          <section aria-label="Level 1"><button>Submit</button></section>
        </section>
      </section>
    </section>
  `);

  const [snapshot] = await collectCandidates(page, 'click');

  expect(snapshot?.ancestorText).toEqual(['Level 1', 'Level 2', 'Level 3']);
});

test('captures immediate previous and next sibling text as neighbor context', async ({ page }) => {
  await page.setContent(`
    <div>
      <span>Order total €42</span>
      <button>Place order</button>
      <span>Secure checkout</span>
    </div>
  `);

  const [snapshot] = await collectCandidates(page, 'click');

  expect(snapshot?.neighborText).toEqual(['Order total €42', 'Secure checkout']);
});
