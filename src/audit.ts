import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { TestInfo } from '@playwright/test';

import type { CapturedScreenshot } from './artifacts.js';
import type { CandidateAssessment, RankedCandidate, ScoreDetail } from './scoring.js';
import type { HealingMode, PrimaryLocatorDefinition, TargetAction } from './types.js';

export const AUDIT_SCHEMA_VERSION = 1 as const;

export type AuditCollectionStatus = 'completed' | 'failed' | 'skipped-policy-disabled';
export type AuditModeDecision = 'observed' | 'eligible' | 'rejected' | 'strict-ci-failure';
export type HealingExecutionStatus = 'succeeded' | 'failed' | 'rejected';
export type HealingExecutionReason =
  | 'succeeded'
  | 'revalidation-changed'
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
}

export interface HealingAuditEvent {
  readonly schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  readonly eventType: 'locator-drift-assessed';
  readonly eventId: string;
  readonly timestamp: string;
  readonly mode: Exclude<HealingMode, 'off'>;
  readonly modeDecision: AuditModeDecision;
  readonly targetKey: string;
  readonly action: TargetAction;
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
  readonly parentEventId: string;
  readonly mode: 'guarded';
  readonly targetKey: string;
  readonly action: TargetAction;
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
  readonly mode: Exclude<HealingMode, 'off'>;
  readonly modeDecision: AuditModeDecision;
  readonly targetKey: string;
  readonly action: TargetAction;
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
  readonly parentEventId: string;
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly candidateId: string;
  readonly status: HealingExecutionStatus;
  readonly reason: HealingExecutionReason;
  readonly error?: unknown;
  readonly screenshots: readonly CapturedScreenshot[];
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

export function createHealingAuditEvent({
  eventId = randomUUID(),
  timestamp = new Date().toISOString(),
  mode,
  modeDecision,
  targetKey,
  action,
  primaryLocator,
  primaryError,
  collectionStatus,
  collectionError,
  assessment,
  rankedCandidates,
}: CreateHealingAuditEventOptions): HealingAuditEvent {
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    eventType: 'locator-drift-assessed',
    eventId,
    timestamp,
    mode,
    modeDecision,
    targetKey,
    action,
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
    })),
  };
}

export function createHealingExecutionAuditEvent({
  eventId = randomUUID(),
  timestamp = new Date().toISOString(),
  parentEventId,
  targetKey,
  action,
  candidateId,
  status,
  reason,
  error,
  screenshots,
}: CreateHealingExecutionAuditEventOptions): HealingExecutionAuditEvent {
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    eventType: 'locator-heal-execution',
    eventId,
    timestamp,
    parentEventId,
    mode: 'guarded',
    targetKey,
    action,
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
    await this.testInfo.attach(`healwright-${event.eventId}`, {
      body: JSON.stringify(event, null, 2),
      contentType: 'application/json',
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
