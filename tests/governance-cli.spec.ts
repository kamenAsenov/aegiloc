import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { assessCandidates, createHealingAuditEvent, writeAuditEvidence } from '../src/index.js';

const repositoryPath = resolve(new URL('..', import.meta.url).pathname);

function runCli(args: readonly string[]) {
  return spawnSync(process.execPath, ['scripts/evaluate-governance.mjs', ...args], {
    cwd: repositoryPath,
    encoding: 'utf8',
  });
}

test('provider-neutral CLI returns distinct pass, policy-fail, and malformed-input exit codes', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const historyPath = testInfo.outputPath('history.jsonl');
  const evidenceSummaryPath = testInfo.outputPath('evidence-summary.json');
  const passingPolicyPath = testInfo.outputPath('passing-policy.json');
  const failingPolicyPath = testInfo.outputPath('failing-policy.json');
  const malformedHistoryPath = testInfo.outputPath('malformed.jsonl');
  const nonCanonicalHistoryPath = testInfo.outputPath('non-canonical.jsonl');
  const jsonPath = testInfo.outputPath('health.json');
  const markdownPath = testInfo.outputPath('health.md');
  const event = createHealingAuditEvent({
    eventId: 'cli-assessment',
    timestamp: '2026-08-16T10:00:00.000Z',
    provenance: {
      runId: 'cli-run',
      testId: 'cli-test',
      projectName: 'chromium',
      retry: 0,
    },
    operationIndex: 0,
    mode: 'guarded',
    modeDecision: 'rejected',
    targetKey: 'checkout.applyDiscount',
    action: 'click',
    executionRisk: 'automatic',
    primaryLocator: { type: 'text', value: 'Apply discount' },
    primaryError: new Error('not serialized'),
    collectionStatus: 'completed',
    assessment: assessCandidates([], {
      enabled: true,
      confidenceThreshold: 0.9,
      minimumScoreMargin: 0.15,
    }),
    rankedCandidates: [],
  });
  await writeAuditEvidence([event], {
    historyPath,
    summaryPath: evidenceSummaryPath,
    generatedAt: '2026-08-16T10:01:00.000Z',
  });
  await Promise.all([
    writeFile(
      passingPolicyPath,
      JSON.stringify({ version: 1, limits: { maxRejectedAttemptsPerRun: 1 } }),
      'utf8',
    ),
    writeFile(
      failingPolicyPath,
      JSON.stringify({ version: 1, limits: { maxRejectedAttemptsPerRun: 0 } }),
      'utf8',
    ),
    writeFile(malformedHistoryPath, '{not-json}\n', 'utf8'),
    writeFile(
      nonCanonicalHistoryPath,
      `${JSON.stringify(event)}\n${JSON.stringify({
        ...event,
        eventId: 'cli-assessment-earlier',
        timestamp: '2026-08-16T09:00:00.000Z',
        operationIndex: 1,
      })}\n`,
      'utf8',
    ),
  ]);
  const common = [
    '--registry',
    'registry/targets.json',
    '--json',
    jsonPath,
    '--markdown',
    markdownPath,
    '--evaluated-at',
    '2026-08-16T12:00:00.000Z',
  ];

  const passing = runCli([
    '--',
    '--history',
    historyPath,
    '--policy',
    passingPolicyPath,
    ...common,
  ]);
  expect(passing.status, passing.stderr).toBe(0);
  expect(passing.stdout).toContain('AEGILOC_GOVERNANCE PASS');
  expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toMatchObject({ status: 'pass' });
  expect(await readFile(markdownPath, 'utf8')).toContain('Status:** PASS');

  const failing = runCli(['--history', historyPath, '--policy', failingPolicyPath, ...common]);
  expect(failing.status, failing.stderr).toBe(1);
  expect(failing.stdout).toContain('AEGILOC_GOVERNANCE FAIL');
  expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toMatchObject({ status: 'fail' });

  const malformed = runCli([
    '--history',
    malformedHistoryPath,
    '--policy',
    passingPolicyPath,
    ...common,
  ]);
  expect(malformed.status).toBe(2);
  expect(malformed.stderr).toContain('Invalid Aegiloc history');

  const nonCanonical = runCli([
    '--history',
    nonCanonicalHistoryPath,
    '--policy',
    passingPolicyPath,
    ...common,
  ]);
  expect(nonCanonical.status).toBe(2);
  expect(nonCanonical.stderr).toContain('not canonical deterministic evidence');

  const canonicalBeforeCollision = await readFile(historyPath, 'utf8');
  const collision = runCli([
    '--history',
    historyPath,
    '--registry',
    'registry/targets.json',
    '--policy',
    passingPolicyPath,
    '--json',
    historyPath,
    '--markdown',
    markdownPath,
  ]);
  expect(collision.status).toBe(2);
  expect(collision.stderr).toContain('cannot overwrite inputs');
  expect(await readFile(historyPath, 'utf8')).toBe(canonicalBeforeCollision);
});

test('CLI supports explicit no-policy summaries', async ({ browserName }, testInfo) => {
  void browserName;
  const historyPath = testInfo.outputPath('empty.jsonl');
  const summaryPath = testInfo.outputPath('evidence-summary.json');
  await writeAuditEvidence([], {
    historyPath,
    summaryPath,
    generatedAt: '2026-08-16T10:01:00.000Z',
  });
  const result = runCli([
    '--history',
    historyPath,
    '--registry',
    'registry/targets.json',
    '--no-policy',
    '--json',
    testInfo.outputPath('health.json'),
    '--markdown',
    testInfo.outputPath('health.md'),
    '--evaluated-at',
    '2026-08-16T12:00:00.000Z',
  ]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('AEGILOC_GOVERNANCE PASS');
});
