import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedRuntimeExports = [
  'AUDIT_ATTACHMENT_CONTENT_TYPE',
  'AUDIT_ATTACHMENT_PREFIX',
  'AUDIT_EVIDENCE_SUMMARY_SCHEMA_VERSION',
  'AUDIT_SCHEMA_VERSION',
  'AUDIT_PROVENANCE_VERSION',
  'ArtifactCaptureError',
  'AuditEvidenceError',
  'AuditWriteError',
  'CANDIDATE_ELIGIBILITY_REASONS',
  'CompositeAuditSink',
  'ConsoleHealingResultSink',
  'DEFAULT_PROPOSAL_MINIMUM_OBSERVATIONS',
  'EXECUTION_RISKS',
  'FileScreenshotCapture',
  'HEALING_PROPOSAL_SCHEMA_URL',
  'HEALING_PROPOSAL_SCHEMA_VERSION',
  'HEALING_MODES',
  'GOVERNANCE_POLICY_SCHEMA_VERSION',
  'HEALTH_SUMMARY_SCHEMA_VERSION',
  'GovernanceEvidenceError',
  'GovernancePolicyError',
  'Healer',
  'InMemoryAuditSink',
  'InMemoryHealingResultSink',
  'JsonlAuditSink',
  'MissingPrimaryLocatorError',
  'NoopAuditSink',
  'NoopHealingResultSink',
  'PASSED_WITH_HEALING',
  'PlaywrightAttachmentAuditSink',
  'PlaywrightHealingResultSink',
  'ProposalHistoryError',
  'ProposalBundleValidationError',
  'RegistryValidationError',
  'SCORE_WEIGHTS',
  'SUPPORTED_ARIA_ROLES',
  'TARGET_ACTIONS',
  'TargetActionNotAllowedError',
  'UnknownTargetError',
  'assessCandidates',
  'auditEventsFromAttachments',
  'canonicalizeAuditEvents',
  'collectCandidates',
  'createAuditEvidenceSummary',
  'createHealer',
  'createAuditProvenance',
  'createHealingAuditEvent',
  'createHealingExecutionAuditEvent',
  'createPlaywrightAuditProvenance',
  'executePrimaryAction',
  'evaluateCandidateEligibility',
  'evaluateGovernance',
  'generateHealingProposals',
  'loadAuditHistory',
  'loadHealingProposalBundle',
  'loadGovernancePolicy',
  'loadTargetRegistry',
  'parseAriaIdentity',
  'parseAuditHistory',
  'parseAuditProvenance',
  'parseHealingProposalBundle',
  'parseGovernancePolicy',
  'parseTargetRegistry',
  'rankCandidates',
  'resolvePrimaryLocator',
  'renderHealingProposalReport',
  'renderHealthSummary',
  'resolveExecutionRisk',
  'scoreCandidate',
  'serializeAuditHistory',
  'verifyHealingProposal',
  'verifyHealingProposalBundle',
  'writeAuditEvidence',
  'writeHealthSummary',
];

const publicApi = await import('healwright');
for (const exportName of expectedRuntimeExports) {
  if (!(exportName in publicApi)) {
    throw new Error(`Built package is missing the public export "${exportName}"`);
  }
}

