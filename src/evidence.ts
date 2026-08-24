import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import {
  AUDIT_ATTACHMENT_CONTENT_TYPE,
  AUDIT_ATTACHMENT_PREFIX,
  type AegilocAuditEvent,
} from './audit.js';
import { AuditEvidenceError } from './errors.js';
import { parseAuditHistory } from './proposals.js';
import type { TargetAction } from './types.js';

export const AUDIT_EVIDENCE_SUMMARY_SCHEMA_VERSION = 2 as const;

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
  readonly executionProfile: 'automatic' | 'proposal-only' | 'mixed' | 'unknown';
  readonly ambiguityCount: number;
  readonly ambiguityRate: number;
  readonly lowConfidenceCount: number;
  readonly semanticRejectionCount: number;
  readonly protectedAssessmentCount: number;
  readonly distinctRunCount: number;
  readonly healingRate: number;
  readonly chronicDrift: boolean;
  readonly firstDriftAt?: string;
  readonly lastDriftAt?: string;
  readonly timeSinceFirstDriftMs?: number;
  readonly scoreRange?: {
    readonly minimum: number;
    readonly average: number;
    readonly maximum: number;
  };
  readonly marginRange?: {
    readonly minimum: number;
    readonly average: number;
    readonly maximum: number;
  };
  readonly recentOutcomes: readonly ('healed' | 'rejected' | 'protected' | 'failed' | 'observed')[];
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

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function range(values: readonly number[]): AuditEvidenceTargetSummary['scoreRange'] {
  if (values.length === 0) return undefined;
  return {
    minimum: Math.min(...values),
    average: rounded(values.reduce((total, value) => total + value, 0) / values.length),
    maximum: Math.max(...values),
  };
}

function eventOrder(left: AegilocAuditEvent, right: AegilocAuditEvent): number {
  const timestampOrder = left.timestamp.localeCompare(right.timestamp);
  return timestampOrder === 0 ? left.eventId.localeCompare(right.eventId) : timestampOrder;
}

export function canonicalizeAuditEvents(
  events: readonly AegilocAuditEvent[],
): readonly AegilocAuditEvent[] {
  const byId = new Map<string, AegilocAuditEvent>();
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
): readonly AegilocAuditEvent[] {
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
    let events: readonly AegilocAuditEvent[];
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
  inputEvents: readonly AegilocAuditEvent[],
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
      const targetAssessments = targetEvents.filter(
        (event) => event.eventType === 'locator-drift-assessed',
      );
      const successfulHealingCount = targetExecutions.filter(
        (event) => event.status === 'succeeded',
      ).length;
      const risks = new Set(
        targetAssessments.flatMap((event) =>
          event.executionPolicy?.risk === undefined ? [] : [event.executionPolicy.risk],
        ),
      );
      const executionProfile =
        risks.size === 0
          ? 'unknown'
          : risks.size > 1
            ? 'mixed'
            : risks.has('proposal-only')
              ? 'proposal-only'
              : 'automatic';
      const firstDriftAt = targetAssessments[0]?.timestamp;
      const lastDriftAt = targetAssessments.at(-1)?.timestamp;
      const executionByAssessment = new Map(
        targetExecutions.map((execution) => [execution.parentEventId, execution]),
      );
      const recentOutcomes = targetAssessments.slice(-10).map((assessment) => {
        const execution = executionByAssessment.get(assessment.eventId);
        if (execution?.status === 'succeeded') return 'healed' as const;
        if (execution?.status === 'failed') return 'failed' as const;
        if (assessment.executionPolicy?.risk === 'proposal-only') return 'protected' as const;
        if (
          assessment.modeDecision === 'rejected' ||
          assessment.modeDecision === 'strict-ci-failure'
        ) {
          return 'rejected' as const;
        }
        return 'observed' as const;
      });
      const distinctRunCount = new Set(
        targetAssessments.flatMap((event) =>
          event.provenance?.runId === undefined ? [] : [event.provenance.runId],
        ),
      ).size;
      const ambiguityCount = targetAssessments.filter(
        (event) => event.assessment.reason === 'ambiguous',
      ).length;
      const scoreRange = range(
        targetAssessments.flatMap((event) => {
          const score = event.rankedCandidates[0]?.score;
          return score === undefined ? [] : [score];
        }),
      );
      const marginRange = range(targetAssessments.map((event) => event.assessment.margin));
      return {
        targetKey,
        actions: sortedUnique(targetEvents.map((event) => event.action)),
        assessmentCount: targetAssessments.length,
        executionCount: targetExecutions.length,
        successfulHealingCount,
        executionProfile,
        ambiguityCount,
        ambiguityRate:
          targetAssessments.length === 0 ? 0 : rounded(ambiguityCount / targetAssessments.length),
        lowConfidenceCount: targetAssessments.filter(
          (event) => event.assessment.reason === 'low-confidence',
        ).length,
        semanticRejectionCount: targetAssessments.filter(
          (event) => event.assessment.reason === 'semantic-ineligible',
        ).length,
        protectedAssessmentCount: targetAssessments.filter(
          (event) => event.executionPolicy?.risk === 'proposal-only',
        ).length,
        distinctRunCount,
        healingRate:
          targetAssessments.length === 0
            ? 0
            : rounded(successfulHealingCount / targetAssessments.length),
        chronicDrift: targetAssessments.length >= 3 && distinctRunCount >= 3,
        ...(firstDriftAt === undefined ? {} : { firstDriftAt }),
        ...(lastDriftAt === undefined ? {} : { lastDriftAt }),
        ...(firstDriftAt === undefined
          ? {}
          : {
              timeSinceFirstDriftMs: Math.max(
                0,
                Date.parse(generatedAt) - Date.parse(firstDriftAt),
              ),
            }),
        ...(scoreRange === undefined ? {} : { scoreRange }),
        ...(marginRange === undefined ? {} : { marginRange }),
        recentOutcomes,
      };
    }),
  };
}

export function serializeAuditHistory(events: readonly AegilocAuditEvent[]): string {
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
  inputEvents: readonly AegilocAuditEvent[],
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
