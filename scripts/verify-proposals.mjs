import { resolve } from 'node:path';

import {
  loadHealingProposalBundle,
  loadTargetRegistry,
  verifyHealingProposalBundle,
} from 'aegiloc';

const defaults = {
  proposal: 'test-results/aegiloc/proposals.json',
  registry: 'registry/targets.json',
};

function usage() {
  return `Usage: pnpm proposal:verify -- [options]

Options:
  --proposal <path>  Proposal JSON input (default: ${defaults.proposal})
  --registry <path>  Current target registry (default: ${defaults.registry})
  --help             Show this help

The command exits nonzero for malformed, tampered, unknown, or stale proposals.
`;
}

function parseArguments(args) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      options.help = true;
      continue;
    }
    if (argument !== '--proposal' && argument !== '--registry') {
      throw new TypeError(`Unknown option: ${argument}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError(`${argument} requires a value`);
    }
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const [bundle, registry] = await Promise.all([
    loadHealingProposalBundle(resolve(options.proposal)),
    loadTargetRegistry(resolve(options.registry)),
  ]);
  const verification = verifyHealingProposalBundle(bundle, registry);
  if (!verification.valid) {
    for (const issue of verification.issues) {
      process.stderr.write(`INVALID ${issue.targetKey} ${issue.proposalId}: ${issue.reason}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Verified ${verification.proposalCount} proposal(s): hashes and current registry state are valid.\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
