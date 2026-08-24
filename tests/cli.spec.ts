import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { parseCliArguments, runCli, type CliIo } from '../src/cli-core.js';
import {
  createAuditEvidenceSummary,
  serializeAuditHistory,
  writeAuditEvidence,
  writeEvidenceManifest,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

function captureIo(): { readonly io: CliIo; output: string; errors: string } {
  const capture = {
    output: '',
    errors: '',
    io: {
      stdout(message: string) {
        capture.output += message;
      },
      stderr(message: string) {
        capture.errors += message;
      },
    },
  };
  return capture;
}

test('parses the documented commands and rejects incomplete integrity options', () => {
  expect(parseCliArguments(['demo', '--force', '--open'])).toEqual({
    command: 'demo',
    force: true,
    open: true,
  });
  expect(parseCliArguments(['init', '--registry', 'targets.json', '--force'])).toEqual({
    command: 'init',
    registryPath: 'targets.json',
    force: true,
  });
  expect(parseCliArguments(['validate', '--registry', 'targets.json'])).toEqual({
    command: 'validate',
    registryPath: 'targets.json',
  });
  expect(
    parseCliArguments([
      'attest',
      '--history',
      'history.jsonl',
      '--summary',
      'summary.json',
      '--out',
      'manifest.json',
    ]),
  ).toEqual({
    command: 'attest',
    historyPath: 'history.jsonl',
    summaryPath: 'summary.json',
    manifestPath: 'manifest.json',
    force: false,
  });
  expect(
    parseCliArguments(['verify', '--manifest', 'manifest.json', '--require-authenticated']),
  ).toEqual({
    command: 'verify',
    manifestPath: 'manifest.json',
    requireAuthenticated: true,
  });
  expect(
    parseCliArguments([
      'view',
      '--history',
      'history.jsonl',
      '--summary',
      'summary.json',
      '--out',
      'report',
      '--manifest',
      'manifest.json',
      '--key-file',
      'key',
      '--key-id',
      'release-key',
      '--require-authenticated',
      '--open',
    ]),
  ).toEqual({
    command: 'view',
    historyPath: 'history.jsonl',
    summaryPath: 'summary.json',
    outputDirectory: 'report',
    force: false,
    open: true,
    manifestPath: 'manifest.json',
    keyFilePath: 'key',
    expectedKeyId: 'release-key',
    requireAuthenticated: true,
  });
  expect(() =>
    parseCliArguments([
      'attest',
      '--history',
      'history.jsonl',
      '--summary',
      'summary.json',
      '--out',
      'manifest.json',
      '--key-file',
      'key',
    ]),
  ).toThrow(/--key-file and --key-id together/);
  expect(() =>
    parseCliArguments(['verify', '--manifest', 'manifest.json', '--key-id', 'key']),
  ).toThrow(/requires --key-file/);
  expect(() => parseCliArguments(['view', '--history', 'history.jsonl'])).toThrow(/view requires/);
  expect(() =>
    parseCliArguments([
      'view',
      '--history',
      'history.jsonl',
      '--summary',
      'summary.json',
      '--out',
      'report',
      '--require-authenticated',
    ]),
  ).toThrow(/requires --manifest/);
  expect(() => parseCliArguments(['unknown'])).toThrow(/Unknown command/);
});

test('public demo package script preserves the CLI overwrite guard', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts?: Record<string, string> };

  expect(packageJson.scripts?.demo).toBe('pnpm build && node dist/cli.js demo');
});

test('runs the built CLI help as a real process smoke test', async () => {
  const cliPath = new URL('../dist/cli.js', import.meta.url);

  const result = await execFileAsync(process.execPath, [cliPath.pathname, '--help']);

  expect(result.stdout).toContain('aegiloc init');
  expect(result.stdout).toContain('aegiloc demo');
  expect(result.stdout).toContain('aegiloc attest');
  expect(result.stdout).toContain('No command rewrites tests');
});

