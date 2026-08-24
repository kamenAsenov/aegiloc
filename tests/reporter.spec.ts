import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import type { TestCase, TestResult } from '@playwright/test/reporter';

import {
  AUDIT_ATTACHMENT_CONTENT_TYPE,
  AUDIT_ATTACHMENT_PREFIX,
  AuditEvidenceError,
  assessCandidates,
  createHealingAuditEvent,
  parseAuditHistory,
  serializeAuditHistory,
} from '../src/index.js';
import AegilocReporter, { healingStatusLines } from '../src/reporter.js';

const testCase = {
  titlePath: () => ['chromium', 'healing.browser.spec.ts', 'heals compatible drift'],
} as unknown as TestCase;

function result(status: TestResult['status'], attachmentNames: readonly string[]): TestResult {
  return {
    status,
    attachments: attachmentNames.map((name) => ({ name })),
  } as unknown as TestResult;
}

test('formats visible PASSED_WITH_HEALING lines for successful marker attachments', () => {
  const lines = healingStatusLines(
    testCase,
    result('passed', ['trace', 'PASSED_WITH_HEALING · checkout.terms check via checkbox:terms:0']),
  );

  expect(lines).toEqual([
    'PASSED_WITH_HEALING chromium › healing.browser.spec.ts › heals compatible drift · PASSED_WITH_HEALING · checkout.terms check via checkbox:terms:0',
  ]);
});

test('does not decorate a failed test even when a marker attachment exists', () => {
  expect(healingStatusLines(testCase, result('failed', ['PASSED_WITH_HEALING · stale']))).toEqual(
    [],
  );
});

test('aggregates typed audit attachments into canonical run evidence', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const outputDirectory = testInfo.outputPath('reporter-evidence');
  const event = createHealingAuditEvent({
    eventId: 'reporter-assessment',
    timestamp: '2026-08-16T00:00:00.000Z',
    mode: 'observe',
    modeDecision: 'observed',
    targetKey: 'checkout.placeOrder',
    action: 'click',
    executionRisk: 'proposal-only',
    primaryLocator: { type: 'role', role: 'button', name: 'Place order', exact: true },
    primaryError: new Error('not serialized'),
    collectionStatus: 'completed',
    assessment: assessCandidates([], {
      enabled: true,
      confidenceThreshold: 0.95,
      minimumScoreMargin: 0.2,
    }),
    rankedCandidates: [],
  });
  const reporter = new AegilocReporter({ outputDirectory });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(`${outputDirectory}/history.jsonl`, serializeAuditHistory([event]), 'utf8');
  reporter.onTestEnd(testCase, {
    status: 'failed',
    attachments: [
      {
        name: `${AUDIT_ATTACHMENT_PREFIX}${event.eventId}`,
        contentType: AUDIT_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(event)),
      },
    ],
  } as unknown as TestResult);

  await reporter.onEnd();

  expect(parseAuditHistory(await readFile(`${outputDirectory}/history.jsonl`, 'utf8'))).toEqual([
    event,
  ]);
  expect(JSON.parse(await readFile(`${outputDirectory}/summary.json`, 'utf8'))).toMatchObject({
    events: { total: 1, assessments: 1, executions: 0 },
    decisions: { observed: 1 },
  });
});

test('fails closed when existing worker JSONL is malformed', async ({ browserName }, testInfo) => {
  void browserName;
  const outputDirectory = testInfo.outputPath('malformed-reporter-evidence');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(`${outputDirectory}/history.jsonl`, '{not-json}\n', 'utf8');

  await expect(new AegilocReporter({ outputDirectory }).onEnd()).rejects.toThrow(
    AuditEvidenceError,
  );
});
