import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  DEFAULT_FINGERPRINT_PROPOSAL_MINIMUM_OBSERVATIONS,
  generateFingerprintProposals,
  loadFingerprintObservationHistory,
  loadTargetRegistry,
  renderFingerprintProposalReport,
} from 'aegiloc';

const defaults = {
  observations: 'test-results/aegiloc/fingerprints.jsonl',
  registry: 'registry/targets.json',
  json: 'test-results/aegiloc/fingerprint-proposals.json',
  markdown: 'test-results/aegiloc/fingerprint-proposals.md',
  minimumObservations: DEFAULT_FINGERPRINT_PROPOSAL_MINIMUM_OBSERVATIONS,
};

function usage() {
  return `Usage: pnpm fingerprint:propose -- [options]

Options:
  --observations <path>      Successful primary fingerprint JSONL (default: ${defaults.observations})
  --registry <path>          Target registry input (default: ${defaults.registry})
  --json <path>              JSON proposal output (default: ${defaults.json})
  --markdown <path>          Markdown report output (default: ${defaults.markdown})
  --min-observations <count> Required independent runs (default: ${defaults.minimumObservations})
  --help                     Show this help

This command creates review-only JSON Patch previews and never modifies the registry or test source.
`;
}

function optionValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--'))
    throw new TypeError(`${option} requires a value`);
  return value;
}

function parseArguments(args) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') return { ...options, help: true };
    if (['--observations', '--registry', '--json', '--markdown'].includes(argument)) {
      options[argument.slice(2)] = optionValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--min-observations') {
      options.minimumObservations = Number(optionValue(args, index, argument));
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown option: ${argument}`);
  }
  return options;
}

async function writeAtomically(filePath, contents) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, 'utf8');
  await rename(temporaryPath, filePath);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const paths = {
    observations: resolve(options.observations),
    registry: resolve(options.registry),
    json: resolve(options.json),
    markdown: resolve(options.markdown),
  };
  if (new Set(Object.values(paths)).size !== Object.values(paths).length) {
    throw new TypeError('Fingerprint proposal inputs and outputs must use different paths');
  }
  const [observations, registry] = await Promise.all([
    loadFingerprintObservationHistory(paths.observations),
    loadTargetRegistry(paths.registry),
  ]);
  const bundle = generateFingerprintProposals(observations, registry, {
    minimumObservations: options.minimumObservations,
  });
  await Promise.all([
    writeAtomically(paths.json, `${JSON.stringify(bundle, null, 2)}\n`),
    writeAtomically(paths.markdown, renderFingerprintProposalReport(bundle)),
  ]);
  process.stdout.write(
    `Generated ${bundle.proposals.length} review-only fingerprint proposal(s) and ${bundle.rejections.length} rejection(s).\nRegistry and test source were not modified.\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
