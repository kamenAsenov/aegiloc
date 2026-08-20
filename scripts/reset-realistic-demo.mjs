import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const outputDirectory = resolve(repositoryRoot, 'test-results', 'realistic-demo');
const requiredPrefix = `${resolve(repositoryRoot, 'test-results')}/`;

if (!outputDirectory.startsWith(requiredPrefix) || outputDirectory === requiredPrefix) {
  throw new Error('Refusing to reset an unexpected realistic-demo output path');
}

await rm(outputDirectory, { recursive: true, force: true });
