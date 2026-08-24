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
  'DEFAULT_FINGERPRINT_PROPOSAL_MINIMUM_OBSERVATIONS',
  'EVIDENCE_AUTHENTICATION_ALGORITHM',
  'EVIDENCE_DIGEST_ALGORITHM',
  'EVIDENCE_MANIFEST_SCHEMA_VERSION',
  'EXECUTION_RISKS',
  'FileScreenshotCapture',
  'FINGERPRINT_OBSERVATION_SCHEMA_VERSION',
  'FINGERPRINT_PROPOSAL_SCHEMA_URL',
  'FINGERPRINT_PROPOSAL_SCHEMA_VERSION',
  'HEALING_PROPOSAL_SCHEMA_URL',
  'HEALING_PROPOSAL_SCHEMA_VERSION',
  'HEALING_MODES',
  'GOVERNANCE_POLICY_SCHEMA_VERSION',
  'HEALTH_SUMMARY_SCHEMA_VERSION',
  'GovernanceEvidenceError',
  'GovernancePolicyError',
  'Healer',
  'InMemoryFingerprintObservationSink',
  'InMemoryAuditSink',
  'InMemoryHealingResultSink',
  'JsonlAuditSink',
  'JsonlFingerprintObservationSink',
  'MissingPrimaryLocatorError',
  'MINIMUM_EVIDENCE_KEY_BYTES',
  'NoopAuditSink',
  'NoopFingerprintObservationSink',
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
  'TargetContextError',
  'UnknownTargetError',
  'assessCandidates',
  'auditEventsFromAttachments',
  'canonicalizeAuditEvents',
  'collectCandidates',
  'collectLocatorSuggestions',
  'createAuditEvidenceSummary',
  'createHealer',
  'createAuditProvenance',
  'createHealingAuditEvent',
  'createHealingExecutionAuditEvent',
  'createAegilocTest',
  'createPrimaryFingerprintObservation',
  'createPlaywrightAuditProvenance',
  'executePrimaryAction',
  'evaluateCandidateEligibility',
  'evaluateGovernance',
  'fingerprintFromCandidate',
  'generateFingerprintProposals',
  'generateHealingProposals',
  'generateReportViewer',
  'loadAuditHistory',
  'loadHealingProposalBundle',
  'loadGovernancePolicy',
  'loadFingerprintObservationHistory',
  'loadTargetRegistry',
  'parseAriaIdentity',
  'parseAuditHistory',
  'parseAuditProvenance',
  'parseEvidenceManifest',
  'parseFingerprintObservationHistory',
  'parseHealingProposalBundle',
  'parseGovernancePolicy',
  'parseTargetRegistry',
  'rankCandidates',
  'resolvePrimaryLocator',
  'renderHealingProposalReport',
  'renderFingerprintProposalReport',
  'renderReportViewer',
  'renderHealthSummary',
  'resolveExecutionRisk',
  'resolveTargetContext',
  'scoreCandidate',
  'snapshotLocatorCandidate',
  'serializeAuditHistory',
  'verifyHealingProposal',
  'verifyHealingProposalBundle',
  'verifyEvidenceManifest',
  'writeAuditEvidence',
  'writeEvidenceManifest',
  'writeHealthSummary',
];

const publicApi = await import('aegiloc');
for (const exportName of expectedRuntimeExports) {
  if (!(exportName in publicApi)) {
    throw new Error(`Built package is missing the public export "${exportName}"`);
  }
}

