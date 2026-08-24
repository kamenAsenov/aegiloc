import { expect, test } from '@playwright/test';

import { collectCandidates, collectLocatorSuggestions } from '../src/index.js';

test('ranks only live locator strategies and records uniqueness evidence', async ({ page }) => {
  await page.setContent(`
    <button data-testid="safe-submit">Submit</button>
    <button>Submit</button>
  `);
  const candidates = await collectCandidates(page, 'click');
  const candidate = candidates.find(
    (item) => item.stableAttributes['data-testid'] === 'safe-submit',
  );
  expect(candidate).toBeDefined();
  if (candidate === undefined) return;

  const suggestions = await collectLocatorSuggestions(page, candidate);

  expect(suggestions[0]).toMatchObject({
    strategy: 'testId',
    locator: { type: 'testId', value: 'safe-submit' },
    matchCount: 1,
    matchesCandidate: true,
  });
  expect(suggestions.find((item) => item.strategy === 'role')).toMatchObject({
    matchCount: 2,
    matchesCandidate: false,
  });
  expect(suggestions.find((item) => item.strategy === 'css')).toMatchObject({
    matchCount: 1,
    matchesCandidate: true,
  });
});

test('discovers label and placeholder strategies for a unique scoped field', async ({ page }) => {
  await page.setContent(`
    <section data-area="billing">
      <label for="email">Billing email</label>
      <input id="email" placeholder="name@example.com">
    </section>
  `);
  const options = {
    targetKey: 'billing.email',
    context: { container: { type: 'css' as const, value: '[data-area="billing"]' } },
  };
  const [candidate] = await collectCandidates(page, 'fill', options);
  expect(candidate).toBeDefined();
  if (candidate === undefined) return;

  const suggestions = await collectLocatorSuggestions(page, candidate, options);
  expect(suggestions.filter((item) => item.matchesCandidate).map((item) => item.strategy)).toEqual(
    expect.arrayContaining(['role', 'label', 'placeholder', 'css']),
  );
});
