import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import { auditEventsFromAttachments, writeAuditEvidence } from './evidence.js';
import type { HealwrightAuditEvent } from './audit.js';
import { AuditEvidenceError } from './errors.js';
import { parseAuditHistory } from './proposals.js';
import { PASSED_WITH_HEALING } from './result.js';

export const DEFAULT_EVIDENCE_OUTPUT_DIRECTORY = 'test-results/healwright' as const;

export interface HealwrightReporterOptions {
  readonly outputDirectory?: string;
}

export function healingStatusLines(test: TestCase, result: TestResult): readonly string[] {
  if (result.status !== 'passed') {
    return [];
  }

  const testTitle = test
    .titlePath()
    .filter((part) => part !== '')
    .join(' › ');
  return result.attachments
    .filter((attachment) => attachment.name.startsWith(PASSED_WITH_HEALING))
    .map((attachment) => `${PASSED_WITH_HEALING} ${testTitle} · ${attachment.name}`);
}

export default class HealwrightReporter implements Reporter {
  readonly #events: HealwrightAuditEvent[] = [];
  readonly #outputDirectory: string;

  public constructor({
    outputDirectory = DEFAULT_EVIDENCE_OUTPUT_DIRECTORY,
  }: HealwrightReporterOptions = {}) {
    if (typeof outputDirectory !== 'string' || outputDirectory.trim() === '') {
      throw new TypeError('Healwright reporter outputDirectory must be a non-empty string');
    }
    this.#outputDirectory = outputDirectory;
  }

  public onTestEnd(test: TestCase, result: TestResult): void {
    for (const line of healingStatusLines(test, result)) {
      process.stdout.write(`${line}\n`);
    }
    this.#events.push(
      ...auditEventsFromAttachments(
        result.attachments.map((attachment) => ({
          name: attachment.name,
          contentType: attachment.contentType,
          ...(attachment.body === undefined ? {} : { body: attachment.body }),
        })),
      ),
    );
  }

  public async onEnd(): Promise<void> {
    const historyPath = join(this.#outputDirectory, 'history.jsonl');
    let existingEvents: readonly HealwrightAuditEvent[] = [];
    try {
      existingEvents = parseAuditHistory(await readFile(historyPath, 'utf8'));
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw new AuditEvidenceError('existing JSONL history is malformed or unreadable', error);
      }
    }
    const summary = await writeAuditEvidence([...existingEvents, ...this.#events], {
      historyPath,
      summaryPath: join(this.#outputDirectory, 'summary.json'),
    });
    process.stdout.write(
      `HEALWRIGHT_EVIDENCE ${summary.events.total} event(s), ${summary.executions.succeeded} successful heal(s) · ${this.#outputDirectory}\n`,
    );
  }
}
