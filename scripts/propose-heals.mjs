import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  DEFAULT_PROPOSAL_MINIMUM_OBSERVATIONS,
  generateHealingProposals,
  loadAuditHistory,
  loadTargetRegistry,
  renderHealingProposalReport,
  verifyHealingProposal,
} from 'healwright';

const defaults = {
  history: 'test-results/healwright/history.jsonl',
  registry: 'registry/targets.json',
  json: 'test-results/healwright/proposals.json',
  markdown: 'test-results/healwright/proposals.md',
  minimumObservations: DEFAULT_PROPOSAL_MINIMUM_OBSERVATIONS,
};

function usage() {
  return `Usage: pnpm proposal:generate -- [options]

Options:
  --history <path>           Audit JSONL input (default: ${defaults.history})
  --registry <path>          Target registry input (default: ${defaults.registry})
  --json <path>              JSON proposal output (default: ${defaults.json})
  --markdown <path>          Markdown report output (default: ${defaults.markdown})
  --min-observations <count> Required successful observations (default: ${defaults.minimumObservations})
  --help                     Show this help

This command never modifies the registry or test source.
`;
}

function valueAfter(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new TypeError(`${option} requires a value`);
  }
  return value;
}

function parseArguments(args) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case '--help':
        options.help = true;
        break;
      case '--history':
      case '--registry':
      case '--json':
      case '--markdown': {
        const value = valueAfter(args, index, argument);
        options[argument.slice(2)] = value;
        index += 1;
        break;
      }
      case '--min-observations': {
        const value = valueAfter(args, index, argument);
        options.minimumObservations = Number(value);
        index += 1;
        break;
      }
      default:
        throw new TypeError(`Unknown option: ${argument}`);
    }
  }
  return options;
}

function resolvePaths(options) {
  const paths = {
    history: resolve(options.history),
    registry: resolve(options.registry),
    json: resolve(options.json),
    markdown: resolve(options.markdown),
  };
  if (paths.json === paths.markdown) {
    throw new TypeError('JSON and Markdown output paths must be different');
  }
  for (const output of [paths.json, paths.markdown]) {
    if (output === paths.history || output === paths.registry) {
      throw new TypeError('An output path must not overwrite the history or registry input');
    }
  }
  return paths;
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
  const paths = resolvePaths(options);
  const [events, registry] = await Promise.all([
    loadAuditHistory(paths.history),
    loadTargetRegistry(paths.registry),
  ]);
  const bundle = generateHealingProposals(events, registry, {
    minimumObservations: options.minimumObservations,
  });
  for (const proposal of bundle.proposals) {
    const verification = verifyHealingProposal(proposal, registry);
    if (!verification.valid) {
      throw new Error(`Generated proposal failed integrity verification: ${verification.reason}`);
    }
  }

  await Promise.all([
    writeAtomically(paths.json, `${JSON.stringify(bundle, null, 2)}\n`),
    writeAtomically(paths.markdown, renderHealingProposalReport(bundle)),
  ]);
  process.stdout.write(
    `Generated ${bundle.proposals.length} review-required proposal(s) and ${bundle.rejections.length} rejection(s).\nJSON: ${paths.json}\nMarkdown: ${paths.markdown}\nRegistry and test source were not modified.\n`,
  );
}

await main();
