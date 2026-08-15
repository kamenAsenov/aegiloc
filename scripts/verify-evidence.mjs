import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { createAuditEvidenceSummary, loadAuditHistory, serializeAuditHistory } from 'healwright';

const defaults = {
  history: 'test-results/healwright/history.jsonl',
  summary: 'test-results/healwright/summary.json',
};

function usage() {
  return `Usage: pnpm evidence:verify -- [options]

Options:
  --history <path>  Canonical audit JSONL input (default: ${defaults.history})
  --summary <path>  Run summary JSON input (default: ${defaults.summary})
  --help            Show this help

The command exits nonzero for malformed, non-canonical, incomplete, or mismatched evidence.
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
    if (argument !== '--history' && argument !== '--summary') {
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
  const historyPath = resolve(options.history);
  const summaryPath = resolve(options.summary);
  const [historyContents, events, summaryContents] = await Promise.all([
    readFile(historyPath, 'utf8'),
    loadAuditHistory(historyPath),
    readFile(summaryPath, 'utf8'),
  ]);
  if (historyContents !== serializeAuditHistory(events)) {
    throw new Error('Audit history is valid but not in canonical deterministic order');
  }
  const summary = JSON.parse(summaryContents);
  if (
    typeof summary !== 'object' ||
    summary === null ||
    Array.isArray(summary) ||
    typeof summary.generatedAt !== 'string'
  ) {
    throw new TypeError('Audit evidence summary is malformed');
  }
  const expected = createAuditEvidenceSummary(events, summary.generatedAt);
  if (!isDeepStrictEqual(summary, expected)) {
    throw new Error('Audit evidence summary does not match its canonical history');
  }
  process.stdout.write(
    `Verified ${events.length} canonical audit event(s) and matching run summary.\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
