import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  evaluateGovernance,
  loadAuditHistory,
  loadGovernancePolicy,
  loadTargetRegistry,
  serializeAuditHistory,
  writeHealthSummary,
} from 'aegiloc';

const defaults = {
  history: 'test-results/aegiloc/history.jsonl',
  registry: 'registry/targets.json',
  policy: 'governance/policy.json',
  json: 'test-results/aegiloc/health-summary.json',
  markdown: 'test-results/aegiloc/health-summary.md',
};

function usage() {
  return `Usage: pnpm governance:evaluate -- [options]

Options:
  --history <path>       Canonical audit JSONL input (default: ${defaults.history})
  --registry <path>      Target registry input (default: ${defaults.registry})
  --policy <path>        Governance policy input (default: ${defaults.policy})
  --no-policy            Summarize without optional governance budgets
  --json <path>          Machine-readable health output (default: ${defaults.json})
  --markdown <path>      Human-readable health output (default: ${defaults.markdown})
  --evaluated-at <UTC>   Deterministic evaluation time (defaults to current UTC time)
  --help                 Show this help

Exit codes: 0 policy pass, 1 policy violation, 2 malformed or unreadable input.
The evaluator reads canonical evidence only and never changes tests or the target registry.
`;
}

function parseArguments(args) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      continue;
    }
    if (argument === '--help') {
      options.help = true;
      continue;
    }
    if (argument === '--no-policy') {
      options.noPolicy = true;
      continue;
    }
    if (
      !['--history', '--registry', '--policy', '--json', '--markdown', '--evaluated-at'].includes(
        argument,
      )
    ) {
      throw new TypeError(`Unknown option: ${argument}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError(`${argument} requires a value`);
    }
    options[argument.slice(2).replace('-at', 'At')] = value;
    index += 1;
  }
  if (options.noPolicy && args.includes('--policy')) {
    throw new TypeError('--policy and --no-policy cannot be used together');
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  const historyPath = resolve(options.history);
  const registryPath = resolve(options.registry);
  const policyPath = options.noPolicy ? undefined : resolve(options.policy);
  const jsonPath = resolve(options.json);
  const markdownPath = resolve(options.markdown);
  const inputPaths = [historyPath, registryPath, ...(policyPath === undefined ? [] : [policyPath])];
  if (
    jsonPath === markdownPath ||
    inputPaths.includes(jsonPath) ||
    inputPaths.includes(markdownPath)
  ) {
    throw new TypeError('Governance output paths must be distinct and cannot overwrite inputs');
  }
  const [historyContents, events, registry, policy] = await Promise.all([
    readFile(historyPath, 'utf8'),
    loadAuditHistory(historyPath),
    loadTargetRegistry(registryPath),
    policyPath === undefined ? Promise.resolve(undefined) : loadGovernancePolicy(policyPath),
  ]);
  if (historyContents !== serializeAuditHistory(events)) {
    throw new TypeError('Audit history is valid but not canonical deterministic evidence');
  }
  const summary = evaluateGovernance(events, registry, policy, {
    ...(options.evaluatedAt === undefined ? {} : { evaluatedAt: options.evaluatedAt }),
  });
  await writeHealthSummary(summary, {
    jsonPath,
    markdownPath,
  });
  process.stdout.write(
    `AEGILOC_GOVERNANCE ${summary.status.toUpperCase()} · ${summary.totals.attempts} attempt(s), ${summary.violations.length} violation(s)\n`,
  );
  return summary.status === 'pass' ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
