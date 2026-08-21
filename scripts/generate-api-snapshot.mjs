import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import ts from 'typescript';
import { format } from 'prettier';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const snapshotPath = resolve(repositoryRoot, 'api/public-api.json');

function isExported(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function declarationTypeExports(path) {
  return readFile(path, 'utf8').then((contents) => {
    const source = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true);
    const names = new Set();
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
        if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            if (statement.isTypeOnly || element.isTypeOnly) names.add(element.name.text);
          }
        }
        continue;
      }
      if (
        isExported(statement) &&
        (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
      ) {
        names.add(statement.name.text);
      }
    }
    return [...names].sort();
  });
}

async function runtimeExports(path) {
  const module = await import(`${pathToFileURL(path).href}?snapshot=1`);
  return Object.keys(module).sort();
}

function schemaVersion(schema) {
  return schema.properties?.schemaVersion?.const ?? schema.properties?.version?.const;
}

async function renderSnapshot() {
  const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
  const [rootRuntime, rootTypes, reporterRuntime, reporterTypes] = await Promise.all([
    runtimeExports(resolve(repositoryRoot, 'dist/index.js')),
    declarationTypeExports(resolve(repositoryRoot, 'dist/index.d.ts')),
    runtimeExports(resolve(repositoryRoot, 'dist/reporter.js')),
    declarationTypeExports(resolve(repositoryRoot, 'dist/reporter.d.ts')),
  ]);
  const schemaEntries = Object.entries(packageJson.exports)
    .filter(([subpath]) => subpath.endsWith('-schema'))
    .sort(([left], [right]) => left.localeCompare(right));
  const schemas = [];
  for (const [subpath, relativePath] of schemaEntries) {
    const schema = JSON.parse(await readFile(resolve(repositoryRoot, relativePath), 'utf8'));
    schemas.push({
      subpath,
      path: relativePath,
      id: schema.$id,
      version: schemaVersion(schema),
    });
  }
  return format(
    `${JSON.stringify(
      {
        formatVersion: 1,
        package: { name: packageJson.name, version: packageJson.version },
        support: {
          node: packageJson.engines.node,
          playwrightTest: packageJson.peerDependencies['@playwright/test'],
        },
        entrypoints: {
          '.': { runtimeExports: rootRuntime, typeOnlyExports: rootTypes },
          './reporter': { runtimeExports: reporterRuntime, typeOnlyExports: reporterTypes },
        },
        schemas,
      },
      null,
      2,
    )}\n`,
    { parser: 'json', printWidth: 100 },
  );
}

async function main() {
  const check = process.argv.slice(2).includes('--check');
  if (process.argv.slice(2).some((argument) => argument !== '--check')) {
    throw new TypeError('Usage: node scripts/generate-api-snapshot.mjs [--check]');
  }
  const rendered = await renderSnapshot();
  if (check) {
    const existing = await readFile(snapshotPath, 'utf8');
    if (existing !== rendered) {
      throw new Error('Public API snapshot is stale; review the API change and regenerate it');
    }
    process.stdout.write(`Verified public API snapshot: ${snapshotPath}\n`);
    return;
  }
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, rendered, 'utf8');
  process.stdout.write(`Generated public API snapshot: ${snapshotPath}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
