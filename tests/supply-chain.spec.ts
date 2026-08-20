import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function generateSbom(outputPath: string, check = false) {
  return spawnSync(
    process.execPath,
    ['scripts/generate-sbom.mjs', '--out', outputPath, ...(check ? ['--check'] : [])],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
}

test('generates a deterministic sorted CycloneDX inventory from the frozen lockfile', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const outputPath = testInfo.outputPath('sbom.cdx.json');
  const first = generateSbom(outputPath);
  expect(first.status, first.stderr).toBe(0);
  const firstContents = await readFile(outputPath, 'utf8');
  const verification = generateSbom(outputPath, true);
  expect(verification.status, verification.stderr).toBe(0);
  expect(await readFile(outputPath, 'utf8')).toBe(firstContents);

  const sbom = JSON.parse(firstContents) as {
    bomFormat: string;
    specVersion: string;
    serialNumber?: string;
    metadata: { timestamp?: string; component: { name: string; version: string } };
    components: readonly { purl: string; hashes?: readonly { alg: string }[] }[];
  };
  expect(sbom).toMatchObject({
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    metadata: { component: { name: 'healwright', version: '0.7.0' } },
  });
  expect(sbom.serialNumber).toBeUndefined();
  expect(sbom.metadata.timestamp).toBeUndefined();
  expect(sbom.components.length).toBeGreaterThan(80);
  expect(sbom.components.map((component) => component.purl)).toEqual(
    [...sbom.components.map((component) => component.purl)].sort(),
  );
  expect(sbom.components.some((component) => component.hashes?.[0]?.alg === 'SHA-512')).toBe(true);

  await writeFile(outputPath, `${firstContents} `, 'utf8');
  const stale = generateSbom(outputPath, true);
  expect(stale.status).toBe(1);
  expect(stale.stderr).toContain('stale or non-deterministic');
});

test('CI reviews dependencies and produces attestable package and SBOM artifacts', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const dependabot = await readFile(new URL('../.github/dependabot.yml', import.meta.url), 'utf8');

  expect(workflow).toContain('actions/dependency-review-action@v5');
  expect(workflow).toContain('run: pnpm package:reproducible');
  expect(workflow).toContain('run: pnpm supply-chain:sbom:check');
  expect(workflow.match(/uses: actions\/attest@v4/g)).toHaveLength(2);
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain('artifact-metadata: write');
  expect(workflow.indexOf('run: pnpm evidence:manifest:verify')).toBeLessThan(
    workflow.indexOf('run: pnpm test:cross-browser'),
  );
  expect(dependabot).toContain('package-ecosystem: npm');
  expect(dependabot).toContain('package-ecosystem: github-actions');
});
