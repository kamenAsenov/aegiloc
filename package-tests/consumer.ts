import type { Page } from '@playwright/test';
import {
  DEFAULT_PROPOSAL_MINIMUM_OBSERVATIONS,
  DEFAULT_FINGERPRINT_PROPOSAL_MINIMUM_OBSERVATIONS,
  InMemoryAuditSink,
  InMemoryFingerprintObservationSink,
  NoopHealingResultSink,
  createHealer,
  createAuditProvenance,
  createAuditEvidenceSummary,
  evaluateCandidateEligibility,
  generateHealingProposals,
  generateFingerprintProposals,
  generateReportViewer,
  parseEvidenceManifest,
  renderHealingProposalReport,
  renderReportViewer,
  parseHealingProposalBundle,
  verifyHealingProposal,
  verifyHealingProposalBundle,
  verifyEvidenceManifest,
  writeAuditEvidence,
  writeEvidenceManifest,
  type EvidenceManifest,
  type AegilocAuditEvent,
  type HealingProposal,
  type CandidateEligibility,
  type TargetRegistry,
  type PrimaryFingerprintObservation,
  type ReportEvidenceTrust,
} from 'aegiloc';
import AegilocReporter, {
  DEFAULT_EVIDENCE_OUTPUT_DIRECTORY,
  healingStatusLines,
  type AegilocReporterOptions,
} from 'aegiloc/reporter';

declare const page: Page;

const registry = {
  version: 1,
  defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
  targets: {
    'checkout.submit': {
      description: 'Submit checkout',
      primary: { type: 'role', role: 'button', name: 'Submit', exact: true },
      fingerprint: { accessibleRole: 'button', accessibleName: 'Submit', tag: 'button' },
      policy: {
        allowedActions: ['click'],
        healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
      },
    },
  },
} as const satisfies TargetRegistry<'checkout.submit'>;

const healer = createHealer({
  page,
  registry,
  mode: 'guarded',
  auditSink: new InMemoryAuditSink(),
  resultSink: new NoopHealingResultSink(),
  auditProvenance: createAuditProvenance({
    runId: 'consumer-run',
    testId: 'consumer-test',
    projectName: 'chromium',
    retry: 0,
  }),
});

const target = healer.target('checkout.submit');
void target.click;
void AegilocReporter;
void healingStatusLines;
void DEFAULT_EVIDENCE_OUTPUT_DIRECTORY;
const reporterOptions = {
  outputDirectory: 'artifacts/aegiloc',
} satisfies AegilocReporterOptions;
void reporterOptions;
const eligibility: CandidateEligibility = evaluateCandidateEligibility(
  registry.targets['checkout.submit'].fingerprint,
  {
    id: 'button:submit:0',
    role: 'button',
    accessibleName: 'Submit',
    stableAttributes: {},
    visibleText: 'Submit',
    tag: 'button',
    ancestorText: [],
    neighborText: [],
  },
  'click',
);
void eligibility;

declare const history: readonly AegilocAuditEvent[];
const evidenceSummary = createAuditEvidenceSummary(history, '2026-08-16T00:00:00.000Z');
void evidenceSummary;
void writeAuditEvidence(history, {
  historyPath: 'test-results/aegiloc/history.jsonl',
  summaryPath: 'test-results/aegiloc/summary.json',
});
declare const evidenceManifest: EvidenceManifest;
void parseEvidenceManifest(JSON.stringify(evidenceManifest));
void writeEvidenceManifest({
  historyPath: 'test-results/aegiloc/history.jsonl',
  summaryPath: 'test-results/aegiloc/summary.json',
  manifestPath: 'test-results/aegiloc/manifest.json',
});
void verifyEvidenceManifest({
  manifestPath: 'test-results/aegiloc/manifest.json',
  requireAuthenticated: false,
});
const proposalBundle = generateHealingProposals(history, registry, {
  minimumObservations: DEFAULT_PROPOSAL_MINIMUM_OBSERVATIONS,
});
const proposal: HealingProposal | undefined = proposalBundle.proposals[0];
void renderHealingProposalReport(proposalBundle);
if (proposal !== undefined) {
  void verifyHealingProposal(proposal, registry);
}
const parsedBundle = parseHealingProposalBundle(JSON.stringify(proposalBundle));
void verifyHealingProposalBundle(parsedBundle, registry);
void renderReportViewer(history, evidenceSummary);
void generateReportViewer({
  historyPath: 'test-results/aegiloc/history.jsonl',
  summaryPath: 'test-results/aegiloc/summary.json',
  outputDirectory: 'test-results/aegiloc/viewer',
});
const reportTrust: ReportEvidenceTrust = { level: 'integrity' };
void reportTrust;

declare const fingerprintObservations: readonly PrimaryFingerprintObservation[];
const fingerprintProposals = generateFingerprintProposals(fingerprintObservations, registry, {
  minimumObservations: DEFAULT_FINGERPRINT_PROPOSAL_MINIMUM_OBSERVATIONS,
});
void fingerprintProposals;
void new InMemoryFingerprintObservationSink();