test('attest and verify support unsigned and authenticated evidence without exposing keys', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const historyPath = testInfo.outputPath('integrity', 'history.jsonl');
  const summaryPath = testInfo.outputPath('integrity', 'summary.json');
  const unsignedPath = testInfo.outputPath('integrity', 'manifest.json');
  const authenticatedPath = testInfo.outputPath('integrity', 'authenticated.json');
  const keyPath = testInfo.outputPath('evidence.key');
  await writeAuditEvidence([], {
    historyPath,
    summaryPath,
    generatedAt: '2026-08-20T21:00:00.000Z',
  });

  const unsigned = captureIo();
  expect(
    await runCli(
      ['attest', '--history', historyPath, '--summary', summaryPath, '--out', unsignedPath],
      { cwd: testInfo.outputDir, io: unsigned.io },
    ),
  ).toBe(0);
  expect(unsigned.output).toContain('Created integrity evidence manifest');

  const unsignedVerification = captureIo();
  expect(
    await runCli(['verify', '--manifest', unsignedPath], {
      cwd: testInfo.outputDir,
      io: unsignedVerification.io,
    }),
  ).toBe(0);
  expect(unsignedVerification.output).toContain('unsigned integrity manifest');

  await writeFile(keyPath, Buffer.alloc(32, 0x5a), { mode: 0o600 });
  await chmod(keyPath, 0o600);
  const authenticated = captureIo();
  expect(
    await runCli(
      [
        'attest',
        '--history',
        historyPath,
        '--summary',
        summaryPath,
        '--out',
        authenticatedPath,
        '--key-file',
        keyPath,
        '--key-id',
        'local-2026-q3',
      ],
      { cwd: testInfo.outputDir, io: authenticated.io },
    ),
  ).toBe(0);
  expect(authenticated.output).toContain('Created authenticated evidence manifest');
  expect(authenticated.output).not.toContain('ZZZZ');

  const verification = captureIo();
  expect(
    await runCli(
      [
        'verify',
        '--manifest',
        authenticatedPath,
        '--key-file',
        keyPath,
        '--key-id',
        'local-2026-q3',
        '--require-authenticated',
      ],
      { cwd: testInfo.outputDir, io: verification.io },
    ),
  ).toBe(0);
  expect(verification.output).toContain('authenticated manifest key local-2026-q3');
});

test('CLI rejects broadly readable evidence-key files', async ({ browserName }, testInfo) => {
  void browserName;
  test.skip(process.platform === 'win32', 'POSIX file modes are not enforced on Windows');
  const historyPath = testInfo.outputPath('permissions', 'history.jsonl');
  const summaryPath = testInfo.outputPath('permissions', 'summary.json');
  const manifestPath = testInfo.outputPath('permissions', 'manifest.json');
  const keyPath = testInfo.outputPath('permissions.key');
  await writeAuditEvidence([], { historyPath, summaryPath });
  await writeFile(keyPath, Buffer.alloc(32), { mode: 0o644 });
  await chmod(keyPath, 0o644);
  const capture = captureIo();

  expect(
    await runCli(
      [
        'attest',
        '--history',
        historyPath,
        '--summary',
        summaryPath,
        '--out',
        manifestPath,
        '--key-file',
        keyPath,
        '--key-id',
        'unsafe-key',
      ],
      { cwd: testInfo.outputDir, io: capture.io },
    ),
  ).toBe(1);
  expect(capture.errors).toContain('permissions are too broad');
});

test('doctor passes against the built local package and Playwright peer', async () => {
  const cliPath = new URL('../dist/cli.js', import.meta.url);

  const result = await execFileAsync(process.execPath, [cliPath.pathname, 'doctor']);

  expect(result.stdout).toContain('PASS  Node.js');
  expect(result.stdout).toContain('PASS  @playwright/test is resolvable');
  expect(result.stdout).toContain('Aegiloc doctor: ready for local evaluation.');
});

