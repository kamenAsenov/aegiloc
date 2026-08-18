import { execFile } from 'node:child_process';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { parseCliArguments, runCli, type CliIo } from '../src/cli-core.js';
import { createAuditEvidenceSummary, serializeAuditHistory } from '../src/index.js';

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

test('parses the documented commands and rejects incomplete view options', () => {
  expect(parseCliArguments(['init', '--registry', 'targets.json', '--force'])).toEqual({
    command: 'init',
    registryPath: 'targets.json',
    force: true,
  });
  expect(parseCliArguments(['validate', '--registry', 'targets.json'])).toEqual({
    command: 'validate',
    registryPath: 'targets.json',
  });
  expect(() => parseCliArguments(['view', '--history', 'history.jsonl'])).toThrow(/view requires/);
  expect(() => parseCliArguments(['unknown'])).toThrow(/Unknown command/);
});

test('runs the built CLI help as a real process smoke test', async () => {
  const cliPath = new URL('../dist/cli.js', import.meta.url);

  const result = await execFileAsync(process.execPath, [cliPath.pathname, '--help']);

  expect(result.stdout).toContain('healwright init');
  expect(result.stdout).toContain('No command rewrites tests');
});

test('doctor passes against the built local package and Playwright peer', async () => {
  const cliPath = new URL('../dist/cli.js', import.meta.url);

  const result = await execFileAsync(process.execPath, [cliPath.pathname, 'doctor']);

  expect(result.stdout).toContain('PASS  Node.js');
  expect(result.stdout).toContain('PASS  @playwright/test is resolvable');
  expect(result.stdout).toContain('Healwright doctor: ready for local evaluation.');
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
  expect(await readFile(`${reportPath}/index.html`, 'utf8')).toContain(
    'No locator drift assessments were recorded',
  );
});
