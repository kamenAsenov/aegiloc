import { access, readFile } from 'node:fs/promises';

const expectedRuntimeExports = [
  'AUDIT_SCHEMA_VERSION',
  'ArtifactCaptureError',
  'AuditWriteError',
  'CompositeAuditSink',
  'ConsoleHealingResultSink',
  'FileScreenshotCapture',
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
  'loadTargetRegistry',
  'parseAriaIdentity',
  'parseTargetRegistry',
  'rankCandidates',
  'resolvePrimaryLocator',
  'scoreCandidate',
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
  './dist/index.js.map',
  './dist/index.d.ts.map',
  './dist/reporter.js.map',
  './dist/reporter.d.ts.map',
];

for (const artifactPath of new Set(artifactPaths)) {
  await access(new URL(`..${artifactPath.slice(1)}`, import.meta.url));
}

process.stdout.write(
  `Verified ${expectedRuntimeExports.length} runtime exports, the reporter subpath, and ${new Set(artifactPaths).size} build artifacts.\n`,
);
