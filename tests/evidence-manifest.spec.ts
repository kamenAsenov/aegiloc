import { chmod, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { Ajv2020 } from 'ajv/dist/2020.js';

import {
  assessCandidates,
  createHealingAuditEvent,
  parseEvidenceManifest,
  verifyEvidenceManifest,
  writeAuditEvidence,
  writeEvidenceManifest,
  type HealwrightAuditEvent,
} from '../src/index.js';

const generatedAt = '2026-08-20T20:00:00.000Z';

function events(): readonly HealwrightAuditEvent[] {
  return [
    createHealingAuditEvent({
      eventId: 'manifest-assessment-1',
      timestamp: '2026-08-20T19:59:00.000Z',
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
    }),
    createHealingAuditEvent({
      eventId: 'manifest-assessment-2',
      timestamp: '2026-08-20T19:59:01.000Z',
      mode: 'observe',
      modeDecision: 'observed',
      targetKey: 'checkout.placeOrder',
      action: 'click',
      primaryLocator: { type: 'role', role: 'button', name: 'Place order', exact: true },
      primaryError: new Error('not serialized'),
      collectionStatus: 'completed',
      assessment: assessCandidates([], {
        enabled: true,
        confidenceThreshold: 0.94,
        minimumScoreMargin: 0.18,
      }),
      rankedCandidates: [],
    }),
  ];
}

async function evidenceFixture(outputDirectory: string): Promise<{
  readonly historyPath: string;
  readonly summaryPath: string;
  readonly manifestPath: string;
}> {
  const historyPath = `${outputDirectory}/history.jsonl`;
  const summaryPath = `${outputDirectory}/summary.json`;
  const manifestPath = `${outputDirectory}/manifest.json`;
  await writeAuditEvidence(events(), { historyPath, summaryPath, generatedAt });
  return { historyPath, summaryPath, manifestPath };
}

test('writes and verifies a deterministic unsigned evidence manifest', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const paths = await evidenceFixture(testInfo.outputPath('unsigned'));
  const manifest = await writeEvidenceManifest(paths);

  expect(manifest).toMatchObject({
    schemaVersion: 1,
    generatedAt,
    files: [
      { kind: 'history', path: 'history.jsonl', algorithm: 'sha256' },
      { kind: 'summary', path: 'summary.json', algorithm: 'sha256' },
    ],
  });
  expect(manifest).not.toHaveProperty('authentication');
  const verified = await verifyEvidenceManifest({ manifestPath: paths.manifestPath });
  expect(verified).toMatchObject({ authenticated: false, eventCount: 2 });
});

test('authenticates a manifest with HMAC-SHA-256 and enforces key identity', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const paths = await evidenceFixture(testInfo.outputPath('authenticated'));
  const key = Buffer.alloc(32, 0x41);
  await writeEvidenceManifest({
    ...paths,
    authentication: { key, keyId: 'ci-2026-q3' },
  });

  await expect(
    verifyEvidenceManifest({
      manifestPath: paths.manifestPath,
      key,
      expectedKeyId: 'ci-2026-q3',
      requireAuthenticated: true,
    }),
  ).resolves.toMatchObject({ authenticated: true, eventCount: 2 });
  await expect(
    verifyEvidenceManifest({ manifestPath: paths.manifestPath, key: Buffer.alloc(32, 0x42) }),
  ).rejects.toThrow(/authentication failed/);
  await expect(
    verifyEvidenceManifest({
      manifestPath: paths.manifestPath,
      key,
      expectedKeyId: 'retired-key',
    }),
  ).rejects.toThrow(/keyId mismatch/);
});

test('never treats unsigned or weak-key evidence as authenticated', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const paths = await evidenceFixture(testInfo.outputPath('authentication-policy'));
  await writeEvidenceManifest(paths);

  await expect(
    verifyEvidenceManifest({ manifestPath: paths.manifestPath, requireAuthenticated: true }),
  ).rejects.toThrow(/authenticated evidence manifest is required/);
  await expect(
    verifyEvidenceManifest({ manifestPath: paths.manifestPath, key: Buffer.alloc(32) }),
  ).rejects.toThrow(/unsigned; supplied key was not used/);
  await expect(
    writeEvidenceManifest({
      ...paths,
      manifestPath: `${testInfo.outputPath('authentication-policy')}/weak.json`,
      authentication: { key: Buffer.alloc(31), keyId: 'weak' },
    }),
  ).rejects.toThrow(/at least 32 bytes/);
});

