import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { TestInfo } from '@playwright/test';

import type { CapturedScreenshot } from './artifacts.js';
import type {
  CandidateAssessment,
  CandidateEligibility,
  CandidateEligibilityReason,
  RankedCandidate,
  ScoreDetail,
} from './scoring.js';
import {
  EXECUTION_RISKS,
  type ExecutionRisk,
  type HealingMode,
  type PrimaryLocatorDefinition,
  type TargetAction,
} from './types.js';

export const AUDIT_SCHEMA_VERSION = 1 as const;
export const AUDIT_PROVENANCE_VERSION = 1 as const;
export const AUDIT_ATTACHMENT_PREFIX = 'healwright-audit-' as const;
export const AUDIT_ATTACHMENT_CONTENT_TYPE = 'application/vnd.healwright.audit+json' as const;

export interface AuditProvenanceInput {
  readonly runId: string;
  readonly testId: string;
  readonly projectName: string;
  readonly retry: number;
  readonly commitSha?: string;
}

export interface AuditProvenance extends AuditProvenanceInput {
  readonly version: typeof AUDIT_PROVENANCE_VERSION;
}

export interface PlaywrightAuditProvenanceOptions {
  readonly runId: string;
  readonly commitSha?: string;
}

export type AuditCollectionStatus = 'completed' | 'failed' | 'skipped-policy-disabled';
export type AuditModeDecision = 'observed' | 'eligible' | 'rejected' | 'strict-ci-failure';
export type HealingExecutionStatus = 'succeeded' | 'failed' | 'rejected';
export type HealingExecutionReason =
  | 'succeeded'
  | 'revalidation-changed'
  | 'semantic-revalidation-failed'
  | 'execution-risk-protected'
  | 'candidate-not-unique'
  | 'artifact-capture-failed'
  | 'action-failed';

export interface AuditRankedCandidate {
  readonly rank: number;
  readonly id: string;
  readonly role?: string;
  readonly accessibleName?: string;
  readonly tag: string;
  readonly score: number;
  readonly details: readonly ScoreDetail[];
  readonly eligibility?: CandidateEligibility;
}

export interface HealingAuditEvent {
  readonly schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  readonly eventType: 'locator-drift-assessed';
  readonly eventId: string;
  readonly timestamp: string;
  readonly provenance?: AuditProvenance;
  readonly operationIndex?: number;
  readonly mode: Exclude<HealingMode, 'off'>;
  readonly modeDecision: AuditModeDecision;
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly executionPolicy?: {
    readonly risk: ExecutionRisk;
    readonly automaticExecutionAllowed: boolean;
  };
  readonly primaryLocator: PrimaryLocatorDefinition;
  readonly primaryFailure: {
    readonly category: 'missing';
    readonly errorName: string;
  };
  readonly collection: {
    readonly status: AuditCollectionStatus;
    readonly candidateCount: number;
    readonly errorName?: string;
  };
  readonly assessment: {
    readonly eligible: boolean;
    readonly reason: CandidateAssessment['reason'];
    readonly margin: number;
    readonly confidenceThreshold: number;
    readonly minimumScoreMargin: number;
    readonly semanticRejectionReasons?: readonly CandidateEligibilityReason[];
    readonly topCandidateId?: string;
    readonly secondCandidateId?: string;
  };
  readonly rankedCandidates: readonly AuditRankedCandidate[];
}

export interface HealingExecutionAuditEvent {
  readonly schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  readonly eventType: 'locator-heal-execution';
  readonly eventId: string;
  readonly timestamp: string;
  readonly provenance?: AuditProvenance;
  readonly operationIndex?: number;
  readonly parentEventId: string;
  readonly mode: 'guarded';
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly executionRisk?: ExecutionRisk;
  readonly candidateId: string;
  readonly status: HealingExecutionStatus;
  readonly reason: HealingExecutionReason;
  readonly errorName?: string;
  readonly screenshots: readonly {
    readonly phase: CapturedScreenshot['phase'];
    readonly name: string;
    readonly path: string;
    readonly contentType: CapturedScreenshot['contentType'];
  }[];
}

export type HealwrightAuditEvent = HealingAuditEvent | HealingExecutionAuditEvent;

export interface CreateHealingAuditEventOptions {
  readonly eventId?: string;
  readonly timestamp?: string;
  readonly provenance?: AuditProvenanceInput;
  readonly operationIndex?: number;
  readonly mode: Exclude<HealingMode, 'off'>;
  readonly modeDecision: AuditModeDecision;
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly executionRisk?: ExecutionRisk;
  readonly primaryLocator: PrimaryLocatorDefinition;
  readonly primaryError: unknown;
  readonly collectionStatus: AuditCollectionStatus;
  readonly collectionError?: unknown;
  readonly assessment: CandidateAssessment;
  readonly rankedCandidates: readonly RankedCandidate[];
}

