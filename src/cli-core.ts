import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyEvidenceManifest, writeEvidenceManifest } from './evidence-manifest.js';
import { generateReportViewer } from './report-viewer.js';
import { loadTargetRegistry } from './registry.js';

export type CliCommand =
  | { readonly command: 'help' }
  | { readonly command: 'doctor' }
  | { readonly command: 'demo'; readonly force: boolean; readonly open: boolean }
  | { readonly command: 'init'; readonly registryPath: string; readonly force: boolean }
  | { readonly command: 'validate'; readonly registryPath: string }
  | {
      readonly command: 'attest';
      readonly historyPath: string;
      readonly summaryPath: string;
      readonly manifestPath: string;
      readonly force: boolean;
      readonly keyFilePath?: string;
      readonly keyId?: string;
    }
  | {
      readonly command: 'verify';
      readonly manifestPath: string;
      readonly keyFilePath?: string;
      readonly expectedKeyId?: string;
      readonly requireAuthenticated: boolean;
    }
  | {
      readonly command: 'view';
      readonly historyPath: string;
      readonly summaryPath: string;
      readonly outputDirectory: string;
      readonly force: boolean;
      readonly open: boolean;
      readonly manifestPath?: string;
      readonly keyFilePath?: string;
      readonly expectedKeyId?: string;
      readonly requireAuthenticated: boolean;
    };

export interface CliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

export interface RunCliOptions {
  readonly cwd?: string;
  readonly io?: CliIo;
  /** Overrides the package root for deterministic CLI integration tests. */
  readonly repositoryRoot?: string;
  readonly runDemo?: (repositoryRoot: string) => Promise<void>;
  readonly openPath?: (path: string) => Promise<void>;
}

const HELP = `Healwright v1.0.0 Evaluation Release

Conservative, deterministic self-healing for Playwright Test.

Usage:
  healwright --help
  healwright init [--registry <path>] [--force]
  healwright validate --registry <path>
  healwright doctor
  healwright demo [--force] [--open]
  healwright attest --history <path> --summary <path> --out <manifest> [--key-file <path> --key-id <id>] [--force]
  healwright verify --manifest <path> [--key-file <path>] [--key-id <id>] [--require-authenticated]
  healwright view --history <path> --summary <path> --out <dir> [--manifest <path>] [--key-file <path> --key-id <id>] [--require-authenticated] [--force] [--open]

Examples:
  healwright init
  healwright validate --registry healwright.targets.json
  healwright doctor
  healwright demo --force
  healwright attest --history test-results/healwright/history.jsonl --summary test-results/healwright/summary.json --out test-results/healwright/manifest.json
  healwright verify --manifest test-results/healwright/manifest.json
  healwright view --history test-results/healwright/history.jsonl \\
    --summary test-results/healwright/summary.json --out healwright-report --open

Safety:
  init never overwrites an existing registry unless --force is explicit.
  attest creates an integrity manifest; HMAC authentication is optional and keys stay external.
  verify detects missing, truncated, reordered, or replaced evidence and can require authentication.
  demo runs only the deterministic local repository fixture; --open is always explicit.
  view validates evidence and emits static local HTML; it opens a browser only with --open.
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
    case 'demo':
      rejectUnknownOptions(options, [], ['--force', '--open']);
      return {
        command,
        force: options.includes('--force'),
        open: options.includes('--open'),
      };
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
    case 'attest': {
      rejectUnknownOptions(
        options,
        ['--history', '--summary', '--out', '--key-file', '--key-id'],
        ['--force'],
      );
      const historyPath = optionValue(options, '--history');
      const summaryPath = optionValue(options, '--summary');
      const manifestPath = optionValue(options, '--out');
      const keyFilePath = optionValue(options, '--key-file');
      const keyId = optionValue(options, '--key-id');
      if (historyPath === undefined || summaryPath === undefined || manifestPath === undefined) {
        throw new TypeError(
          'attest requires --history <path>, --summary <path>, and --out <manifest>',
        );
      }
      if ((keyFilePath === undefined) !== (keyId === undefined)) {
        throw new TypeError('attest requires --key-file and --key-id together');
      }
      return {
        command,
        historyPath,
        summaryPath,
        manifestPath,
        force: options.includes('--force'),
        ...(keyFilePath === undefined ? {} : { keyFilePath }),
        ...(keyId === undefined ? {} : { keyId }),
      };
    }
    case 'verify': {
      rejectUnknownOptions(
        options,
        ['--manifest', '--key-file', '--key-id'],
        ['--require-authenticated'],
      );
      const manifestPath = optionValue(options, '--manifest');
      const keyFilePath = optionValue(options, '--key-file');
      const expectedKeyId = optionValue(options, '--key-id');
      if (manifestPath === undefined) throw new TypeError('verify requires --manifest <path>');
      if (expectedKeyId !== undefined && keyFilePath === undefined) {
        throw new TypeError('verify requires --key-file when --key-id is provided');
      }
      return {
        command,
        manifestPath,
        requireAuthenticated: options.includes('--require-authenticated'),
        ...(keyFilePath === undefined ? {} : { keyFilePath }),
        ...(expectedKeyId === undefined ? {} : { expectedKeyId }),
      };
    }
    case 'view': {
      rejectUnknownOptions(
        options,
        ['--history', '--summary', '--out', '--manifest', '--key-file', '--key-id'],
        ['--force', '--open', '--require-authenticated'],
      );
      const historyPath = optionValue(options, '--history');
      const summaryPath = optionValue(options, '--summary');
      const outputDirectory = optionValue(options, '--out');
      const manifestPath = optionValue(options, '--manifest');
      const keyFilePath = optionValue(options, '--key-file');
      const expectedKeyId = optionValue(options, '--key-id');
      if (historyPath === undefined || summaryPath === undefined || outputDirectory === undefined) {
        throw new TypeError('view requires --history <path>, --summary <path>, and --out <dir>');
      }
      if (keyFilePath !== undefined && manifestPath === undefined) {
        throw new TypeError('view requires --manifest when --key-file is provided');
      }
      if (expectedKeyId !== undefined && keyFilePath === undefined) {
        throw new TypeError('view requires --key-file when --key-id is provided');
      }
      if (options.includes('--require-authenticated') && manifestPath === undefined) {
        throw new TypeError('view requires --manifest with --require-authenticated');
      }
      return {
        command,
        historyPath,
        summaryPath,
        outputDirectory,
        force: options.includes('--force'),
        open: options.includes('--open'),
        requireAuthenticated: options.includes('--require-authenticated'),
        ...(manifestPath === undefined ? {} : { manifestPath }),
        ...(keyFilePath === undefined ? {} : { keyFilePath }),
        ...(expectedKeyId === undefined ? {} : { expectedKeyId }),
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

async function readEvidenceKey(path: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Evidence key must be a regular file, not a symbolic link: ${path}`);
  }
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new Error(`Evidence key permissions are too broad; run chmod 600 ${path}`);
  }
  return readFile(path);
}

function repositoryRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

async function runRepositoryDemo(root: string): Promise<void> {
  const pnpmExecutable = process.env.npm_execpath;
  const command = pnpmExecutable === undefined ? 'pnpm' : process.execPath;
  const arguments_ = [
    ...(pnpmExecutable === undefined ? [] : [pnpmExecutable]),
    'example:realistic',
  ];
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `realistic demo failed${signal === null ? ` with exit ${String(code)}` : ` from signal ${signal}`}`,
        ),
      );
    });
  });
}

async function openLocalPath(path: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32.exe'
        : 'xdg-open';
  const arguments_ = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', path] : [path];
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolvePromise();
    });
  });
}

function manualOpenCommand(path: string): string {
  const quotedPath = JSON.stringify(path);
  return process.platform === 'darwin'
    ? `open ${quotedPath}`
    : process.platform === 'win32'
      ? `start "" ${quotedPath}`
      : `xdg-open ${quotedPath}`;
}

async function openIfRequested(
  requested: boolean,
  path: string,
  opener: (path: string) => Promise<void>,
  io: CliIo,
): Promise<void> {
  if (!requested) return;
  try {
    await opener(path);
    io.stdout(`Opened ${path}\n`);
  } catch (error) {
    io.stderr(
      `healwright: could not open the report automatically (${messageForError(error)}). Open this path manually: ${path}\nTry: ${manualOpenCommand(path)}\n`,
    );
  }
}

