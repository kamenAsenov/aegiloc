import { join } from 'node:path';

import type { Locator, Page } from '@playwright/test';

import {
  createHealingAuditEvent,
  createHealingExecutionAuditEvent,
  createAuditProvenance,
  type AuditProvenance,
  type AuditProvenanceInput,
  JsonlAuditSink,
  type AuditCollectionStatus,
  type AuditModeDecision,
  type AuditSink,
  type HealingAuditEvent,
  type HealingExecutionReason,
  type HealwrightAuditEvent,
} from './audit.js';
import {
  FileScreenshotCapture,
  type CapturedScreenshot,
  type ScreenshotCapture,
} from './artifacts.js';
import {
  collectCandidates as collectLiveCandidates,
  resolveUniqueCandidateLocator,
  type CandidateSnapshot,
} from './candidates.js';
import { executePrimaryAction } from './classification.js';
import {
  ArtifactCaptureError,
  AuditWriteError,
  HealingResultWriteError,
  MissingPrimaryLocatorError,
  TargetActionNotAllowedError,
  UnknownTargetError,
} from './errors.js';
import { resolvePrimaryLocator } from './locator.js';
import { ConsoleHealingResultSink, PASSED_WITH_HEALING, type HealingResultSink } from './result.js';
import { assessCandidates, rankCandidates, type CandidateAssessment } from './scoring.js';
import {
  HEALING_MODES,
  type HealingMode,
  type TargetAction,
  type TargetDefinition,
  type TargetRegistry,
} from './types.js';

type ClickOptions = Parameters<Locator['click']>[0];
type FillOptions = Parameters<Locator['fill']>[1];
type CheckOptions = Parameters<Locator['check']>[0];
type SelectOptionValues = Parameters<Locator['selectOption']>[0];
type SelectOptionOptions = Parameters<Locator['selectOption']>[1];

export type CandidateCollector = (
  page: Page,
  action: TargetAction,
) => Promise<readonly CandidateSnapshot[]>;

interface HealingRuntime {
  readonly mode: HealingMode;
  readonly auditSink: AuditSink;
  readonly candidateCollector: CandidateCollector;
  readonly screenshotCapture: ScreenshotCapture;
  readonly resultSink: HealingResultSink;
  readonly auditProvenance?: AuditProvenance;
}

interface MissingAssessment {
  readonly event: HealingAuditEvent;
  readonly assessment: CandidateAssessment;
}

type RevalidationResult =
  | { readonly status: 'ready'; readonly locator: Locator }
  | {
      readonly status: 'rejected';
      readonly reason: Extract<
        HealingExecutionReason,
        'revalidation-changed' | 'semantic-revalidation-failed' | 'candidate-not-unique'
      >;
      readonly error?: unknown;
    };

function modeDecision(mode: Exclude<HealingMode, 'off'>, eligible: boolean): AuditModeDecision {
  switch (mode) {
    case 'observe':
      return 'observed';
    case 'guarded':
      return eligible ? 'eligible' : 'rejected';
    case 'strict-ci':
      return 'strict-ci-failure';
  }
}

class HealerTarget {
  public constructor(
    private readonly page: Page,
    private readonly key: string,
    private readonly definition: TargetDefinition,
    private readonly primaryActionTimeoutMs: number,
    private readonly runtime: HealingRuntime,
  ) {}

  public async click(options?: ClickOptions): Promise<void> {
    this.assertActionAllowed('click');
    const locator = this.primaryLocator();
    const effectiveOptions = {
      ...options,
      timeout: options?.timeout ?? this.primaryActionTimeoutMs,
    };
    await this.execute(
      'click',
      locator,
      effectiveOptions.timeout,
      () => locator.click(effectiveOptions),
      (candidate) => candidate.click(effectiveOptions),
    );
  }