export interface CreateHealingExecutionAuditEventOptions {
  readonly eventId?: string;
  readonly timestamp?: string;
  readonly provenance?: AuditProvenanceInput;
  readonly operationIndex?: number;
  readonly parentEventId: string;
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly executionRisk?: ExecutionRisk;
  readonly candidateId: string;
  readonly status: HealingExecutionStatus;
  readonly reason: HealingExecutionReason;
  readonly error?: unknown;
  readonly screenshots: readonly CapturedScreenshot[];
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function expectProvenanceText(value: unknown, field: string, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > maximumLength ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new TypeError(
      `Audit provenance ${field} must be a non-empty, control-free string of at most ${maximumLength} characters`,
    );
  }
  return value;
}

export function parseAuditProvenance(value: unknown): AuditProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Audit provenance must be an object');
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(['version', 'runId', 'testId', 'projectName', 'retry', 'commitSha']);
  const unexpectedKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unexpectedKey !== undefined) {
    throw new TypeError(`Audit provenance contains unexpected property "${unexpectedKey}"`);
  }
  if (input.version !== AUDIT_PROVENANCE_VERSION) {
    throw new TypeError('Audit provenance version is unsupported');
  }
  const runId = expectProvenanceText(input.runId, 'runId', 200);
  const testId = expectProvenanceText(input.testId, 'testId', 300);
  const projectName = expectProvenanceText(input.projectName, 'projectName', 100);
  if (typeof input.retry !== 'number' || !Number.isInteger(input.retry) || input.retry < 0) {
    throw new TypeError('Audit provenance retry must be a non-negative integer');
  }
  const commitSha =
    input.commitSha === undefined
      ? undefined
      : expectProvenanceText(input.commitSha, 'commitSha', 64).toLowerCase();
  if (commitSha !== undefined && !/^[a-f0-9]{7,64}$/.test(commitSha)) {
    throw new TypeError('Audit provenance commitSha must contain 7 to 64 hexadecimal characters');
  }

  return {
    version: AUDIT_PROVENANCE_VERSION,
    runId,
    testId,
    projectName,
    retry: input.retry,
    ...(commitSha === undefined ? {} : { commitSha }),
  };
}

export function createAuditProvenance(input: AuditProvenanceInput): AuditProvenance {
  return parseAuditProvenance({ version: AUDIT_PROVENANCE_VERSION, ...input });
}

export function createPlaywrightAuditProvenance(
  testInfo: Pick<TestInfo, 'testId' | 'project' | 'retry'>,
  options: PlaywrightAuditProvenanceOptions,
): AuditProvenance {
  return createAuditProvenance({
    runId: options.runId,
    testId: testInfo.testId,
    projectName: testInfo.project.name.trim() === '' ? 'default' : testInfo.project.name,
    retry: testInfo.retry,
    ...(options.commitSha === undefined ? {} : { commitSha: options.commitSha }),
  });
}

