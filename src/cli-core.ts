import { createRequire } from 'node:module';
import { access, lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { generateReportViewer } from './report-viewer.js';
import { loadTargetRegistry } from './registry.js';

export type CliCommand =
  | { readonly command: 'help' }
  | { readonly command: 'doctor' }
  | { readonly command: 'init'; readonly registryPath: string; readonly force: boolean }
  | { readonly command: 'validate'; readonly registryPath: string }
  | {
      readonly command: 'view';
      readonly historyPath: string;
      readonly summaryPath: string;
      readonly outputDirectory: string;
      readonly force: boolean;
    };

export interface CliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

export interface RunCliOptions {
  readonly cwd?: string;
  readonly io?: CliIo;
}

const HELP = `Healwright v0.6.0 Technical Preview

Conservative, deterministic self-healing for Playwright Test.

Usage:
  healwright --help
  healwright init [--registry <path>] [--force]
  healwright validate --registry <path>
  healwright doctor
  healwright view --history <path> --summary <path> --out <dir> [--force]

Examples:
  healwright init
  healwright validate --registry healwright.targets.json
  healwright doctor
  healwright view --history test-results/healwright/history.jsonl \\
    --summary test-results/healwright/summary.json --out healwright-report

Safety:
  init never overwrites an existing registry unless --force is explicit.
  view validates that the summary matches canonical history and emits static local HTML.
  No command rewrites tests or applies locator proposals.
`;

const STARTER_REGISTRY = {
  version: 1,
  defaults: {
    confidenceThreshold: 0.9,
    minimumScoreMargin: 0.15,
  },
  targets: {
    'example.continue': {
      description: 'Continue the example flow',
      primary: {
        type: 'role',
        role: 'button',
        name: 'Continue',
        exact: true,
      },
      fingerprint: {
        accessibleRole: 'button',
        accessibleName: 'Continue',
        visibleText: 'Continue',
        tag: 'button',
      },
      policy: {
        allowedActions: ['click'],
        executionRisk: 'automatic',
        healing: {
          enabled: true,
          confidenceThreshold: 0.92,
          minimumScoreMargin: 0.18,
        },
      },
    },
  },
} as const;

function optionValue(arguments_: readonly string[], option: string): string | undefined {
  const index = arguments_.indexOf(option);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new TypeError(`${option} requires a value`);
  }
  return value;
}

function rejectUnknownOptions(
  arguments_: readonly string[],
  valueOptions: readonly string[],
  flags: readonly string[],
): void {
  const accepted = new Set([...valueOptions, ...flags]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    if (!accepted.has(argument)) {
      throw new TypeError(`Unknown option "${argument}"`);
    }
    if (valueOptions.includes(argument)) index += 1;
  }
}

export function parseCliArguments(arguments_: readonly string[]): CliCommand {
  if (arguments_.length === 0 || arguments_[0] === '--help' || arguments_[0] === '-h') {
    return { command: 'help' };
  }
  const [command, ...options] = arguments_;
  if (options.includes('--help') || options.includes('-h')) return { command: 'help' };

  switch (command) {
    case 'doctor':
      rejectUnknownOptions(options, [], []);
      return { command };
    case 'init': {
      rejectUnknownOptions(options, ['--registry'], ['--force']);
      return {
        command,
        registryPath: optionValue(options, '--registry') ?? 'healwright.targets.json',
        force: options.includes('--force'),
      };
    }
    case 'validate': {
      rejectUnknownOptions(options, ['--registry'], []);
      const registryPath = optionValue(options, '--registry');
      if (registryPath === undefined) throw new TypeError('validate requires --registry <path>');
      return { command, registryPath };
    }
    case 'view': {
      rejectUnknownOptions(options, ['--history', '--summary', '--out'], ['--force']);
      const historyPath = optionValue(options, '--history');
      const summaryPath = optionValue(options, '--summary');
      const outputDirectory = optionValue(options, '--out');
      if (historyPath === undefined || summaryPath === undefined || outputDirectory === undefined) {
        throw new TypeError('view requires --history <path>, --summary <path>, and --out <dir>');
      }
      return {
        command,
        historyPath,
        summaryPath,
        outputDirectory,
        force: options.includes('--force'),
      };
    }
    default:
      throw new TypeError(`Unknown command "${String(command)}"; run healwright --help`);
  }
}

