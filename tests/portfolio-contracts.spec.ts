import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { loadTargetRegistry } from '../src/index.js';

test('portfolio entry points remain concise, honest, and connected to deeper docs', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const readmeLines = readme.split('\n').length;

  expect(readmeLines).toBeLessThan(250);
  expect(readme).toContain('experimental · pre-1.0');
  expect(readme).toContain('a false-positive heal is worse than a failed heal');
  expect(readme).toContain('examples/basic-playwright');
  expect(readme).toContain('docs/ARCHITECTURE.md');
  expect(readme).toContain('docs/SAFETY-MODEL.md');
  expect(readme).toContain('not proven production adoption');
  expect(readme).not.toMatch(/production-ready|enterprise-ready|trusted by|used by \d+/i);
});

test('package metadata is ready for review but publication remains explicitly guarded', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    private?: boolean;
    license?: string;
    repository?: { url?: string };
    scripts?: Record<string, string>;
  };

  expect(packageJson.private).toBe(false);
  expect(packageJson.license).toBe('MIT');
  expect(packageJson.repository?.url).toBe('git+https://github.com/kamenAsenov/healwright.git');
  expect(packageJson.scripts?.['prepublishOnly']).toContain('scripts/guard-publish.mjs');
  expect(packageJson.scripts?.['release:check']).toContain('pnpm example:verify');
  expect(packageJson.scripts).not.toHaveProperty('publish');
});

test('basic example uses a valid automatic target and is enforced by CI', async () => {
  const registry = await loadTargetRegistry(
    new URL('../examples/basic-playwright/targets.json', import.meta.url),
  );
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

  expect(registry.targets['checkout.applyDiscount']).toMatchObject({
    policy: {
      allowedActions: ['click'],
      executionRisk: 'automatic',
    },
  });
  expect(workflow).toContain('run: pnpm example:verify');
});
