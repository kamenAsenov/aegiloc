import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const aegilocReporter = fileURLToPath(import.meta.resolve('aegiloc/reporter'));
const reportOutput = fileURLToPath(
  new URL('../../playwright-report/basic-playwright', import.meta.url),
);
const testOutput = fileURLToPath(
  new URL('../../test-results/basic-playwright/results', import.meta.url),
);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  reporter: [
    ['line'],
    [aegilocReporter, { outputDirectory: 'test-results/basic-playwright/evidence' }],
    ['html', { open: 'never', outputFolder: reportOutput }],
  ],
  outputDir: testOutput,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node scripts/serve-fixture.mjs',
    cwd: repositoryRoot,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
