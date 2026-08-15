import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedRuntimeExports = [
  'AUDIT_SCHEMA_VERSION',
  'ArtifactCaptureError',
  'AuditWriteError',
  'CompositeAuditSink',
  'ConsoleHealingResultSink',
  'DEFAULT_PROPOSAL_MINIMUM_OBSERVATIONS',
  'FileScreenshotCapture',
  'HEALING_PROPOSAL_SCHEMA_URL',
  'HEALING_PROPOSAL_SCHEMA_VERSION',
  'HEALING_MODES',
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
  'RegistryValidationError',
  'SCORE_WEIGHTS',
  'SUPPORTED_ARIA_ROLES',
  'TARGET_ACTIONS',
  'TargetActionNotAllowedError',
  'UnknownTargetError',
  'assessCandidates',
  'collectCandidates',
  'createHealer',
  'createHealingAuditEvent',
  'createHealingExecutionAuditEvent',
  'executePrimaryAction',
  'generateHealingProposals',
  'loadAuditHistory',
  'loadTargetRegistry',
  'parseAriaIdentity',
  'parseAuditHistory',
  'parseTargetRegistry',
  'rankCandidates',
  'resolvePrimaryLocator',
  'renderHealingProposalReport',
  'scoreCandidate',
  'verifyHealingProposal',
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
  './scripts/propose-heals.mjs',
  './dist/index.js.map',
  './dist/index.d.ts.map',
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

function proposalAuditEvents(index) {
  const candidateId = `input:accept-terms:${index}`;
  const assessmentId = `assessment-${index}`;
  const timestampPrefix = `2026-08-15T00:0${index}`;
  return [
    {
      schemaVersion: 1,
      eventType: 'locator-drift-assessed',
      eventId: assessmentId,
      timestamp: `${timestampPrefix}:00.000Z`,
      mode: 'guarded',
      modeDecision: 'eligible',
      targetKey: 'checkout.terms',
      action: 'check',
      primaryLocator: { type: 'testId', value: 'checkout-terms' },
      primaryFailure: { category: 'missing', errorName: 'TimeoutError' },
      collection: { status: 'completed', candidateCount: 1 },
      assessment: {
        eligible: true,
        reason: 'eligible',
        margin: 1,
        confidenceThreshold: 0.94,
        minimumScoreMargin: 0.18,
        topCandidateId: candidateId,
      },
      rankedCandidates: [
        {
          rank: 1,
          id: candidateId,
          role: 'checkbox',
          accessibleName: 'I agree to the store terms',
          tag: 'input',
          score: 1,
          details: [],
        },
      ],
    },
    {
      schemaVersion: 1,
      eventType: 'locator-heal-execution',
      eventId: `execution-${index}`,
      timestamp: `${timestampPrefix}:01.000Z`,
      parentEventId: assessmentId,
      mode: 'guarded',
      targetKey: 'checkout.terms',
      action: 'check',
      candidateId,
      status: 'succeeded',
      reason: 'succeeded',
      screenshots: [
        {
          phase: 'before',
          name: `before-${index}.png`,
          path: `test-results/healwright/before-${index}.png`,
          contentType: 'image/png',
        },
        {
          phase: 'after',
          name: `after-${index}.png`,
          path: `test-results/healwright/after-${index}.png`,
          contentType: 'image/png',
        },
      ],
    },
  ];
}

const cliDirectory = await mkdtemp(join(tmpdir(), 'healwright-package-check-'));
try {
  const historyPath = join(cliDirectory, 'history.jsonl');
  const jsonPath = join(cliDirectory, 'proposals.json');
  const markdownPath = join(cliDirectory, 'proposals.md');
  const history = [1, 2, 3]
    .flatMap(proposalAuditEvents)
    .map((event) => JSON.stringify(event))
    .join('\n');
  await writeFile(historyPath, `${history}\n`, 'utf8');
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
  if (
    bundle.proposals?.length !== 1 ||
    bundle.proposals[0]?.status !== 'review-required' ||
    !report.includes('Review required') ||
    !cliOutput.includes('Registry and test source were not modified')
  ) {
    throw new Error('Proposal CLI end-to-end verification failed');
  }
} finally {
  await rm(cliDirectory, { recursive: true, force: true });
}

process.stdout.write(
  `Verified ${expectedRuntimeExports.length} runtime exports, reporter and schema subpaths, the proposal CLI end to end, and ${new Set(artifactPaths).size} build artifacts.\n`,
);
