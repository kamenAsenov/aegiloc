import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

test('CI fails on the provider-neutral governance gate and retains health artifacts', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const gateIndex = workflow.indexOf('run: pnpm governance:evaluate');
  const uploadIndex = workflow.indexOf('name: Upload Aegiloc evidence');

  expect(gateIndex).toBeGreaterThan(-1);
  expect(uploadIndex).toBeGreaterThan(gateIndex);
  expect(workflow).not.toMatch(/governance:evaluate[\s\S]{0,120}continue-on-error:\s*true/);
  expect(workflow).toContain('test-results/aegiloc/');
  expect(workflow).toContain('governance/policy.json');
});
