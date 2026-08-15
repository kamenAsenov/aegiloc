import { readdir, readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { Ajv2020 } from 'ajv/dist/2020.js';

import {
  AUDIT_ATTACHMENT_CONTENT_TYPE,
  AUDIT_ATTACHMENT_PREFIX,
  AuditEvidenceError,
  assessCandidates,
  auditEventsFromAttachments,
  canonicalizeAuditEvents,
  createAuditEvidenceSummary,
  createHealingAuditEvent,
  createHealingExecutionAuditEvent,
  parseAuditHistory,
  serializeAuditHistory,
  writeAuditEvidence,
  type HealwrightAuditEvent,
} from '../src/index.js';

function eventPair(): readonly [HealwrightAuditEvent, HealwrightAuditEvent] {
  const provenance = {
    runId: 'run-1',
    testId: 'checkout-test',
    projectName: 'chromium',
    retry: 1,
    commitSha: 'abcdef0123456789',
  } as const;
  const assessment = createHealingAuditEvent({
    eventId: 'assessment-1',
    timestamp: '2026-08-16T00:00:00.000Z',
    provenance,
    mode: 'guarded',
    modeDecision: 'rejected',
    targetKey: 'checkout.terms',
    action: 'check',
    primaryLocator: { type: 'testId', value: 'checkout-terms' },
    primaryError: new Error('not serialized'),
    collectionStatus: 'completed',
    assessment: assessCandidates([], {
      enabled: true,
      confidenceThreshold: 0.94,
      minimumScoreMargin: 0.18,
    }),
    rankedCandidates: [],
  });
  const execution = createHealingExecutionAuditEvent({
    eventId: 'execution-1',
    timestamp: '2026-08-16T00:00:01.000Z',
    provenance,
    parentEventId: assessment.eventId,
    targetKey: 'checkout.terms',
    action: 'check',
    candidateId: 'input:terms:0',
    status: 'succeeded',
    reason: 'succeeded',
    screenshots: [
      {
        phase: 'before',
        name: 'before.png',
        filePath: '/private/before.png',
        auditPath: 'test-results/healwright/before.png',
        contentType: 'image/png',
      },
      {
        phase: 'after',
        name: 'after.png',
        filePath: '/private/after.png',
        auditPath: 'test-results/healwright/after.png',
        contentType: 'image/png',
      },
    ],
  });
  return [assessment, execution];
}

function attachment(event: HealwrightAuditEvent) {
  return {
    name: `${AUDIT_ATTACHMENT_PREFIX}${event.eventId}`,
    contentType: AUDIT_ATTACHMENT_CONTENT_TYPE,
    body: Buffer.from(JSON.stringify(event)),
  };
}

test('extracts only typed Healwright audit attachments', () => {
  const [assessment] = eventPair();
  expect(
    auditEventsFromAttachments([
      { name: 'unrelated', contentType: 'application/json', body: Buffer.from('{}') },
      {
        ...attachment(assessment),
        body: Buffer.from(JSON.stringify(assessment, null, 2)),
      },
    ]),
  ).toEqual([assessment]);
});

test('decodes serialized Buffer bodies delivered across reporter workers', () => {
  const [assessment] = eventPair();
  const body = Buffer.from(JSON.stringify(assessment));

  expect(
    auditEventsFromAttachments([
      {
        name: `${AUDIT_ATTACHMENT_PREFIX}${assessment.eventId}`,
        contentType: AUDIT_ATTACHMENT_CONTENT_TYPE,
        body: { type: 'Buffer', data: [...body] },
      },
    ]),
  ).toEqual([assessment]);
});

test('rejects audit attachments without inline bodies', () => {
  expect(() =>
    auditEventsFromAttachments([
      {
        name: `${AUDIT_ATTACHMENT_PREFIX}missing`,
        contentType: AUDIT_ATTACHMENT_CONTENT_TYPE,
      },
    ]),
  ).toThrow(AuditEvidenceError);
});

test('rejects attachment names that disagree with the event id', () => {
  const [assessment] = eventPair();
  expect(() =>
    auditEventsFromAttachments([
      { ...attachment(assessment), name: `${AUDIT_ATTACHMENT_PREFIX}different` },
    ]),
  ).toThrow(/does not match its eventId/);
});

test('canonicalizes event order and deduplicates identical records', () => {
  const [assessment, execution] = eventPair();
  expect(canonicalizeAuditEvents([execution, assessment, assessment])).toEqual([
    assessment,
    execution,
  ]);
  expect(parseAuditHistory(serializeAuditHistory([execution, assessment]))).toEqual([
    assessment,
    execution,
  ]);
});

test('rejects conflicting records that reuse one event id', () => {
  const [assessment] = eventPair();
  expect(() =>
    canonicalizeAuditEvents([assessment, { ...assessment, targetKey: 'checkout.different' }]),
  ).toThrow(/conflicting records/);
});

test('summarizes outcomes and provenance deterministically', () => {
  const events = eventPair();
  expect(createAuditEvidenceSummary(events, '2026-08-16T01:00:00.000Z')).toEqual({
    schemaVersion: 1,
    generatedAt: '2026-08-16T01:00:00.000Z',
    events: { total: 2, assessments: 1, executions: 1 },
    decisions: { observed: 0, eligible: 0, rejected: 1, strictCiFailure: 0 },
    executions: { succeeded: 1, failed: 0, rejected: 0 },
    provenance: {
      runIds: ['run-1'],
      testIds: ['checkout-test'],
      projectNames: ['chromium'],
      retryIndices: [1],
      commitShas: ['abcdef0123456789'],
      legacyEventCount: 0,
    },
    targets: [
      {
        targetKey: 'checkout.terms',
        actions: ['check'],
        assessmentCount: 1,
        executionCount: 1,
        successfulHealingCount: 1,
      },
    ],
  });
});

test('rejects invalid summary timestamps and colliding output paths', async () => {
  expect(() => createAuditEvidenceSummary([], '2026-08-16')).toThrow(/valid date-time/);
  await expect(
    writeAuditEvidence([], { historyPath: 'same-output', summaryPath: 'same-output' }),
  ).rejects.toThrow(/must be different files/);
});

test('generated summaries satisfy the checked-in JSON Schema', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../registry/evidence-summary.schema.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    formats: { 'date-time': true },
  }).compile(schema);
  const summary = createAuditEvidenceSummary(eventPair(), '2026-08-16T01:00:00.000Z');

  expect(validate(summary), JSON.stringify(validate.errors)).toBe(true);
  expect(validate({ ...summary, unexpected: true })).toBe(false);
});

test('atomically writes canonical history and its JSON summary', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const outputDirectory = testInfo.outputPath('evidence');
  const historyPath = `${outputDirectory}/history.jsonl`;
  const summaryPath = `${outputDirectory}/summary.json`;
  const events = eventPair();

  const summary = await writeAuditEvidence([...events].reverse(), {
    historyPath,
    summaryPath,
    generatedAt: '2026-08-16T01:00:00.000Z',
  });

  expect(parseAuditHistory(await readFile(historyPath, 'utf8'))).toEqual(events);
  expect(JSON.parse(await readFile(summaryPath, 'utf8'))).toEqual(summary);
  expect((await readdir(outputDirectory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
});
