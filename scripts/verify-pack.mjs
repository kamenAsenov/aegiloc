import { spawnSync } from 'node:child_process';

const pnpmExecutable = process.env.npm_execpath;
const command = pnpmExecutable === undefined ? 'pnpm' : process.execPath;
const args = [
  ...(pnpmExecutable === undefined ? [] : [pnpmExecutable]),
  'pack',
  '--dry-run',
  '--json',
];
const result = spawnSync(command, args, {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  throw new Error(`pnpm pack --dry-run --json failed with exit ${String(result.status)}`);
}

const jsonStart = result.stdout.indexOf('{\n  "name"');
if (jsonStart === -1) {
  throw new Error('pnpm pack --dry-run --json did not produce a readable manifest');
}

const manifest = JSON.parse(result.stdout.slice(jsonStart));
if (manifest.name !== 'healwright' || manifest.version !== '0.6.0') {
  throw new Error('Pack manifest identity does not match the reviewed package');
}

const paths = new Set(manifest.files?.map((file) => file.path));
const requiredPaths = [
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'dist/index.js',
  'dist/cli.js',
  'dist/cli.d.ts',
  'docs/CLI.md',
  'docs/REPORT-VIEWER.md',
  'docs/ARCHITECTURE.md',
  'docs/releases/v0.6.0.md',
  'examples/basic-playwright/playwright.config.ts',
  'examples/basic-playwright/tests/checkout.spec.ts',
  'examples/realistic-demo/tests/storefront.spec.ts',
  'registry/targets.schema.json',
  'scripts/guard-publish.mjs',
];
for (const path of requiredPaths) {
  if (!paths.has(path)) {
    throw new Error(`Pack manifest is missing required file "${path}"`);
  }
}

const forbiddenPath = [...paths].find(
  (path) =>
    path.includes('node_modules/') ||
    path.includes('playwright-report/') ||
    path.includes('test-results/') ||
    path.endsWith('.log') ||
    path.includes('.env'),
);
if (forbiddenPath !== undefined) {
  throw new Error(`Pack manifest contains generated or sensitive path "${forbiddenPath}"`);
}

process.stdout.write(
  `Verified ${String(paths.size)} dry-run package file(s); no package was created or published.\n`,
);
