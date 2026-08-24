import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import {
  assessCandidates,
  createHealingAuditEvent,
  createHealingExecutionAuditEvent,
  generateReportViewer,
  rankCandidates,
  writeAuditEvidence,
  writeEvidenceManifest,
} from '../dist/index.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const evidenceDirectory = resolve(repositoryRoot, 'test-results/report-preview/evidence');
const historyPath = resolve(evidenceDirectory, 'history.jsonl');
const summaryPath = resolve(evidenceDirectory, 'summary.json');
const manifestPath = resolve(evidenceDirectory, 'manifest.json');
const viewerDirectory = resolve(repositoryRoot, 'test-results/report-preview/viewer');
const screenshotPath = resolve(repositoryRoot, 'docs/assets/aegiloc-report-v1.png');
const previewProvenance = {
  runId: 'aegiloc-v1.1-preview',
  testId: 'storefront recovery preview',
  projectName: 'chromium',
  retry: 0,
  commitSha: 'abcdef0123456789',
};

const ranked = rankCandidates(
  {
    accessibleRole: 'button',
    accessibleName: 'Apply discount',
    visibleText: 'Apply discount',
    tag: 'button',
    ancestorText: ['Order summary'],
  },
  [
    {
      id: 'button:apply-discount:0',
      role: 'button',
      accessibleName: 'Apply discount',
      visibleText: 'Apply Discount',
      tag: 'button',
      stableAttributes: { 'data-testid': 'discount-v2' },
      ancestorText: ['Order summary'],
      neighborText: ['Promo code'],
    },
  ],
  'click',
);
const healed = createHealingAuditEvent({
  eventId: 'preview-assessment-healed',
  timestamp: '2026-08-24T08:00:00.000Z',
  provenance: previewProvenance,
  mode: 'guarded',
  modeDecision: 'eligible',
  targetKey: 'checkout.applyDiscount',
  action: 'click',
  primaryLocator: { type: 'text', value: 'Apply discount', exact: true },
  primaryError: new Error('locator remained absent'),
  collectionStatus: 'completed',
  assessment: assessCandidates(ranked, {
    enabled: true,
    confidenceThreshold: 0.9,
    minimumScoreMargin: 0.15,
  }),
  rankedCandidates: ranked,
});
const execution = createHealingExecutionAuditEvent({
  eventId: 'preview-execution-healed',
  timestamp: '2026-08-24T08:00:01.000Z',
  provenance: previewProvenance,
  parentEventId: healed.eventId,
  targetKey: healed.targetKey,
  action: 'click',
  candidateId: ranked[0]?.candidate.id ?? 'missing',
  status: 'succeeded',
  reason: 'succeeded',
  screenshots: [
    {
      phase: 'before',
      name: 'preview-before.png',
      filePath: resolve(repositoryRoot, 'test-results/report-preview/preview-before.png'),
      auditPath: 'screenshots/preview-before.png',
      contentType: 'image/png',
    },
    {
      phase: 'after',
      name: 'preview-after.png',
      filePath: resolve(repositoryRoot, 'test-results/report-preview/preview-after.png'),
      auditPath: 'screenshots/preview-after.png',
      contentType: 'image/png',
    },
  ],
});
const rejected = createHealingAuditEvent({
  eventId: 'preview-assessment-rejected',
  timestamp: '2026-08-24T08:00:02.000Z',
  provenance: previewProvenance,
  mode: 'guarded',
  modeDecision: 'rejected',
  targetKey: 'checkout.acceptTerms',
  action: 'check',
  primaryLocator: { type: 'testId', value: 'terms-checkbox' },
  primaryError: new Error('locator remained absent'),
  collectionStatus: 'completed',
  assessment: assessCandidates([], {
    enabled: true,
    confidenceThreshold: 0.94,
    minimumScoreMargin: 0.18,
  }),
  rankedCandidates: [],
});
const events = [healed, execution, rejected];

await writeAuditEvidence(events, {
  historyPath,
  summaryPath,
  generatedAt: '2026-08-24T08:01:00.000Z',
});
await writeEvidenceManifest({ historyPath, summaryPath, manifestPath, force: true });
const report = await generateReportViewer({
  historyPath,
  summaryPath,
  manifestPath,
  outputDirectory: viewerDirectory,
  force: true,
  title: 'Storefront recovery evidence',
});

await mkdir(resolve(repositoryRoot, 'docs/assets'), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1040 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(report.indexPath).href);
  await page.screenshot({ path: screenshotPath, fullPage: false });
} finally {
  await browser.close();
}
process.stdout.write(`Captured deterministic v1.1 report preview: ${screenshotPath}\n`);