  public async fill(value: string, options?: FillOptions): Promise<void> {
    this.assertActionAllowed('fill');
    const locator = this.primaryLocator();
    const effectiveOptions = {
      ...options,
      timeout: options?.timeout ?? this.primaryActionTimeoutMs,
    };
    await this.execute(
      'fill',
      locator,
      effectiveOptions.timeout,
      () => locator.fill(value, effectiveOptions),
      (candidate) => candidate.fill(value, effectiveOptions),
    );
  }

  public async check(options?: CheckOptions): Promise<void> {
    this.assertActionAllowed('check');
    const locator = this.primaryLocator();
    const effectiveOptions = {
      ...options,
      timeout: options?.timeout ?? this.primaryActionTimeoutMs,
    };
    await this.execute(
      'check',
      locator,
      effectiveOptions.timeout,
      () => locator.check(effectiveOptions),
      (candidate) => candidate.check(effectiveOptions),
    );
  }

  public async selectOption(
    values: SelectOptionValues,
    options?: SelectOptionOptions,
  ): Promise<readonly string[]> {
    this.assertActionAllowed('selectOption');
    const locator = this.primaryLocator();
    const effectiveOptions = {
      ...options,
      timeout: options?.timeout ?? this.primaryActionTimeoutMs,
    };
    return this.execute(
      'selectOption',
      locator,
      effectiveOptions.timeout,
      () => locator.selectOption(values, effectiveOptions),
      (candidate) => candidate.selectOption(values, effectiveOptions),
    );
  }

  private async execute<TResult>(
    action: TargetAction,
    locator: Locator,
    timeoutMs: number,
    invokePrimary: () => Promise<TResult>,
    invokeCandidate: (candidate: Locator) => Promise<TResult>,
  ): Promise<TResult> {
    if (this.runtime.mode === 'off') {
      return invokePrimary();
    }

    try {
      return await executePrimaryAction({
        targetKey: this.key,
        action,
        locator,
        timeoutMs,
        invoke: invokePrimary,
      });
    } catch (error) {
      if (!(error instanceof MissingPrimaryLocatorError)) {
        throw error;
      }

      const assessed = await this.assessMissingTarget(action, error);
      if (
        this.runtime.mode !== 'guarded' ||
        !assessed.assessment.eligible ||
        assessed.assessment.topCandidate === undefined
      ) {
        throw error;
      }

      return this.executeGuardedHealing(
        action,
        error,
        assessed.event,
        assessed.assessment.topCandidate.candidate,
        invokeCandidate,
      );
    }
  }

  private async assessMissingTarget(
    action: TargetAction,
    primaryError: MissingPrimaryLocatorError,
  ): Promise<MissingAssessment> {
    const mode = this.runtime.mode;
    if (mode === 'off') {
      throw primaryError;
    }

    let candidates: readonly CandidateSnapshot[] = [];
    let collectionStatus: AuditCollectionStatus = 'skipped-policy-disabled';
    let collectionError: unknown;

    if (this.definition.policy.healing.enabled) {
      try {
        candidates = await this.runtime.candidateCollector(this.page, action);
        collectionStatus = 'completed';
      } catch (error) {
        collectionStatus = 'failed';
        collectionError = error;
      }
    }

    const rankedCandidates = rankCandidates(this.definition.fingerprint, candidates, action);
    const assessment = assessCandidates(rankedCandidates, this.definition.policy.healing);
    const event = createHealingAuditEvent({
      ...(this.runtime.auditProvenance === undefined
        ? {}
        : { provenance: this.runtime.auditProvenance }),
      mode,
      modeDecision: modeDecision(mode, assessment.eligible),
      targetKey: this.key,
      action,
      primaryLocator: this.definition.primary,
      primaryError: primaryError.cause ?? primaryError,
      collectionStatus,
      ...(collectionError === undefined ? {} : { collectionError }),
      assessment,
      rankedCandidates,
    });

    await this.writeAudit(event);
    return { event, assessment };
  }

