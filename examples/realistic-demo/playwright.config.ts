import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const healwrightReporter = fileURLToPath(import.meta.resolve('healwright/reporter'));

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['line'],
    [healwrightReporter, { outputDirectory: 'test-results/realistic-demo/evidence' }],
    [
      'html',
      {
        open: 'never',
        outputFolder: fileURLToPath(
          new URL('../../playwright-report/realistic-demo', import.meta.url),
        ),
      },
    ],
  ],
  outputDir: fileURLToPath(new URL('../../test-results/realistic-demo/results', import.meta.url)),
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
