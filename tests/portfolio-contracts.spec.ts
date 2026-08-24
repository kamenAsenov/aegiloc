import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { loadTargetRegistry } from '../src/index.js';

test('portfolio entry points remain concise, honest, and connected to deeper docs', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const readmeLines = readme.split('\n').length;

  expect(readmeLines).toBeLessThan(250);
  expect(readme).toContain('v1.0.1 is a stable-API evaluation release');
  expect(readme).toMatch(/a false-positive heal is worse than a failed heal/i);
  expect(readme).toContain('examples/basic-playwright');
  expect(readme).toContain('examples/realistic-demo');
  expect(readme).toContain('docs/assets/healwright-report-v1.png');
  expect(readme).toContain('docs/COMPATIBILITY.md');
  expect(readme).toContain('api/public-api.json');
  expect(readme).toContain('docs/ARCHITECTURE.md');
  expect(readme).toContain('docs/SAFETY-MODEL.md');
  expect(readme).toContain('not a claim of production adoption');
  expect(readme).toContain('occupied by an unrelated project');
  expect(readme).not.toMatch(/enterprise-ready|enterprise-grade|trusted by|used by \d+/i);
});

test('package metadata is ready for review but publication remains explicitly guarded', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    private?: boolean;
    version?: string;
    bin?: Record<string, string>;
    license?: string;
    repository?: { url?: string };
    scripts?: Record<string, string>;
  };

  expect(packageJson.private).toBe(false);
  expect(packageJson.version).toBe('1.0.1');
  expect(packageJson.bin?.healwright).toBe('./dist/cli.js');
  expect(packageJson.license).toBe('MIT');
  expect(packageJson.repository?.url).toBe('git+https://github.com/kamenAsenov/healwright.git');
  expect(packageJson.scripts?.['prepublishOnly']).toContain('scripts/guard-publish.mjs');
  expect(packageJson.scripts?.['release:check']).toContain('pnpm example:verify');
  expect(packageJson.scripts?.['release:check']).toContain('pnpm example:realistic');
  expect(packageJson.scripts?.['release:check']).toContain('pnpm package:reproducible');
  expect(packageJson.scripts?.['release:check']).toContain('pnpm test:cross-browser');
  expect(packageJson.scripts?.['release:check']).toContain('pnpm evidence:manifest:verify');
  expect(packageJson.scripts?.['release:check']).toContain('pnpm api:snapshot:check');
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
  expect(workflow).toContain('run: pnpm example:realistic');
  expect(workflow).toContain('run: pnpm test:cross-browser');
  expect(workflow).toContain('run: pnpm evidence:manifest:verify');
});

test('type-aware example linting resolves public imports before the package build exists', async () => {
  const lintProject = JSON.parse(
    await readFile(
      new URL('../examples/basic-playwright/tsconfig.eslint.json', import.meta.url),
      'utf8',
    ),
  ) as { compilerOptions?: { paths?: Record<string, readonly string[]> } };
  const eslintConfig = await readFile(new URL('../eslint.config.mjs', import.meta.url), 'utf8');

  expect(lintProject.compilerOptions?.paths).toEqual({
    healwright: ['src/index.ts'],
    'healwright/reporter': ['src/reporter.ts'],
  });
  expect(eslintConfig).toContain("project: './examples/basic-playwright/tsconfig.eslint.json'");
  expect(eslintConfig).toContain("project: './examples/realistic-demo/tsconfig.eslint.json'");
  expect(eslintConfig).toContain('projectService: false');
});

test('cross-browser timing and performance qualification is serialized in every environment', async () => {
  const config = await readFile(
    new URL('../playwright.cross-browser.config.ts', import.meta.url),
    'utf8',
  );

  expect(config).toContain('workers: 1');
  expect(config).not.toContain('process.env.CI ? { workers: 1 }');
});