  private async executeGuardedHealing<TResult>(
    action: TargetAction,
    primaryError: MissingPrimaryLocatorError,
    assessmentEvent: HealingAuditEvent,
    expectedCandidate: CandidateSnapshot,
    invokeCandidate: (candidate: Locator) => Promise<TResult>,
  ): Promise<TResult> {
    const revalidation = await this.revalidateCandidate(action, expectedCandidate);
    if (revalidation.status === 'rejected') {
      await this.writeExecutionAudit({
        parentEventId: assessmentEvent.eventId,
        action,
        candidateId: expectedCandidate.id,
        status: 'rejected',
        reason: revalidation.reason,
        ...(revalidation.error === undefined ? {} : { error: revalidation.error }),
        screenshots: [],
      });
      throw primaryError;
    }

    const screenshots: CapturedScreenshot[] = [];
    try {
      screenshots.push(
        await this.runtime.screenshotCapture.capture({
          eventId: assessmentEvent.eventId,
          targetKey: this.key,
          action,
          phase: 'before',
        }),
      );
    } catch (error) {
      await this.writeExecutionAudit({
        parentEventId: assessmentEvent.eventId,
        action,
        candidateId: expectedCandidate.id,
        status: 'failed',
        reason: 'artifact-capture-failed',
        error,
        screenshots,
      });
      throw new ArtifactCaptureError(this.key, error);
    }

    let result: TResult;
    try {
      result = await invokeCandidate(revalidation.locator);
    } catch (error) {
      try {
        screenshots.push(
          await this.runtime.screenshotCapture.capture({
            eventId: assessmentEvent.eventId,
            targetKey: this.key,
            action,
            phase: 'after',
          }),
        );
      } catch {
        // Preserve the action failure; the pre-action screenshot and audit remain available.
      }
      await this.writeExecutionAudit({
        parentEventId: assessmentEvent.eventId,
        action,
        candidateId: expectedCandidate.id,
        status: 'failed',
        reason: 'action-failed',
        error,
        screenshots,
      });
      throw error;
    }

    try {
      screenshots.push(
        await this.runtime.screenshotCapture.capture({
          eventId: assessmentEvent.eventId,
          targetKey: this.key,
          action,
          phase: 'after',
        }),
      );
    } catch (error) {
      await this.writeExecutionAudit({
        parentEventId: assessmentEvent.eventId,
        action,
        candidateId: expectedCandidate.id,
        status: 'failed',
        reason: 'artifact-capture-failed',
        error,
        screenshots,
      });
      throw new ArtifactCaptureError(this.key, error);
    }

    const executionEvent = await this.writeExecutionAudit({
      parentEventId: assessmentEvent.eventId,
      action,
      candidateId: expectedCandidate.id,
      status: 'succeeded',
      reason: 'succeeded',
      screenshots,
    });

    try {
      await this.runtime.resultSink.record({
        status: PASSED_WITH_HEALING,
        targetKey: this.key,
        action,
        candidateId: expectedCandidate.id,
        assessmentEventId: assessmentEvent.eventId,
        executionEventId: executionEvent.eventId,
        screenshots,
      });
    } catch (error) {
      throw new HealingResultWriteError(this.key, error);
    }

    return result;
  }

  private async revalidateCandidate(
    action: TargetAction,
    expectedCandidate: CandidateSnapshot,
  ): Promise<RevalidationResult> {
    let candidates: readonly CandidateSnapshot[];
    try {
      candidates = await this.runtime.candidateCollector(this.page, action);
    } catch (error) {
      return { status: 'rejected', reason: 'revalidation-changed', error };
    }

    const rankedCandidates = rankCandidates(this.definition.fingerprint, candidates, action);
    const assessment = assessCandidates(rankedCandidates, this.definition.policy.healing);
    const revalidatedCandidate = assessment.topCandidate?.candidate;
    if (assessment.reason === 'semantic-ineligible') {
      return { status: 'rejected', reason: 'semantic-revalidation-failed' };
    }
    if (!assessment.eligible || revalidatedCandidate?.id !== expectedCandidate.id) {
      return { status: 'rejected', reason: 'revalidation-changed' };
    }

    const locator = await resolveUniqueCandidateLocator(this.page, revalidatedCandidate);
    return locator === undefined
      ? { status: 'rejected', reason: 'candidate-not-unique' }
      : { status: 'ready', locator };
  }