export function createHealingAuditEvent({
  eventId = randomUUID(),
  timestamp = new Date().toISOString(),
  provenance,
  operationIndex,
  mode,
  modeDecision,
  targetKey,
  action,
  executionRisk = 'automatic',
  primaryLocator,
  primaryError,
  collectionStatus,
  collectionError,
  assessment,
  rankedCandidates,
}: CreateHealingAuditEventOptions): HealingAuditEvent {
  if (operationIndex !== undefined && (!Number.isInteger(operationIndex) || operationIndex < 0)) {
    throw new TypeError('Audit operationIndex must be a non-negative integer');
  }
  if (!EXECUTION_RISKS.includes(executionRisk)) {
    throw new TypeError('Audit executionRisk is unsupported');
  }
  if (mode === 'guarded' && executionRisk === 'proposal-only' && modeDecision === 'eligible') {
    throw new TypeError('A proposal-only assessment cannot be execution-eligible');
  }
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    eventType: 'locator-drift-assessed',
    eventId,
    timestamp,
    ...(provenance === undefined ? {} : { provenance: createAuditProvenance(provenance) }),
    ...(operationIndex === undefined ? {} : { operationIndex }),
    mode,
    modeDecision,
    targetKey,
    action,
    executionPolicy: {
      risk: executionRisk,
      automaticExecutionAllowed: executionRisk === 'automatic',
    },
    primaryLocator,
    primaryFailure: {
      category: 'missing',
      errorName: errorName(primaryError),
    },
    collection: {
      status: collectionStatus,
      candidateCount: rankedCandidates.length,
      ...(collectionError === undefined ? {} : { errorName: errorName(collectionError) }),
    },
    assessment: {
      eligible: assessment.eligible,
      reason: assessment.reason,
      margin: assessment.margin,
      confidenceThreshold: assessment.confidenceThreshold,
      minimumScoreMargin: assessment.minimumScoreMargin,
      ...(assessment.semanticRejectionReasons === undefined
        ? {}
        : { semanticRejectionReasons: assessment.semanticRejectionReasons }),
      ...(assessment.topCandidate === undefined
        ? {}
        : { topCandidateId: assessment.topCandidate.candidate.id }),
      ...(assessment.secondCandidate === undefined
        ? {}
        : { secondCandidateId: assessment.secondCandidate.candidate.id }),
    },
    rankedCandidates: rankedCandidates.map((ranked, index) => ({
      rank: index + 1,
      id: ranked.candidate.id,
      ...(ranked.candidate.role === undefined ? {} : { role: ranked.candidate.role }),
      ...(ranked.candidate.accessibleName === undefined
        ? {}
        : { accessibleName: ranked.candidate.accessibleName }),
      tag: ranked.candidate.tag,
      score: ranked.score,
      details: ranked.details,
      ...(ranked.eligibility === undefined ? {} : { eligibility: ranked.eligibility }),
    })),
  };
}

export function createHealingExecutionAuditEvent({
  eventId = randomUUID(),
  timestamp = new Date().toISOString(),
  provenance,
  operationIndex,
  parentEventId,
  targetKey,
  action,
  executionRisk = 'automatic',
  candidateId,
  status,
  reason,
  error,
  screenshots,
}: CreateHealingExecutionAuditEventOptions): HealingExecutionAuditEvent {
  if (operationIndex !== undefined && (!Number.isInteger(operationIndex) || operationIndex < 0)) {
    throw new TypeError('Audit operationIndex must be a non-negative integer');
  }
  if (!EXECUTION_RISKS.includes(executionRisk)) {
    throw new TypeError('Audit executionRisk is unsupported');
  }
  if (executionRisk === 'proposal-only') {
    throw new TypeError('A proposal-only target cannot have an execution event');
  }
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    eventType: 'locator-heal-execution',
    eventId,
    timestamp,
    ...(provenance === undefined ? {} : { provenance: createAuditProvenance(provenance) }),
    ...(operationIndex === undefined ? {} : { operationIndex }),
    parentEventId,
    mode: 'guarded',
    targetKey,
    action,
    executionRisk,
    candidateId,
    status,
    reason,
    ...(error === undefined ? {} : { errorName: errorName(error) }),
    screenshots: screenshots.map((screenshot) => ({
      phase: screenshot.phase,
      name: screenshot.name,
      path: screenshot.auditPath,
      contentType: screenshot.contentType,
    })),
  };
}

export interface AuditSink {
  write(event: HealwrightAuditEvent): Promise<void>;
}

export class NoopAuditSink implements AuditSink {
  public write(): Promise<void> {
    return Promise.resolve();
  }
}

export class InMemoryAuditSink implements AuditSink {
  readonly #events: HealwrightAuditEvent[] = [];

  public get events(): readonly HealwrightAuditEvent[] {
    return this.#events;
  }

  public write(event: HealwrightAuditEvent): Promise<void> {
    this.#events.push(event);
    return Promise.resolve();
  }
}

export class JsonlAuditSink implements AuditSink {
  public constructor(private readonly filePath: string) {}

  public async write(event: HealwrightAuditEvent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

export class PlaywrightAttachmentAuditSink implements AuditSink {
  public constructor(private readonly testInfo: Pick<TestInfo, 'attach'>) {}

  public async write(event: HealwrightAuditEvent): Promise<void> {
    await this.testInfo.attach(`${AUDIT_ATTACHMENT_PREFIX}${event.eventId}`, {
      body: JSON.stringify(event, null, 2),
      contentType: AUDIT_ATTACHMENT_CONTENT_TYPE,
    });
  }
}

export class CompositeAuditSink implements AuditSink {
  public constructor(private readonly sinks: readonly AuditSink[]) {}

  public async write(event: HealwrightAuditEvent): Promise<void> {
    for (const sink of this.sinks) {
      await sink.write(event);
    }
  }
}
