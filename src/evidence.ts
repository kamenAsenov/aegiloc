import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import {
  AUDIT_ATTACHMENT_CONTENT_TYPE,
  AUDIT_ATTACHMENT_PREFIX,
  type HealwrightAuditEvent,
} from './audit.js';
import { AuditEvidenceError } from './errors.js';
import { parseAuditHistory } from './proposals.js';
import type { TargetAction } from './types.js';

export const AUDIT_EVIDENCE_SUMMARY_SCHEMA_VERSION = 1 as const;

export interface AuditAttachment {
  readonly name: string;
  readonly contentType: string;
  readonly body?:
    Buffer | Uint8Array | string | { readonly type: 'Buffer'; readonly data: readonly number[] };
}

export interface AuditEvidenceTargetSummary {
  readonly targetKey: string;
  readonly actions: readonly TargetAction[];
  readonly assessmentCount: number;
  readonly executionCount: number;
  readonly successfulHealingCount: number;
}

export interface AuditEvidenceSummary {
  readonly schemaVersion: typeof AUDIT_EVIDENCE_SUMMARY_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly events: {
    readonly total: number;
    readonly assessments: number;
    readonly executions: number;
  };
  readonly decisions: {
    readonly observed: number;
    readonly eligible: number;
    readonly rejected: number;
    readonly strictCiFailure: number;
  };
  readonly executions: {
    readonly succeeded: number;
    readonly failed: number;
    readonly rejected: number;
  };
  readonly provenance: {
    readonly runIds: readonly string[];
    readonly testIds: readonly string[];
    readonly projectNames: readonly string[];
    readonly retryIndices: readonly number[];
    readonly commitShas: readonly string[];
    readonly legacyEventCount: number;
  };
  readonly targets: readonly AuditEvidenceTargetSummary[];
}

export interface WriteAuditEvidenceOptions {
  readonly historyPath: string;
  readonly summaryPath: string;
  readonly generatedAt?: string;
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort();
}

function sortedUniqueNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function eventOrder(left: HealwrightAuditEvent, right: HealwrightAuditEvent): number {
  const timestampOrder = left.timestamp.localeCompare(right.timestamp);
  return timestampOrder === 0 ? left.eventId.localeCompare(right.eventId) : timestampOrder;
}

export function canonicalizeAuditEvents(
  events: readonly HealwrightAuditEvent[],
): readonly HealwrightAuditEvent[] {
  const byId = new Map<string, HealwrightAuditEvent>();
  for (const event of events) {
    const existing = byId.get(event.eventId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new AuditEvidenceError(`eventId "${event.eventId}" has conflicting records`);
    }
    byId.set(event.eventId, existing ?? event);
  }
  return [...byId.values()].sort(eventOrder);
}

export function auditEventsFromAttachments(
  attachments: readonly AuditAttachment[],
): readonly HealwrightAuditEvent[] {
  return attachments.flatMap((attachment) => {
    if (
      attachment.contentType !== AUDIT_ATTACHMENT_CONTENT_TYPE ||
      !attachment.name.startsWith(AUDIT_ATTACHMENT_PREFIX)
    ) {
      return [];
    }
    if (attachment.body === undefined) {
      throw new AuditEvidenceError(`attachment "${attachment.name}" has no inline body`);
    }
    let contents: string;
    const body = attachment.body;
    if (typeof body === 'string') {
      contents = body;
    } else if (Buffer.isBuffer(body)) {
      contents = body.toString('utf8');
    } else if (body instanceof Uint8Array) {
      contents = Buffer.from(body).toString('utf8');
    } else if (
      typeof body === 'object' &&
      body !== null &&
      body.type === 'Buffer' &&
      Array.isArray(body.data) &&
      body.data.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ) {
      contents = Buffer.from(body.data).toString('utf8');
    } else {
      throw new AuditEvidenceError(`attachment "${attachment.name}" has an unsupported body`);
    }
    let events: readonly HealwrightAuditEvent[];
    try {
      const parsed = JSON.parse(contents) as unknown;
      events = parseAuditHistory(JSON.stringify(parsed));
    } catch (error) {
      throw new AuditEvidenceError(`attachment "${attachment.name}" is malformed`, error);
    }
    if (events.length !== 1) {
      throw new AuditEvidenceError(
        `attachment "${attachment.name}" must contain exactly one audit event`,
      );
    }
    const event = events[0];
    if (event === undefined || attachment.name !== `${AUDIT_ATTACHMENT_PREFIX}${event.eventId}`) {
      throw new AuditEvidenceError(`attachment "${attachment.name}" does not match its eventId`);
    }
    return [event];
  });
}

