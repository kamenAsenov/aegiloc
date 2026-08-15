import type { Page } from '@playwright/test';
import {
  DEFAULT_PROPOSAL_MINIMUM_OBSERVATIONS,
  InMemoryAuditSink,
  NoopHealingResultSink,
  createHealer,
  createAuditProvenance,
  generateHealingProposals,
  renderHealingProposalReport,
  parseHealingProposalBundle,
  verifyHealingProposal,
  verifyHealingProposalBundle,
  type HealwrightAuditEvent,
  type HealingProposal,
  type TargetRegistry,
} from 'healwright';
import HealwrightReporter, { healingStatusLines } from 'healwright/reporter';

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
void HealwrightReporter;
void healingStatusLines;

declare const history: readonly HealwrightAuditEvent[];
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
