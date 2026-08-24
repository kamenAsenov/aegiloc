import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repositoryRoot = new URL('..', import.meta.url);

function pack(outputDirectory) {
  const pnpmExecutable = process.env.npm_execpath;
  const command = pnpmExecutable === undefined ? 'pnpm' : process.execPath;
  const arguments_ = [
    ...(pnpmExecutable === undefined ? [] : [pnpmExecutable]),
    'pack',
    '--pack-destination',
    outputDirectory,
  ];
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`pnpm pack failed with exit ${String(result.status)}`);
  }
}

async function packedFile(directory) {
  const files = (await readdir(directory)).filter((file) => file.endsWith('.tgz'));
  if (files.length !== 1 || files[0] === undefined) {
    throw new Error(`Expected exactly one package tarball in ${directory}`);
  }
  return join(directory, files[0]);
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'aegiloc-reproducible-pack-'));
try {
  const firstDirectory = join(temporaryRoot, 'first');
  const secondDirectory = join(temporaryRoot, 'second');
  await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory)]);
  pack(firstDirectory);
  pack(secondDirectory);
  const [firstPath, secondPath] = await Promise.all([
    packedFile(firstDirectory),
    packedFile(secondDirectory),
  ]);
  const [first, second] = await Promise.all([readFile(firstPath), readFile(secondPath)]);
  const firstDigest = sha256(first);
  const secondDigest = sha256(second);
  if (firstDigest !== secondDigest || !first.equals(second)) {
    throw new Error(
      `Package tarballs are not reproducible: ${firstDigest} differs from ${secondDigest}`,
    );
  }
  process.stdout.write(
    `Verified byte-for-byte reproducible package tarball (${String(first.byteLength)} bytes, sha256:${firstDigest}).\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