test('init creates a valid starter registry without overwriting by default', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const registryPath = testInfo.outputPath('nested', 'targets.json');
  const first = captureIo();

  expect(
    await runCli(['init', '--registry', registryPath], { cwd: testInfo.outputDir, io: first.io }),
  ).toBe(0);
  const original = await readFile(registryPath, 'utf8');
  expect(original).toContain('"example.continue"');

  await writeFile(registryPath, 'keep this file\n', 'utf8');
  const second = captureIo();
  expect(
    await runCli(['init', '--registry', registryPath], { cwd: testInfo.outputDir, io: second.io }),
  ).toBe(1);
  expect(second.errors).toContain('refusing to overwrite');
  expect(await readFile(registryPath, 'utf8')).toBe('keep this file\n');

  const forced = captureIo();
  expect(
    await runCli(['init', '--registry', registryPath, '--force'], {
      cwd: testInfo.outputDir,
      io: forced.io,
    }),
  ).toBe(0);
  expect(await readFile(registryPath, 'utf8')).toBe(original);

  const symbolicRegistryPath = testInfo.outputPath('linked-targets.json');
  await symlink(registryPath, symbolicRegistryPath);
  const symbolic = captureIo();
  expect(
    await runCli(['init', '--registry', symbolicRegistryPath, '--force'], {
      cwd: testInfo.outputDir,
      io: symbolic.io,
    }),
  ).toBe(1);
  expect(symbolic.errors).toContain('Refusing to overwrite symbolic link');
});

test('validate prints a target count and reports precise registry errors', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const registryPath = testInfo.outputPath('targets.json');
  const init = captureIo();
  await runCli(['init', '--registry', registryPath], { cwd: testInfo.outputDir, io: init.io });

  const valid = captureIo();
  expect(
    await runCli(['validate', '--registry', registryPath], {
      cwd: testInfo.outputDir,
      io: valid.io,
    }),
  ).toBe(0);
  expect(valid.output).toContain('(1 target(s))');

  await writeFile(registryPath, '{"version":1,"targets":{}}\n', 'utf8');
  const invalid = captureIo();
  expect(
    await runCli(['validate', '--registry', registryPath], {
      cwd: testInfo.outputDir,
      io: invalid.io,
    }),
  ).toBe(1);
  expect(invalid.errors).toContain('Invalid target registry at $.defaults: expected an object');
});

test('view creates validated static HTML through the CLI', async ({ browserName }, testInfo) => {
  void browserName;
  const historyPath = testInfo.outputPath('history.jsonl');
  const summaryPath = testInfo.outputPath('summary.json');
  const reportPath = testInfo.outputPath('report');
  const summary = createAuditEvidenceSummary([], '2026-08-18T21:00:00.000Z');
  await writeFile(historyPath, serializeAuditHistory([]), 'utf8');
  await writeFile(summaryPath, `${JSON.stringify(summary)}\n`, 'utf8');
  const capture = captureIo();

  expect(
    await runCli(
      ['view', '--history', historyPath, '--summary', summaryPath, '--out', reportPath],
      { cwd: testInfo.outputDir, io: capture.io },
    ),
  ).toBe(0);
  expect(capture.output).toContain('including 0 successful heal(s)');
  expect(capture.output).toContain('trust=validated');
  expect(await readFile(`${reportPath}/index.html`, 'utf8')).toContain(
    'No locator drift assessment was recorded',
  );
});