test('detects missing, truncated, replaced, and reordered evidence', async ({
  browserName,
}, testInfo) => {
  void browserName;

  const missing = await evidenceFixture(testInfo.outputPath('missing'));
  await writeEvidenceManifest(missing);
  await unlink(missing.summaryPath);
  await expect(verifyEvidenceManifest({ manifestPath: missing.manifestPath })).rejects.toThrow(
    /missing or unreadable/,
  );

  const truncated = await evidenceFixture(testInfo.outputPath('truncated'));
  await writeEvidenceManifest(truncated);
  const truncatedContents = await readFile(truncated.historyPath, 'utf8');
  await writeFile(truncated.historyPath, truncatedContents.slice(0, -20), 'utf8');
  await expect(verifyEvidenceManifest({ manifestPath: truncated.manifestPath })).rejects.toThrow(
    /history evidence is truncated/,
  );

  const replaced = await evidenceFixture(testInfo.outputPath('replaced'));
  await writeEvidenceManifest(replaced);
  const replacedContents = await readFile(replaced.summaryPath, 'utf8');
  await writeFile(
    replaced.summaryPath,
    replacedContents.replace('"total": 2', '"total": 3'),
    'utf8',
  );
  await expect(verifyEvidenceManifest({ manifestPath: replaced.manifestPath })).rejects.toThrow(
    /summary evidence was replaced or modified/,
  );

  const reordered = await evidenceFixture(testInfo.outputPath('reordered'));
  await writeEvidenceManifest(reordered);
  const reorderedContents = await readFile(reordered.historyPath, 'utf8');
  const lines = reorderedContents.trimEnd().split('\n').reverse();
  await writeFile(reordered.historyPath, `${lines.join('\n')}\n`, 'utf8');
  await expect(verifyEvidenceManifest({ manifestPath: reordered.manifestPath })).rejects.toThrow(
    /reordered or not canonical/,
  );
});

test('rejects manifest tampering, reordered entries, and unreviewed overwrite', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const paths = await evidenceFixture(testInfo.outputPath('manifest-tampering'));
  await writeEvidenceManifest(paths);
  await expect(writeEvidenceManifest(paths)).rejects.toMatchObject({ code: 'EEXIST' });

  const parsed = JSON.parse(await readFile(paths.manifestPath, 'utf8')) as {
    files: unknown[];
  };
  await writeFile(
    paths.manifestPath,
    `${JSON.stringify({ ...parsed, files: [...parsed.files].reverse() }, null, 2)}\n`,
    'utf8',
  );
  await expect(verifyEvidenceManifest({ manifestPath: paths.manifestPath })).rejects.toThrow(
    /ordered history then summary/,
  );
});

test('refuses force-overwrite through a symbolic link', async ({ browserName }, testInfo) => {
  void browserName;
  const directory = testInfo.outputPath('symlink');
  await mkdir(directory, { recursive: true });
  const paths = await evidenceFixture(directory);
  const protectedPath = `${directory}/protected.json`;
  await writeFile(protectedPath, '{"protected":true}\n', { encoding: 'utf8', mode: 0o600 });
  await chmod(protectedPath, 0o600);
  await symlink(protectedPath, paths.manifestPath);

  await expect(writeEvidenceManifest({ ...paths, force: true })).rejects.toThrow(
    /refusing to overwrite symbolic link/,
  );
  expect(await readFile(protectedPath, 'utf8')).toBe('{"protected":true}\n');
});

test('runtime parsing and generated manifests satisfy the checked-in JSON Schema', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const paths = await evidenceFixture(testInfo.outputPath('schema'));
  const manifest = await writeEvidenceManifest({
    ...paths,
    authentication: { key: Buffer.alloc(32, 0x43), keyId: 'schema-key' },
  });
  const schema = JSON.parse(
    await readFile(new URL('../registry/evidence-manifest.schema.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    formats: { 'date-time': true },
  }).compile(schema);

  expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  expect(validate({ ...manifest, unexpected: true })).toBe(false);
  expect(() => parseEvidenceManifest(JSON.stringify({ ...manifest, unexpected: true }))).toThrow(
    /unsupported or missing fields/,
  );
});
