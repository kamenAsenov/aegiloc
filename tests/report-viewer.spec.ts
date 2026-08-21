import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';

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
  writeEvidenceManifest,
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

test('renders a practical, self-contained v1 decision report', () => {
  const events = reportEvents();
  const summary = createAuditEvidenceSummary(events, '2026-08-18T20:01:00.000Z');

  const html = renderReportViewer(events, summary, { title: 'Storefront run' });

  expect(html).toContain('<h1>Storefront run</h1>');
  expect(html).toContain('Successful heals');
  expect(html).toContain('Decision timeline');
  expect(html).toContain('Passed with healing');
  expect(html).toContain('Rejected safely');
  expect(html).toContain('Compare ranked candidates (1)');
  expect(html).toContain('Scoring signals');
  expect(html).toContain('What should I do next?');
  expect(html).toContain('screenshots/before.png');
  expect(html).toContain('v1.0.0 evaluation release');
  expect(html).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/u);
  expect(html).toContain("default-src 'none'");
  expect(html).not.toMatch(/(?:src|href)=["']https?:/u);
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

  expect(html).toContain('No locator drift assessment was recorded.');
  expect(html).toContain('No Healwright action is required.');
  expect(html).toContain('No locator drift evidence');
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

  expect(generated).toMatchObject({
    eventCount: 3,
    successfulHealingCount: 1,
    evidenceTrust: { level: 'validated' },
  });
  expect(await readFile(generated.indexPath, 'utf8')).toContain('Healwright evidence report');
  await expect(generateReportViewer({ historyPath, summaryPath, outputDirectory })).rejects.toThrow(
    /Refusing to overwrite/,
  );
  await expect(
    generateReportViewer({ historyPath, summaryPath, outputDirectory, force: true }),
  ).resolves.toMatchObject({ eventCount: 3 });
});

test('verifies an integrity manifest before rendering and discloses the trust level', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const events = reportEvents();
  const historyPath = testInfo.outputPath('integrity', 'history.jsonl');
  const summaryPath = testInfo.outputPath('integrity', 'summary.json');
  const manifestPath = testInfo.outputPath('integrity', 'manifest.json');
  const outputDirectory = testInfo.outputPath('integrity-viewer');
  await mkdir(testInfo.outputPath('integrity'), { recursive: true });
  await writeFile(historyPath, serializeAuditHistory(events), 'utf8');
  await writeFile(
    summaryPath,
    `${JSON.stringify(createAuditEvidenceSummary(events, '2026-08-18T20:01:00.000Z'), null, 2)}\n`,
    'utf8',
  );
  await writeEvidenceManifest({ historyPath, summaryPath, manifestPath });

  const generated = await generateReportViewer({
    historyPath,
    summaryPath,
    manifestPath,
    outputDirectory,
  });

  expect(generated.evidenceTrust).toEqual({ level: 'integrity' });
  expect(await readFile(generated.indexPath, 'utf8')).toContain('Evidence integrity verified');
});

test('refuses a symbolic-link report output directory', async ({ browserName }, testInfo) => {
  void browserName;
  test.skip(process.platform === 'win32', 'directory symbolic links require additional privileges');
  const historyPath = testInfo.outputPath('symlink-history.jsonl');
  const summaryPath = testInfo.outputPath('symlink-summary.json');
  const realDirectory = testInfo.outputPath('real-viewer');
  const linkedDirectory = testInfo.outputPath('linked-viewer');
  await writeFile(historyPath, serializeAuditHistory([]), 'utf8');
  await writeFile(
    summaryPath,
    `${JSON.stringify(createAuditEvidenceSummary([], '2026-08-18T20:01:00.000Z'), null, 2)}\n`,
    'utf8',
  );
  await mkdir(realDirectory, { recursive: true });
  await symlink(realDirectory, linkedDirectory, 'dir');

  await expect(
    generateReportViewer({
      historyPath,
      summaryPath,
      outputDirectory: linkedDirectory,
      force: true,
    }),
  ).rejects.toThrow(/cannot be a symbolic link/);
});

test('renders authenticated evidence only after key verification', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const events = reportEvents();
  const historyPath = testInfo.outputPath('authenticated', 'history.jsonl');
  const summaryPath = testInfo.outputPath('authenticated', 'summary.json');
  const manifestPath = testInfo.outputPath('authenticated', 'manifest.json');
  const key = Buffer.alloc(32, 0x41);
  await mkdir(testInfo.outputPath('authenticated'), { recursive: true });
  await writeFile(historyPath, serializeAuditHistory(events), 'utf8');
  await writeFile(
    summaryPath,
    `${JSON.stringify(createAuditEvidenceSummary(events, '2026-08-18T20:01:00.000Z'), null, 2)}\n`,
    'utf8',
  );
  await writeEvidenceManifest({
    historyPath,
    summaryPath,
    manifestPath,
    authentication: { key, keyId: 'release-evidence' },
  });

  const generated = await generateReportViewer({
    historyPath,
    summaryPath,
    manifestPath,
    outputDirectory: testInfo.outputPath('authenticated-viewer'),
    key,
    expectedKeyId: 'release-evidence',
    requireAuthenticated: true,
  });

  expect(generated.evidenceTrust).toEqual({
    level: 'authenticated',
    keyId: 'release-evidence',
  });
  expect(await readFile(generated.indexPath, 'utf8')).toContain('Evidence authenticated');
});

test('refuses a valid manifest that describes different report input paths', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const events = reportEvents();
  const manifestHistoryPath = testInfo.outputPath('manifest-source', 'history.jsonl');
  const manifestSummaryPath = testInfo.outputPath('manifest-source', 'summary.json');
  const manifestPath = testInfo.outputPath('manifest-source', 'manifest.json');
  const otherHistoryPath = testInfo.outputPath('other-source', 'history.jsonl');
  const otherSummaryPath = testInfo.outputPath('other-source', 'summary.json');
  const history = serializeAuditHistory(events);
  const summary = `${JSON.stringify(createAuditEvidenceSummary(events, '2026-08-18T20:01:00.000Z'), null, 2)}\n`;
  await Promise.all([
    mkdir(testInfo.outputPath('manifest-source'), { recursive: true }),
    mkdir(testInfo.outputPath('other-source'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(manifestHistoryPath, history, 'utf8'),
    writeFile(manifestSummaryPath, summary, 'utf8'),
    writeFile(otherHistoryPath, history, 'utf8'),
    writeFile(otherSummaryPath, summary, 'utf8'),
  ]);
  await writeEvidenceManifest({
    historyPath: manifestHistoryPath,
    summaryPath: manifestSummaryPath,
    manifestPath,
  });

  await expect(
    generateReportViewer({
      historyPath: otherHistoryPath,
      summaryPath: otherSummaryPath,
      manifestPath,
      outputDirectory: testInfo.outputPath('mismatched-viewer'),
    }),
  ).rejects.toThrow(/inputs do not match the verified evidence manifest/);
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
