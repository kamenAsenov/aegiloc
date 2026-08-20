import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const defaultOutput = 'test-results/supply-chain/sbom.cdx.json';

function parseArguments(arguments_) {
  const options = { output: defaultOutput, check: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--check') {
      options.check = true;
      continue;
    }
    if (argument !== '--out') throw new TypeError(`Unknown option: ${argument}`);
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError('--out requires a path');
    }
    options.output = value;
    index += 1;
  }
  return options;
}

function packageIdentity(lockKey) {
  const withoutPeers = lockKey.split('(')[0];
  const delimiter = withoutPeers.lastIndexOf('@');
  if (delimiter <= 0 || delimiter === withoutPeers.length - 1) return undefined;
  const name = withoutPeers.slice(0, delimiter);
  const version = withoutPeers.slice(delimiter + 1);
  if (version.startsWith('npm:')) return undefined;
  return { name, version };
}

function packageUrl(name, version) {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    if (slash === -1) throw new TypeError(`Scoped package name is malformed: ${name}`);
    return `pkg:npm/${encodeURIComponent(name.slice(0, slash))}/${encodeURIComponent(name.slice(slash + 1))}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function sha512Hash(integrity) {
  if (integrity === undefined || !integrity.startsWith('sha512-')) return [];
  const encoded = integrity.slice('sha512-'.length);
  const value = Buffer.from(encoded, 'base64');
  if (value.byteLength !== 64) throw new TypeError('pnpm lockfile contains malformed SHA-512');
  return [{ alg: 'SHA-512', content: value.toString('hex') }];
}

function parseLockPackages(lockfile) {
  const packagesIndex = lockfile.indexOf('\npackages:\n');
  const snapshotsIndex = lockfile.indexOf('\nsnapshots:\n');
  if (packagesIndex === -1 || snapshotsIndex === -1 || snapshotsIndex <= packagesIndex) {
    throw new TypeError(
      'pnpm-lock.yaml does not contain canonical packages and snapshots sections',
    );
  }
  const lines = lockfile.slice(packagesIndex + '\npackages:\n'.length, snapshotsIndex).split('\n');
  const entries = [];
  let current;
  const finish = () => {
    if (current !== undefined) entries.push(current);
  };
  for (const line of lines) {
    const entry = /^ {2}(?:'([^']+)'|([^\s][^:]*)):\s*$/.exec(line);
    if (entry !== null) {
      finish();
      current = { key: entry[1] ?? entry[2], integrity: undefined };
      continue;
    }
    if (current !== undefined) {
      const integrity = /\bintegrity:\s*(sha512-[A-Za-z0-9+/=]+)/.exec(line)?.[1];
      if (integrity !== undefined) current.integrity = integrity;
    }
  }
  finish();

  const byPurl = new Map();
  for (const entry of entries) {
    const identity = packageIdentity(entry.key);
    if (identity === undefined) continue;
    const purl = packageUrl(identity.name, identity.version);
    const component = {
      type: 'library',
      'bom-ref': purl,
      name: identity.name,
      version: identity.version,
      purl,
      ...(entry.integrity === undefined ? {} : { hashes: sha512Hash(entry.integrity) }),
    };
    const existing = byPurl.get(purl);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(component)) {
      throw new TypeError(`pnpm lockfile has conflicting records for ${purl}`);
    }
    byPurl.set(purl, existing ?? component);
  }
  return [...byPurl.values()].sort((left, right) => left.purl.localeCompare(right.purl));
}

function renderSbom(packageJson, lockfile) {
  const rootPurl = packageUrl(packageJson.name, packageJson.version);
  const lockDigest = createHash('sha256').update(lockfile, 'utf8').digest('hex');
  return `${JSON.stringify(
    {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      version: 1,
      metadata: {
        component: {
          type: 'library',
          'bom-ref': rootPurl,
          name: packageJson.name,
          version: packageJson.version,
          purl: rootPurl,
        },
        properties: [{ name: 'healwright:pnpm-lock-sha256', value: lockDigest }],
      },
      components: parseLockPackages(lockfile),
    },
    null,
    2,
  )}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const outputPath = resolve(repositoryRoot, options.output);
  const [packageContents, lockfile] = await Promise.all([
    readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
    readFile(resolve(repositoryRoot, 'pnpm-lock.yaml'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageContents);
  const rendered = renderSbom(packageJson, lockfile);
  if (options.check) {
    const existing = await readFile(outputPath, 'utf8');
    if (existing !== rendered) throw new Error(`SBOM is stale or non-deterministic: ${outputPath}`);
    process.stdout.write(`Verified deterministic CycloneDX SBOM: ${outputPath}\n`);
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered, { encoding: 'utf8', mode: 0o600 });
  const parsed = JSON.parse(rendered);
  process.stdout.write(
    `Generated CycloneDX ${parsed.specVersion} SBOM with ${String(parsed.components.length)} component(s): ${outputPath}\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
