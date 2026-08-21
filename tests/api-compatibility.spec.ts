import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('checked-in public API inventory matches built declarations and runtime exports', async () => {
  const result = spawnSync(process.execPath, ['scripts/generate-api-snapshot.mjs', '--check'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);

  const snapshot = JSON.parse(
    await readFile(new URL('../api/public-api.json', import.meta.url), 'utf8'),
  ) as {
    package: { name: string; version: string };
    support: { node: string; playwrightTest: string };
    entrypoints: Record<
      string,
      { runtimeExports: readonly string[]; typeOnlyExports: readonly string[] }
    >;
    schemas: readonly { subpath: string; version: number }[];
  };
  expect(snapshot.package).toEqual({ name: 'healwright', version: '1.0.0' });
  expect(snapshot.support).toEqual({ node: '>=22 <25', playwrightTest: '>=1.50.0 <2' });
  expect(snapshot.entrypoints['.']?.runtimeExports).toEqual(
    [...(snapshot.entrypoints['.']?.runtimeExports ?? [])].sort(),
  );
  expect(snapshot.entrypoints['.']?.runtimeExports).toEqual(
    expect.arrayContaining([
      'createHealer',
      'PASSED_WITH_HEALING',
      'generateReportViewer',
      'verifyEvidenceManifest',
    ]),
  );
  expect(snapshot.entrypoints['.']?.typeOnlyExports).toEqual(
    expect.arrayContaining(['TargetRegistry', 'ReportEvidenceTrust', 'HealingMode']),
  );
  expect(snapshot.schemas).toHaveLength(6);
  expect(
    Object.fromEntries(snapshot.schemas.map((schema) => [schema.subpath, schema.version])),
  ).toEqual({
    './evidence-manifest-schema': 1,
    './evidence-summary-schema': 1,
    './governance-policy-schema': 1,
    './health-summary-schema': 1,
    './proposal-schema': 2,
    './registry-schema': 1,
  });
});