const reporterModule = await import('aegiloc/reporter');
if (typeof reporterModule.default !== 'function') {
  throw new TypeError('Built reporter subpath does not provide a default reporter class');
}
if (typeof reporterModule.healingStatusLines !== 'function') {
  throw new TypeError('Built reporter subpath does not provide healingStatusLines');
}
if (reporterModule.DEFAULT_EVIDENCE_OUTPUT_DIRECTORY !== 'test-results/aegiloc') {
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
  packageJson.exports['./evidence-manifest-schema'],
  packageJson.exports['./fingerprint-proposal-schema'],
  packageJson.exports['./governance-policy-schema'],
  packageJson.exports['./health-summary-schema'],
  './scripts/verify-evidence.mjs',
  './scripts/propose-heals.mjs',
  './scripts/propose-fingerprints.mjs',
  './scripts/verify-proposals.mjs',
  './scripts/evaluate-governance.mjs',
  './scripts/guard-publish.mjs',
  './scripts/reset-realistic-demo.mjs',
  './scripts/verify-docs.mjs',
  './scripts/verify-pack.mjs',
  './scripts/generate-sbom.mjs',
  './scripts/verify-reproducible-pack.mjs',
  './LICENSE',
  './docs/QUICKSTART.md',
  './docs/ADOPTION.md',
  './docs/COMPATIBILITY.md',
  './docs/COMPARATIVE-RESEARCH.md',
  './docs/MIGRATION-v1.1.md',
  './docs/TROUBLESHOOTING.md',
  './docs/CLI.md',
  './docs/REPORT-VIEWER.md',
  './docs/EVIDENCE-INTEGRITY.md',
  './docs/SUPPLY-CHAIN.md',
  './docs/CROSS-BROWSER-QUALIFICATION.md',
  './docs/REALISTIC-DEMO.md',
  './docs/KNOWN-RISKS.md',
  './docs/WHEN-NOT-TO-USE.md',
  './docs/ARCHITECTURE.md',
  './docs/SAFETY-MODEL.md',
  './docs/PRODUCT-POSITIONING.md',
  './docs/RELEASE-PROCESS.md',
  './docs/PORTFOLIO-SUMMARY.md',
  './docs/releases/v0.4.0.md',
  './docs/releases/v0.6.0.md',
  './docs/releases/v0.7.0.md',
  './docs/releases/v1.0.0.md',
  './docs/releases/v1.0.1.md',
  './docs/releases/v1.1.0.md',
  './docs/releases/v1.1.1.md',
  './docs/assets/aegiloc-report-v1.png',
  './api/public-api.json',
  './examples/basic-playwright/playwright.config.ts',
  './examples/basic-playwright/targets.json',
  './examples/basic-playwright/tsconfig.eslint.json',
  './examples/realistic-demo/README.md',
  './examples/realistic-demo/playwright.config.ts',
  './examples/realistic-demo/targets.json',
  './examples/realistic-demo/tests/storefront.spec.ts',
  './performance/candidate-collection-budget.json',
  './dist/index.js.map',
  './dist/index.d.ts.map',
  './dist/cli.js',
  './dist/cli.d.ts',
  './dist/evidence.js',
  './dist/evidence.d.ts',
  './dist/evidence-manifest.js',
  './dist/evidence-manifest.d.ts',
  './dist/context.js',
  './dist/context.d.ts',
  './dist/fingerprints.js',
  './dist/fingerprints.d.ts',
  './dist/fixture.js',
  './dist/fixture.d.ts',
  './dist/suggestions.js',
  './dist/suggestions.d.ts',
  './dist/proposal-validation.js',
  './dist/proposal-validation.d.ts',
  './dist/reporter.js.map',
  './dist/reporter.d.ts.map',
];

for (const artifactPath of new Set(artifactPaths)) {
  await access(new URL(`..${artifactPath.slice(1)}`, import.meta.url));
}

if (
  packageJson.private !== false ||
  packageJson.license !== 'MIT' ||
  packageJson.author !== 'Kamen Asenov' ||
  packageJson.repository?.url !== 'git+https://github.com/kamenAsenov/aegiloc.git' ||
  packageJson.publishConfig?.access !== 'public' ||
  packageJson.bin?.aegiloc !== './dist/cli.js'
) {
  throw new Error('Package publication metadata is incomplete or inconsistent');
}
if (!packageJson.scripts?.prepublishOnly?.includes('scripts/guard-publish.mjs')) {
  throw new Error('Package publication is missing its explicit human-confirmation guard');
}

