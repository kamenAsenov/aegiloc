import { readFile, writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  assessCandidates,
  createAuditEvidenceSummary,
  createHealingAuditEvent,
  createHealingExecutionAuditEvent,
  generateReportViewer,
  rankCandidates,
  renderReportViewer,
  serializeAuditHistory,
  type HealwrightAuditEvent,
} from '../src/index.js';

function reportEvents(): readonly HealwrightAuditEvent[] {
  const rankedCandidates = rankCandidates(
    {
      accessibleRole: 'button',
      accessibleName: 'Apply discount',
      visibleText: 'Apply discount',
      tag: 'button',
    },
    [
      {
        id: 'button:apply-discount:0',
        role: 'button',
        accessibleName: 'Apply discount',
        visibleText: 'Apply discount',
        tag: 'button',
        stableAttributes: {},
        ancestorText: ['Checkout'],
        neighborText: [],
      },
    ],
    'click',
  );
  const assessment = createHealingAuditEvent({
    eventId: 'assessment-report-safe',
    timestamp: '2026-08-18T20:00:00.000Z',
    mode: 'guarded',
    modeDecision: 'eligible',
    targetKey: '<script>alert("unsafe target")</script>',
    action: 'click',
    primaryLocator: { type: 'text', value: 'Apply discount', exact: true },
    primaryError: new Error('not serialized'),
    collectionStatus: 'completed',
    assessment: assessCandidates(rankedCandidates, {
      enabled: true,
      confidenceThreshold: 0.9,
      minimumScoreMargin: 0.15,
    }),
    rankedCandidates,
  });
  const execution = createHealingExecutionAuditEvent({
    eventId: 'execution-report-safe',
    timestamp: '2026-08-18T20:00:01.000Z',
    parentEventId: assessment.eventId,
    targetKey: assessment.targetKey,
    action: 'click',
    candidateId: rankedCandidates[0]?.candidate.id ?? 'missing',
    status: 'succeeded',
    reason: 'succeeded',
    screenshots: [
      {
        phase: 'before',
        name: 'before.png',
        filePath: '/private/not-audited/before.png',
        auditPath: 'screenshots/before.png',
        contentType: 'image/png',
      },
      {
        phase: 'after',
        name: 'after.png',
        filePath: '/private/not-audited/after.png',
        auditPath: 'screenshots/after.png',
        contentType: 'image/png',
      },
    ],
  });
  const rejected = createHealingAuditEvent({
    eventId: 'assessment-report-rejected',
    timestamp: '2026-08-18T20:00:02.000Z',
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
  return [assessment, execution, rejected];
}

test('renders a practical report with summary, successful, and rejected sections', () => {
  const events = reportEvents();
  const summary = createAuditEvidenceSummary(events, '2026-08-18T20:01:00.000Z');

  const html = renderReportViewer(events, summary, { title: 'Storefront run' });

  expect(html).toContain('<h1>Storefront run</h1>');
  expect(html).toContain('Successful heals');
  expect(html).toContain('Rejected and protected');
  expect(html).toContain('screenshots/before.png');
  expect(html).toContain('v0.7.0 Technical Preview');
  expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'");
});

test('escapes user-controlled evidence strings instead of creating executable markup', () => {
  const events = reportEvents();
  const summary = createAuditEvidenceSummary(events, '2026-08-18T20:01:00.000Z');

  const html = renderReportViewer(events, summary);

  expect(html).not.toContain('<script>alert("unsafe target")</script>');
  expect(html).toContain('&lt;script&gt;alert(&quot;unsafe target&quot;)&lt;/script&gt;');
});

test('renders clear empty states for a run with no drift evidence', () => {
  const summary = createAuditEvidenceSummary([], '2026-08-18T20:01:00.000Z');

  const html = renderReportViewer([], summary);

  expect(html).toContain('No locator drift assessments were recorded for this run.');
  expect(html).toContain('No replacement locator was executed.');
});

test('generates a self-contained report and refuses silent overwrite', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const events = reportEvents();
  const summary = createAuditEvidenceSummary(events, '2026-08-18T20:01:00.000Z');
  const historyPath = testInfo.outputPath('history.jsonl');
  const summaryPath = testInfo.outputPath('summary.json');
  const outputDirectory = testInfo.outputPath('viewer');
  await writeFile(historyPath, serializeAuditHistory(events), 'utf8');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const generated = await generateReportViewer({
    historyPath,
    summaryPath,
    outputDirectory,
  });

  expect(generated).toMatchObject({ eventCount: 3, successfulHealingCount: 1 });
  expect(await readFile(generated.indexPath, 'utf8')).toContain('Healwright evidence report');
  await expect(generateReportViewer({ historyPath, summaryPath, outputDirectory })).rejects.toThrow(
    /Refusing to overwrite/,
  );
  await expect(
    generateReportViewer({ historyPath, summaryPath, outputDirectory, force: true }),
  ).resolves.toMatchObject({ eventCount: 3 });
});

test('rejects a summary that does not match canonical history', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const events = reportEvents();
  const summary = createAuditEvidenceSummary(events, '2026-08-18T20:01:00.000Z');
  const historyPath = testInfo.outputPath('history.jsonl');
  const summaryPath = testInfo.outputPath('tampered-summary.json');
  await writeFile(historyPath, serializeAuditHistory(events), 'utf8');
  await writeFile(
    summaryPath,
    `${JSON.stringify({ ...summary, events: { ...summary.events, total: 99 } })}\n`,
    'utf8',
  );

  await expect(
    generateReportViewer({
      historyPath,
      summaryPath,
      outputDirectory: testInfo.outputPath('viewer'),
    }),
  ).rejects.toThrow(/does not match the canonical history/);
});