const reporterModule = await import('healwright/reporter');
if (typeof reporterModule.default !== 'function') {
  throw new TypeError('Built reporter subpath does not provide a default reporter class');
}
if (typeof reporterModule.healingStatusLines !== 'function') {
  throw new TypeError('Built reporter subpath does not provide healingStatusLines');
}
if (reporterModule.DEFAULT_EVIDENCE_OUTPUT_DIRECTORY !== 'test-results/healwright') {
  throw new TypeError('Built reporter subpath has an invalid evidence output default');
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const artifactPaths = [
  packageJson.main,
  packageJson.types,
  packageJson.exports['.'].import,
  packageJson.exports['.'].types,
  packageJson.exports['./reporter'].import,
  packageJson.exports['./reporter'].types,
  packageJson.exports['./registry-schema'],
  packageJson.exports['./proposal-schema'],
  packageJson.exports['./evidence-summary-schema'],
  packageJson.exports['./governance-policy-schema'],
  packageJson.exports['./health-summary-schema'],
  './scripts/verify-evidence.mjs',
  './scripts/propose-heals.mjs',
  './scripts/verify-proposals.mjs',
  './scripts/evaluate-governance.mjs',
  './dist/index.js.map',
  './dist/index.d.ts.map',
  './dist/evidence.js',
  './dist/evidence.d.ts',
  './dist/proposal-validation.js',
  './dist/proposal-validation.d.ts',
  './dist/reporter.js.map',
  './dist/reporter.d.ts.map',
];

for (const artifactPath of new Set(artifactPaths)) {
  await access(new URL(`..${artifactPath.slice(1)}`, import.meta.url));
}

const repositoryPath = fileURLToPath(new URL('..', import.meta.url));
const cliHelp = execFileSync(process.execPath, ['scripts/propose-heals.mjs', '--help'], {
  cwd: repositoryPath,
  encoding: 'utf8',
});
if (!cliHelp.includes('never modifies the registry or test source')) {
  throw new Error('Proposal CLI help is missing its non-mutation safety contract');
}
const verifyCliHelp = execFileSync(process.execPath, ['scripts/verify-proposals.mjs', '--help'], {
  cwd: repositoryPath,
  encoding: 'utf8',
});
if (!verifyCliHelp.includes('exits nonzero')) {
  throw new Error('Proposal verification CLI help is missing its failure contract');
}
const evidenceCliHelp = execFileSync(process.execPath, ['scripts/verify-evidence.mjs', '--help'], {
  cwd: repositoryPath,
  encoding: 'utf8',
});
if (!evidenceCliHelp.includes('non-canonical')) {
  throw new Error('Evidence verification CLI help is missing its canonical-output contract');
}
const governanceCliHelp = execFileSync(
  process.execPath,
  ['scripts/evaluate-governance.mjs', '--help'],
  { cwd: repositoryPath, encoding: 'utf8' },
);
if (!governanceCliHelp.includes('0 policy pass, 1 policy violation, 2 malformed')) {
  throw new Error('Governance CLI help is missing its provider-neutral exit-code contract');
}

function proposalAuditEvents(index) {
  const candidateId = `input:accept-terms:${index}`;
  const assessmentId = `assessment-${index}`;
  const timestampPrefix = `2026-08-15T00:0${index}`;
  const provenance = {
    runId: `package-check-run-${index}`,
    testId: 'package-check-test',
    projectName: 'chromium',
    retry: 0,
    commitSha: 'abcdef0123456789',
  };
  const rankedCandidates = publicApi.rankCandidates(
    {
      accessibleRole: 'checkbox',
      accessibleName: 'I agree to the store terms',
      tag: 'input',
      stableAttributes: { name: 'terms', type: 'checkbox' },
    },
    [
      {
        id: candidateId,
        role: 'checkbox',
        accessibleName: 'I agree to the store terms',
        tag: 'input',
        stableAttributes: { name: 'terms', type: 'checkbox' },
        visibleText: '',
        ancestorText: [],
        neighborText: [],
      },
    ],
    'check',
  );
  const assessment = publicApi.assessCandidates(rankedCandidates, {
    enabled: true,
    confidenceThreshold: 0.94,
    minimumScoreMargin: 0.18,
  });
  return [
    publicApi.createHealingAuditEvent({
      eventId: assessmentId,
      timestamp: `${timestampPrefix}:00.000Z`,
      provenance,
      mode: 'guarded',
      modeDecision: 'eligible',
      targetKey: 'checkout.terms',
      action: 'check',
      primaryLocator: { type: 'testId', value: 'checkout-terms' },
      primaryError: new Error('not serialized'),
      collectionStatus: 'completed',
      assessment,
      rankedCandidates,
    }),
    publicApi.createHealingExecutionAuditEvent({
      eventId: `execution-${index}`,
      timestamp: `${timestampPrefix}:01.000Z`,
      provenance,
      parentEventId: assessmentId,
      targetKey: 'checkout.terms',
      action: 'check',
      candidateId,
      status: 'succeeded',
      reason: 'succeeded',
      screenshots: [
        {
          phase: 'before',
          name: `before-${index}.png`,
          filePath: `/private/not-audited/before-${index}.png`,
          auditPath: `test-results/healwright/before-${index}.png`,
          contentType: 'image/png',
        },
        {
          phase: 'after',
          name: `after-${index}.png`,
          filePath: `/private/not-audited/after-${index}.png`,
          auditPath: `test-results/healwright/after-${index}.png`,
          contentType: 'image/png',
        },
      ],
    }),
  ];
}

const cliDirectory = await mkdtemp(join(tmpdir(), 'healwright-package-check-'));
try {
  const historyPath = join(cliDirectory, 'history.jsonl');
  const summaryPath = join(cliDirectory, 'summary.json');
  const jsonPath = join(cliDirectory, 'proposals.json');
  const markdownPath = join(cliDirectory, 'proposals.md');
  const healthJsonPath = join(cliDirectory, 'health.json');
  const healthMarkdownPath = join(cliDirectory, 'health.md');
  const historyEvents = [1, 2, 3].flatMap(proposalAuditEvents);
  await publicApi.writeAuditEvidence(historyEvents, {
    historyPath,
    summaryPath,
    generatedAt: '2026-08-16T00:00:00.000Z',
  });
  const evidenceOutput = execFileSync(
    process.execPath,
    ['scripts/verify-evidence.mjs', '--history', historyPath, '--summary', summaryPath],
    { cwd: repositoryPath, encoding: 'utf8' },
  );
  const governanceOutput = execFileSync(
    process.execPath,
    [
      'scripts/evaluate-governance.mjs',
      '--history',
      historyPath,
      '--registry',
      join(repositoryPath, 'registry', 'targets.json'),
      '--policy',
      join(repositoryPath, 'governance', 'policy.json'),
      '--json',
      healthJsonPath,
      '--markdown',
      healthMarkdownPath,
      '--evaluated-at',
      '2026-08-16T00:00:00.000Z',
    ],
    { cwd: repositoryPath, encoding: 'utf8' },
  );
  const cliOutput = execFileSync(
    process.execPath,
    [
      'scripts/propose-heals.mjs',
      '--history',
      historyPath,
      '--registry',
      join(repositoryPath, 'registry', 'targets.json'),
      '--json',
      jsonPath,
      '--markdown',
      markdownPath,
    ],
    { cwd: repositoryPath, encoding: 'utf8' },
  );
  const bundle = JSON.parse(await readFile(jsonPath, 'utf8'));
  const report = await readFile(markdownPath, 'utf8');
  const health = JSON.parse(await readFile(healthJsonPath, 'utf8'));
  const healthReport = await readFile(healthMarkdownPath, 'utf8');
  const verifyOutput = execFileSync(
    process.execPath,
    [
      'scripts/verify-proposals.mjs',
      '--proposal',
      jsonPath,
      '--registry',
      join(repositoryPath, 'registry', 'targets.json'),
    ],
    { cwd: repositoryPath, encoding: 'utf8' },
  );
  if (
    bundle.proposals?.length !== 1 ||
    bundle.proposals[0]?.status !== 'review-required' ||
    !report.includes('Review required') ||
    !cliOutput.includes('Registry and test source were not modified') ||
    !verifyOutput.includes('hashes and current registry state are valid') ||
    !evidenceOutput.includes('matching run summary') ||
    !governanceOutput.includes('HEALWRIGHT_GOVERNANCE PASS') ||
    health.status !== 'pass' ||
    !healthReport.includes('Healwright health summary')
  ) {
    throw new Error('Proposal CLI end-to-end verification failed');
  }
  const tamperedPath = join(cliDirectory, 'tampered.json');
  bundle.proposals[0].suggestedPrimary.name = 'Tampered after generation';
  bundle.proposals[0].candidate.accessibleName = 'Tampered after generation';
  await writeFile(tamperedPath, `${JSON.stringify(bundle)}\n`, 'utf8');
  const tamperedVerification = spawnSync(
    process.execPath,
    [
      'scripts/verify-proposals.mjs',
      '--proposal',
      tamperedPath,
      '--registry',
      join(repositoryPath, 'registry', 'targets.json'),
    ],
    { cwd: repositoryPath, encoding: 'utf8' },
  );
  if (tamperedVerification.status === 0 || !tamperedVerification.stderr.includes('hash-mismatch')) {
    throw new Error('Proposal verification CLI did not reject tampering');
  }
  const tamperedSummaryPath = join(cliDirectory, 'tampered-summary.json');
  const tamperedSummary = JSON.parse(await readFile(summaryPath, 'utf8'));
  tamperedSummary.events.total += 1;
  await writeFile(tamperedSummaryPath, `${JSON.stringify(tamperedSummary)}\n`, 'utf8');
  const tamperedEvidenceVerification = spawnSync(
    process.execPath,
    ['scripts/verify-evidence.mjs', '--history', historyPath, '--summary', tamperedSummaryPath],
    { cwd: repositoryPath, encoding: 'utf8' },
  );
  if (
    tamperedEvidenceVerification.status === 0 ||
    !tamperedEvidenceVerification.stderr.includes('does not match')
  ) {
    throw new Error('Evidence verification CLI did not reject a mismatched summary');
  }
} finally {
  await rm(cliDirectory, { recursive: true, force: true });
}

process.stdout.write(
  `Verified ${expectedRuntimeExports.length} runtime exports, reporter and schema subpaths, evidence, proposal, and governance CLIs end to end, and ${new Set(artifactPaths).size} build artifacts.\n`,
);