const blockedPublish = spawnSync(process.execPath, ['scripts/guard-publish.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  encoding: 'utf8',
  env: { ...process.env, AEGILOC_PUBLISH: '' },
});
if (blockedPublish.status === 0 || !blockedPublish.stderr.includes('publication blocked')) {
  throw new Error('Publication guard did not reject an unconfirmed publish');
}
const confirmedPublish = spawnSync(process.execPath, ['scripts/guard-publish.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  encoding: 'utf8',
  env: { ...process.env, AEGILOC_PUBLISH: 'I_UNDERSTAND_THIS_PUBLISHES_TO_NPM' },
});
if (confirmedPublish.status !== 0 || !confirmedPublish.stdout.includes('confirmation accepted')) {
  throw new Error('Publication guard did not accept the exact documented confirmation');
}

const repositoryPath = fileURLToPath(new URL('..', import.meta.url));
const productCliHelp = execFileSync(process.execPath, ['dist/cli.js', '--help'], {
  cwd: repositoryPath,
  encoding: 'utf8',
});
if (
  !productCliHelp.includes('aegiloc init') ||
  !productCliHelp.includes('aegiloc attest') ||
  !productCliHelp.includes('No command rewrites tests')
) {
  throw new Error('Built Aegiloc CLI help is missing its onboarding or safety contract');
}
const cliHelp = execFileSync(process.execPath, ['scripts/propose-heals.mjs', '--help'], {
  cwd: repositoryPath,
  encoding: 'utf8',
});
if (!cliHelp.includes('never modifies the registry or test source')) {
  throw new Error('Proposal CLI help is missing its non-mutation safety contract');
}
const fingerprintCliHelp = execFileSync(
  process.execPath,
  ['scripts/propose-fingerprints.mjs', '--help'],
  { cwd: repositoryPath, encoding: 'utf8' },
);
if (!fingerprintCliHelp.includes('never modifies the registry or test source')) {
  throw new Error('Fingerprint proposal CLI help is missing its non-mutation safety contract');
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
      locatorSuggestions: [
        {
          strategy: 'role',
          locator: {
            type: 'role',
            role: 'checkbox',
            name: 'I agree to the store terms',
            exact: true,
          },
          matchCount: 1,
          matchesCandidate: true,
        },
      ],
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
          auditPath: `test-results/aegiloc/before-${index}.png`,
          contentType: 'image/png',
        },
        {
          phase: 'after',
          name: `after-${index}.png`,
          filePath: `/private/not-audited/after-${index}.png`,
          auditPath: `test-results/aegiloc/after-${index}.png`,
          contentType: 'image/png',
        },
      ],
    }),
  ];
}