test('demo is deterministic, refuses accidental replacement, and opens only on request', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const repositoryRoot = testInfo.outputPath('demo-repository');
  const reportPath = `${repositoryRoot}/test-results/realistic-demo/viewer/index.html`;
  const calls: string[] = [];
  const runDemo = async (root: string): Promise<void> => {
    calls.push(`run:${root}`);
    await mkdir(`${root}/test-results/realistic-demo/viewer`, { recursive: true });
    await writeFile(reportPath, '<!doctype html><title>demo</title>\n', 'utf8');
  };
  const openPath = (path: string): Promise<void> => {
    calls.push(`open:${path}`);
    return Promise.resolve();
  };
  const first = captureIo();

  expect(await runCli(['demo'], { io: first.io, repositoryRoot, runDemo, openPath })).toBe(0);
  expect(first.output).toContain('ordinary Playwright, guarded healing, and ambiguous rejection');
  expect(first.output).toContain(reportPath);
  expect(calls).toEqual([`run:${repositoryRoot}`]);

  const refused = captureIo();
  expect(await runCli(['demo'], { io: refused.io, repositoryRoot, runDemo, openPath })).toBe(1);
  expect(refused.errors).toContain('Refusing to replace existing demo output');
  expect(refused.errors).toContain('review it, then rerun explicitly with: pnpm cli demo --force');
  expect(calls).toEqual([`run:${repositoryRoot}`]);

  const forced = captureIo();
  expect(
    await runCli(['demo', '--force'], {
      io: forced.io,
      repositoryRoot,
      runDemo,
      openPath,
    }),
  ).toBe(0);
  expect(calls).toEqual([`run:${repositoryRoot}`, `run:${repositoryRoot}`]);

  const opened = captureIo();
  expect(
    await runCli(['demo', '--force', '--open'], {
      io: opened.io,
      repositoryRoot,
      runDemo,
      openPath,
    }),
  ).toBe(0);
  expect(calls).toEqual([
    `run:${repositoryRoot}`,
    `run:${repositoryRoot}`,
    `run:${repositoryRoot}`,
    `open:${reportPath}`,
  ]);
  expect(opened.output).toContain(`Opened ${reportPath}`);
});

test('view verifies the supplied manifest and opens only after successful generation', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const historyPath = testInfo.outputPath('manifest-view', 'history.jsonl');
  const summaryPath = testInfo.outputPath('manifest-view', 'summary.json');
  const manifestPath = testInfo.outputPath('manifest-view', 'manifest.json');
  const outputDirectory = testInfo.outputPath('manifest-report');
  await writeAuditEvidence([], {
    historyPath,
    summaryPath,
    generatedAt: '2026-08-21T09:00:00.000Z',
  });
  await writeEvidenceManifest({ historyPath, summaryPath, manifestPath });
  let openedPath: string | undefined;
  const capture = captureIo();

  expect(
    await runCli(
      [
        'view',
        '--history',
        historyPath,
        '--summary',
        summaryPath,
        '--manifest',
        manifestPath,
        '--out',
        outputDirectory,
        '--open',
      ],
      {
        cwd: testInfo.outputDir,
        io: capture.io,
        openPath: (path) => {
          openedPath = path;
          return Promise.resolve();
        },
      },
    ),
  ).toBe(0);
  expect(capture.output).toContain('trust=integrity');
  expect(openedPath).toBe(`${outputDirectory}/index.html`);
});

test('demo reports a missing artifact and an opener failure without hiding the report path', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const missingRoot = testInfo.outputPath('missing-demo-repository');
  const missing = captureIo();
  expect(
    await runCli(['demo', '--force'], {
      io: missing.io,
      repositoryRoot: missingRoot,
      runDemo: () => Promise.resolve(),
    }),
  ).toBe(1);
  expect(missing.errors).toContain('without generating the expected report');

  const openRoot = testInfo.outputPath('open-demo-repository');
  const reportPath = `${openRoot}/test-results/realistic-demo/viewer/index.html`;
  const openFailure = captureIo();
  expect(
    await runCli(['demo', '--force', '--open'], {
      io: openFailure.io,
      repositoryRoot: openRoot,
      runDemo: async () => {
        await mkdir(`${openRoot}/test-results/realistic-demo/viewer`, { recursive: true });
        await writeFile(reportPath, '<!doctype html>\n', 'utf8');
      },
      openPath: () => Promise.reject(new Error('no desktop session')),
    }),
  ).toBe(0);
  expect(openFailure.errors).toContain('could not open the report automatically');
  expect(openFailure.errors).toContain(reportPath);
  expect(openFailure.errors).toContain('Try:');
});