async function runDoctor(io: CliIo, cwd: string): Promise<number> {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  const nodeReady = Number.isInteger(nodeMajor) && nodeMajor >= 22 && nodeMajor < 25;
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
    {
      label: `Node.js ${process.versions.node} (requires 22.x or 24.x)`,
      passed: nodeReady,
      required: true,
    },
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
  const runDemo = options.runDemo ?? runRepositoryDemo;
  const opener = options.openPath ?? openLocalPath;
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
      case 'demo': {
        const root = options.repositoryRoot ?? repositoryRoot();
        const reportPath = resolve(root, 'test-results/realistic-demo/viewer/index.html');
        const outputRoot = resolve(root, 'test-results/realistic-demo');
        if (!parsed.force && (await pathExists(outputRoot))) {
          throw new Error(
            `Refusing to replace existing demo output "${outputRoot}"; pass --force after reviewing it`,
          );
        }
        io.stdout(
          'Running the deterministic local demo: ordinary Playwright, guarded healing, and ambiguous rejection.\n',
        );
        await runDemo(root);
        if (!(await pathExists(reportPath))) {
          throw new Error(`demo completed without generating the expected report: ${reportPath}`);
        }
        io.stdout(
          `Demo complete. Evidence was verified and the local report is ready:\n${reportPath}\nNext: review the healed and rejected decisions; no source or registry was changed.\n`,
        );
        await openIfRequested(parsed.open, reportPath, opener, io);
        return 0;
      }
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
      case 'attest': {
        const historyPath = resolve(cwd, parsed.historyPath);
        const summaryPath = resolve(cwd, parsed.summaryPath);
        const manifestPath = resolve(cwd, parsed.manifestPath);
        const key =
          parsed.keyFilePath === undefined
            ? undefined
            : await readEvidenceKey(resolve(cwd, parsed.keyFilePath));
        const manifest = await writeEvidenceManifest({
          historyPath,
          summaryPath,
          manifestPath,
          force: parsed.force,
          ...(key === undefined || parsed.keyId === undefined
            ? {}
            : { authentication: { key, keyId: parsed.keyId } }),
        });
        io.stdout(
          `Created ${manifest.authentication === undefined ? 'integrity' : 'authenticated'} evidence manifest: ${manifestPath}\n`,
        );
        return 0;
      }
      case 'verify': {
        const manifestPath = resolve(cwd, parsed.manifestPath);
        const key =
          parsed.keyFilePath === undefined
            ? undefined
            : await readEvidenceKey(resolve(cwd, parsed.keyFilePath));
        const verified = await verifyEvidenceManifest({
          manifestPath,
          requireAuthenticated: parsed.requireAuthenticated,
          ...(key === undefined ? {} : { key }),
          ...(parsed.expectedKeyId === undefined ? {} : { expectedKeyId: parsed.expectedKeyId }),
        });
        io.stdout(
          `Verified ${String(verified.eventCount)} event(s) against ${verified.authenticated ? `authenticated manifest key ${verified.manifest.authentication?.keyId ?? 'unknown'}` : 'unsigned integrity manifest'}.\n`,
        );
        return 0;
      }
      case 'view': {
        const key =
          parsed.keyFilePath === undefined
            ? undefined
            : await readEvidenceKey(resolve(cwd, parsed.keyFilePath));
        const result = await generateReportViewer({
          historyPath: resolve(cwd, parsed.historyPath),
          summaryPath: resolve(cwd, parsed.summaryPath),
          outputDirectory: resolve(cwd, parsed.outputDirectory),
          force: parsed.force,
          ...(parsed.manifestPath === undefined
            ? {}
            : { manifestPath: resolve(cwd, parsed.manifestPath) }),
          ...(key === undefined ? {} : { key }),
          ...(parsed.expectedKeyId === undefined ? {} : { expectedKeyId: parsed.expectedKeyId }),
          ...(parsed.requireAuthenticated
            ? { requireAuthenticated: parsed.requireAuthenticated }
            : {}),
        });
        io.stdout(
          `Generated ${result.indexPath} from ${String(result.eventCount)} event(s), including ${String(result.successfulHealingCount)} successful heal(s); trust=${result.evidenceTrust.level}.\n`,
        );
        await openIfRequested(parsed.open, result.indexPath, opener, io);
        return 0;
      }
    }
  } catch (error) {
    if (
      (parsed.command === 'init' || parsed.command === 'attest') &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      const outputPath =
        parsed.command === 'init'
          ? resolve(cwd, parsed.registryPath)
          : resolve(cwd, parsed.manifestPath);
      io.stderr(
        `healwright: refusing to overwrite ${outputPath}; pass --force only after reviewing the existing file\n`,
      );
      return 1;
    }
    io.stderr(`healwright: ${messageForError(error)}\n`);
    return 1;
  }
}