export function createAuditEvidenceSummary(
  inputEvents: readonly HealwrightAuditEvent[],
  generatedAt = new Date().toISOString(),
): AuditEvidenceSummary {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(generatedAt) ||
    Number.isNaN(Date.parse(generatedAt))
  ) {
    throw new TypeError('generatedAt must be a valid date-time string');
  }
  const events = canonicalizeAuditEvents(inputEvents);
  const assessments = events.filter((event) => event.eventType === 'locator-drift-assessed');
  const executions = events.filter((event) => event.eventType === 'locator-heal-execution');
  const provenance = events.flatMap((event) =>
    event.provenance === undefined ? [] : [event.provenance],
  );
  const targetKeys = sortedUnique(events.map((event) => event.targetKey));

  return {
    schemaVersion: AUDIT_EVIDENCE_SUMMARY_SCHEMA_VERSION,
    generatedAt,
    events: {
      total: events.length,
      assessments: assessments.length,
      executions: executions.length,
    },
    decisions: {
      observed: assessments.filter((event) => event.modeDecision === 'observed').length,
      eligible: assessments.filter((event) => event.modeDecision === 'eligible').length,
      rejected: assessments.filter((event) => event.modeDecision === 'rejected').length,
      strictCiFailure: assessments.filter((event) => event.modeDecision === 'strict-ci-failure')
        .length,
    },
    executions: {
      succeeded: executions.filter((event) => event.status === 'succeeded').length,
      failed: executions.filter((event) => event.status === 'failed').length,
      rejected: executions.filter((event) => event.status === 'rejected').length,
    },
    provenance: {
      runIds: sortedUnique(provenance.map((value) => value.runId)),
      testIds: sortedUnique(provenance.map((value) => value.testId)),
      projectNames: sortedUnique(provenance.map((value) => value.projectName)),
      retryIndices: sortedUniqueNumbers(provenance.map((value) => value.retry)),
      commitShas: sortedUnique(
        provenance.flatMap((value) => (value.commitSha === undefined ? [] : [value.commitSha])),
      ),
      legacyEventCount: events.length - provenance.length,
    },
    targets: targetKeys.map((targetKey) => {
      const targetEvents = events.filter((event) => event.targetKey === targetKey);
      const targetExecutions = targetEvents.filter(
        (event) => event.eventType === 'locator-heal-execution',
      );
      return {
        targetKey,
        actions: sortedUnique(targetEvents.map((event) => event.action)),
        assessmentCount: targetEvents.filter(
          (event) => event.eventType === 'locator-drift-assessed',
        ).length,
        executionCount: targetExecutions.length,
        successfulHealingCount: targetExecutions.filter((event) => event.status === 'succeeded')
          .length,
      };
    }),
  };
}

export function serializeAuditHistory(events: readonly HealwrightAuditEvent[]): string {
  const canonical = canonicalizeAuditEvents(events);
  return canonical.length === 0
    ? ''
    : `${canonical.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function writeAuditEvidence(
  inputEvents: readonly HealwrightAuditEvent[],
  options: WriteAuditEvidenceOptions,
): Promise<AuditEvidenceSummary> {
  if (resolve(options.historyPath) === resolve(options.summaryPath)) {
    throw new TypeError('historyPath and summaryPath must be different files');
  }
  const events = canonicalizeAuditEvents(inputEvents);
  const summary = createAuditEvidenceSummary(events, options.generatedAt);
  await atomicWrite(options.historyPath, serializeAuditHistory(events));
  await atomicWrite(options.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