function defaultIo(): CliIo {
  return {
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
  };
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(path: string | URL): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function refuseSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symbolic link "${path}"`);
    }
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

async function runDoctor(io: CliIo, cwd: string): Promise<number> {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  const nodeReady = Number.isInteger(nodeMajor) && nodeMajor >= 20;
  const require = createRequire(import.meta.url);
  let playwrightReady = true;
  try {
    require.resolve('@playwright/test');
  } catch {
    playwrightReady = false;
  }
  const buildReady = await pathExists(new URL('./cli.js', import.meta.url));
  const exampleReady = await pathExists(
    new URL('../examples/basic-playwright/targets.json', import.meta.url),
  );
  const realisticExampleReady = await pathExists(
    new URL('../examples/realistic-demo/targets.json', import.meta.url),
  );
  const localRegistryReady = await pathExists(resolve(cwd, 'healwright.targets.json'));
  const checks = [
    { label: `Node.js ${process.versions.node} (requires 20+)`, passed: nodeReady, required: true },
    { label: '@playwright/test is resolvable', passed: playwrightReady, required: true },
    { label: 'compiled CLI artifact is present', passed: buildReady, required: true },
    { label: 'basic example registry is present', passed: exampleReady, required: false },
    { label: 'realistic demo registry is present', passed: realisticExampleReady, required: false },
    {
      label: localRegistryReady
        ? 'local healwright.targets.json is present (optional)'
        : 'local healwright.targets.json not found (optional; run healwright init)',
      passed: localRegistryReady,
      required: false,
    },
  ];
  for (const check of checks) {
    io.stdout(`${check.passed ? 'PASS' : check.required ? 'FAIL' : 'WARN'}  ${check.label}\n`);
  }
  const failed = checks.filter((check) => check.required && !check.passed).length;
  io.stdout(
    failed === 0
      ? 'Healwright doctor: ready for local evaluation.\n'
      : `Healwright doctor: ${String(failed)} required check(s) failed.\n`,
  );
  return failed === 0 ? 0 : 1;
}

export async function runCli(
  arguments_: readonly string[],
  options: RunCliOptions = {},
): Promise<number> {
  const io = options.io ?? defaultIo();
  const cwd = options.cwd ?? process.cwd();
  let parsed: CliCommand;
  try {
    parsed = parseCliArguments(arguments_);
  } catch (error) {
    io.stderr(`healwright: ${messageForError(error)}\n`);
    return 1;
  }

  try {
    switch (parsed.command) {
      case 'help':
        io.stdout(HELP);
        return 0;
      case 'doctor':
        return await runDoctor(io, cwd);
      case 'init': {
        const registryPath = resolve(cwd, parsed.registryPath);
        await mkdir(dirname(registryPath), { recursive: true });
        if (parsed.force) await refuseSymbolicLink(registryPath);
        await writeFile(registryPath, `${JSON.stringify(STARTER_REGISTRY, null, 2)}\n`, {
          encoding: 'utf8',
          flag: parsed.force ? 'w' : 'wx',
        });
        io.stdout(
          `Created ${registryPath}\nNext: review the fingerprint and policy, then run healwright validate --registry ${registryPath}\n`,
        );
        return 0;
      }
      case 'validate': {
        const registryPath = resolve(cwd, parsed.registryPath);
        const registry = await loadTargetRegistry(registryPath);
        io.stdout(
          `Valid Healwright registry: ${registryPath} (${String(Object.keys(registry.targets).length)} target(s))\n`,
        );
        return 0;
      }
      case 'view': {
        const result = await generateReportViewer({
          historyPath: resolve(cwd, parsed.historyPath),
          summaryPath: resolve(cwd, parsed.summaryPath),
          outputDirectory: resolve(cwd, parsed.outputDirectory),
          force: parsed.force,
        });
        io.stdout(
          `Generated ${result.indexPath} from ${String(result.eventCount)} event(s), including ${String(result.successfulHealingCount)} successful heal(s).\n`,
        );
        return 0;
      }
    }
  } catch (error) {
    if (
      parsed.command === 'init' &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      io.stderr(
        `healwright: refusing to overwrite ${resolve(cwd, parsed.registryPath)}; pass --force only after reviewing the existing file\n`,
      );
      return 1;
    }
    io.stderr(`healwright: ${messageForError(error)}\n`);
    return 1;
  }
}