  private async writeExecutionAudit(
    options: Omit<
      Parameters<typeof createHealingExecutionAuditEvent>[0],
      'targetKey' | 'eventId' | 'timestamp'
    >,
  ) {
    const event = createHealingExecutionAuditEvent({
      ...options,
      targetKey: this.key,
      ...(this.runtime.auditProvenance === undefined
        ? {}
        : { provenance: this.runtime.auditProvenance }),
    });
    await this.writeAudit(event);
    return event;
  }

  private async writeAudit(event: HealwrightAuditEvent): Promise<void> {
    try {
      await this.runtime.auditSink.write(event);
    } catch (error) {
      throw new AuditWriteError(this.key, error);
    }
  }

  private primaryLocator(): Locator {
    return resolvePrimaryLocator(this.page, this.definition.primary);
  }

  private assertActionAllowed(action: TargetAction): void {
    if (!this.definition.policy.allowedActions.includes(action)) {
      throw new TargetActionNotAllowedError(this.key, action);
    }
  }
}

export class Healer<TTargetKey extends string = string> {
  public constructor(
    private readonly page: Page,
    private readonly registry: TargetRegistry<TTargetKey>,
    private readonly primaryActionTimeoutMs: number,
    private readonly runtime: HealingRuntime,
  ) {}

  public target(key: TTargetKey): HealerTarget {
    if (!Object.hasOwn(this.registry.targets, key)) {
      throw new UnknownTargetError(key);
    }

    return new HealerTarget(
      this.page,
      key,
      this.registry.targets[key],
      this.primaryActionTimeoutMs,
      this.runtime,
    );
  }
}

export interface CreateHealerOptions<TTargetKey extends string = string> {
  readonly page: Page;
  readonly registry: TargetRegistry<TTargetKey>;
  readonly mode?: HealingMode;
  readonly primaryActionTimeoutMs?: number;
  readonly auditSink?: AuditSink;
  readonly candidateCollector?: CandidateCollector;
  readonly screenshotCapture?: ScreenshotCapture;
  readonly resultSink?: HealingResultSink;
  readonly auditProvenance?: AuditProvenanceInput;
}

export function createHealer<TTargetKey extends string = string>({
  page,
  registry,
  mode = 'guarded',
  primaryActionTimeoutMs = 2_000,
  auditSink = new JsonlAuditSink(
    join(process.cwd(), 'test-results', 'healwright', 'history.jsonl'),
  ),
  candidateCollector = collectLiveCandidates,
  screenshotCapture = new FileScreenshotCapture(
    page,
    join(process.cwd(), 'test-results', 'healwright', 'screenshots'),
  ),
  resultSink = new ConsoleHealingResultSink(),
  auditProvenance,
}: CreateHealerOptions<TTargetKey>): Healer<TTargetKey> {
  if (!HEALING_MODES.includes(mode)) {
    throw new TypeError(`Unsupported Healwright mode: ${mode}`);
  }
  if (!Number.isFinite(primaryActionTimeoutMs) || primaryActionTimeoutMs <= 0) {
    throw new TypeError('primaryActionTimeoutMs must be a finite number greater than zero');
  }

  return new Healer(page, registry, primaryActionTimeoutMs, {
    mode,
    auditSink,
    candidateCollector,
    screenshotCapture,
    resultSink,
    ...(auditProvenance === undefined
      ? {}
      : { auditProvenance: createAuditProvenance(auditProvenance) }),
  });
}
