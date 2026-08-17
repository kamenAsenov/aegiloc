import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const documentationRoots = [
  'README.md',
  'CHANGELOG.md',
  'ROADMAP.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs',
  'examples',
];

async function markdownFiles(path) {
  const absolutePath = resolve(repositoryRoot, path);
  const entry = await stat(absolutePath);
  if (entry.isFile()) return path.endsWith('.md') ? [absolutePath] : [];
  const children = await readdir(absolutePath, { withFileTypes: true });
  return (
    await Promise.all(
      children
        .filter((child) => !child.name.startsWith('.'))
        .map((child) => markdownFiles(resolve(path, child.name))),
    )
  ).flat();
}

const files = (await Promise.all(documentationRoots.map(markdownFiles))).flat().sort();
const failures = [];
let checkedLinks = 0;

for (const file of files) {
  const contents = await readFile(file, 'utf8');
  const links = contents.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g);
  for (const match of links) {
    const rawTarget = match[1]?.trim();
    if (
      rawTarget === undefined ||
      rawTarget.startsWith('#') ||
      /^[a-z][a-z+.-]*:/iu.test(rawTarget)
    ) {
      continue;
    }
    const targetWithoutTitle = rawTarget.replace(/\s+"[^"]*"$/u, '');
    const localTarget = targetWithoutTitle.split('#', 1)[0];
    if (localTarget === undefined || localTarget === '') continue;
    checkedLinks += 1;
    const absoluteTarget = resolve(dirname(file), decodeURIComponent(localTarget));
    try {
      await stat(absoluteTarget);
    } catch {
      failures.push(`${file}: missing local link target "${localTarget}"`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Documentation link verification failed:\n${failures.join('\n')}`);
}

process.stdout.write(
  `Verified ${String(checkedLinks)} local link(s) across ${String(files.length)} Markdown file(s).\n`,
);
