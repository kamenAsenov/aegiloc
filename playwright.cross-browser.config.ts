import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: [
    'baseline.spec.ts',
    'candidate-collection.spec.ts',
    'candidate-contracts.spec.ts',
    'candidate-performance.spec.ts',
    'execution-risk.browser.spec.ts',
    'healing.browser.spec.ts',
    'healing-adversarial.browser.spec.ts',
    'locator-contracts.spec.ts',
    'missing-classification.spec.ts',
    'modes.browser.spec.ts',
    'primary-wrapper.spec.ts',
  ],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'node scripts/serve-fixture.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