const cliDirectory = await mkdtemp(join(tmpdir(), 'aegiloc-package-check-'));
try {
  const historyPath = join(cliDirectory, 'history.jsonl');
  const summaryPath = join(cliDirectory, 'summary.json');
  const manifestPath = join(cliDirectory, 'manifest.json');
  const jsonPath = join(cliDirectory, 'proposals.json');
  const markdownPath = join(cliDirectory, 'proposals.md');
  const healthJsonPath = join(cliDirectory, 'health.json');
  const healthMarkdownPath = join(cliDirectory, 'health.md');
  const fingerprintHistoryPath = join(cliDirectory, 'fingerprints.jsonl');
  const fingerprintJsonPath = join(cliDirectory, 'fingerprint-proposals.json');
  const fingerprintMarkdownPath = join(cliDirectory, 'fingerprint-proposals.md');
  const historyEvents = [1, 2, 3].flatMap(proposalAuditEvents);
  await publicApi.writeAuditEvidence(historyEvents, {
    historyPath,
    summaryPath,
    generatedAt: '2026-08-16T00:00:00.000Z',
  });
  const fingerprintObservations = [1, 2, 3].map((index) =>
    publicApi.createPrimaryFingerprintObservation({
      eventId: `package-fingerprint-${String(index)}`,
      timestamp: `2026-08-16T00:0${String(index)}:00.000Z`,
      provenance: {
        runId: `package-fingerprint-run-${String(index)}`,
        testId: 'package-fingerprint-test',
        projectName: 'chromium',
        retry: 0,
        commitSha: 'abcdef0123456789',
      },
      targetKey: 'checkout.terms',
      action: 'check',
      primaryLocator: { type: 'testId', value: 'checkout-terms' },
      candidate: {
        id: 'input:accept-terms:0',
        role: 'checkbox',
        accessibleName: 'I agree to the store terms',
        tag: 'input',
        stableAttributes: { name: 'terms', type: 'checkbox' },
        visibleText: '',
        ancestorText: [],
        neighborText: [],
      },
    }),
  );
  await writeFile(
    fingerprintHistoryPath,
    `${fingerprintObservations.map((observation) => JSON.stringify(observation)).join('\n')}\n`,
    'utf8',
  );
  const manifestCreateOutput = execFileSync(
    process.execPath,
    [
      'dist/cli.js',
      'attest',
      '--history',
      historyPath,
      '--summary',
      summaryPath,
      '--out',
      manifestPath,
    ],
    { cwd: repositoryPath, encoding: 'utf8' },
  );
  const manifestVerifyOutput = execFileSync(
    process.execPath,
    ['dist/cli.js', 'verify', '--manifest', manifestPath],
    { cwd: repositoryPath, encoding: 'utf8' },
  );
  const manifestVerification = await publicApi.verifyEvidenceManifest({ manifestPath });
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
  const fingerprintCliOutput = execFileSync(
    process.execPath,
    [
      'scripts/propose-fingerprints.mjs',
      '--observations',
      fingerprintHistoryPath,
      '--registry',
      join(repositoryPath, 'registry', 'targets.json'),
      '--json',
      fingerprintJsonPath,
      '--markdown',
      fingerprintMarkdownPath,
    ],
    { cwd: repositoryPath, encoding: 'utf8' },
  );
  const bundle = JSON.parse(await readFile(jsonPath, 'utf8'));
  const report = await readFile(markdownPath, 'utf8');
  const health = JSON.parse(await readFile(healthJsonPath, 'utf8'));
  const healthReport = await readFile(healthMarkdownPath, 'utf8');
  const fingerprintBundle = JSON.parse(await readFile(fingerprintJsonPath, 'utf8'));
  const fingerprintReport = await readFile(fingerprintMarkdownPath, 'utf8');
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
    manifestVerification.eventCount !== 6 ||
    manifestVerification.authenticated ||
    !manifestCreateOutput.includes('Created integrity evidence manifest') ||
    !manifestVerifyOutput.includes('unsigned integrity manifest') ||
    bundle.proposals?.length !== 1 ||
    bundle.proposals[0]?.status !== 'review-required' ||
    !report.includes('Review required') ||
    !cliOutput.includes('Registry and test source were not modified') ||
    fingerprintBundle.proposals?.length !== 1 ||
    fingerprintBundle.proposals[0]?.status !== 'review-required' ||
    !fingerprintReport.includes('never modify the target registry') ||
    !fingerprintCliOutput.includes('Registry and test source were not modified') ||
    !verifyOutput.includes('hashes and current registry state are valid') ||
    !evidenceOutput.includes('matching run summary') ||
    !governanceOutput.includes('AEGILOC_GOVERNANCE PASS') ||
    health.status !== 'pass' ||
    !healthReport.includes('Aegiloc health summary')
  ) {
    throw new Error('Proposal CLI end-to-end verification failed');
  }
  const tamperedPath = join(cliDirectory, 'tampered.json');
  bundle.proposals[0].proposalId = `sha256:${'0'.repeat(64)}`;
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
  `Verified ${expectedRuntimeExports.length} runtime exports, reporter and schema subpaths, evidence, locator proposal, fingerprint proposal, and governance CLIs end to end, and ${new Set(artifactPaths).size} build artifacts.\n`,
);
