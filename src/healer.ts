import { join } from 'node:path';

import type { Locator, Page } from '@playwright/test';

import {
  JsonlAuditSink,
  createHealingAuditEvent,
  type AuditCollectionStatus,
  type AuditModeDecision,
  type AuditSink,
} from './audit.js';
import {
  collectCandidates as collectLiveCandidates,
  type CandidateSnapshot,
} from './candidates.js';
import { executePrimaryAction } from './classification.js';
import {
  AuditWriteError,
  MissingPrimaryLocatorError,
  TargetActionNotAllowedError,
  UnknownTargetError,
} from './errors.js';
import { resolvePrimaryLocator } from './locator.js';
import { assessCandidates, rankCandidates } from './scoring.js';
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
}

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
    await this.execute('click', locator, effectiveOptions.timeout, () =>
      locator.click(effectiveOptions),
    );
  }

  public async fill(value: string, options?: FillOptions): Promise<void> {
    this.assertActionAllowed('fill');
    const locator = this.primaryLocator();
    const effectiveOptions = {
      ...options,
      timeout: options?.timeout ?? this.primaryActionTimeoutMs,
    };
    await this.execute('fill', locator, effectiveOptions.timeout, () =>
      locator.fill(value, effectiveOptions),
    );
  }

  public async check(options?: CheckOptions): Promise<void> {
    this.assertActionAllowed('check');
    const locator = this.primaryLocator();
    const effectiveOptions = {
      ...options,
      timeout: options?.timeout ?? this.primaryActionTimeoutMs,
    };
    await this.execute('check', locator, effectiveOptions.timeout, () =>
      locator.check(effectiveOptions),
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
    return this.execute('selectOption', locator, effectiveOptions.timeout, () =>
      locator.selectOption(values, effectiveOptions),
    );
  }

  private async execute<TResult>(
    action: TargetAction,
    locator: Locator,
    timeoutMs: number,
    invoke: () => Promise<TResult>,
  ): Promise<TResult> {
    if (this.runtime.mode === 'off') {
      return invoke();
    }

    try {
      return await executePrimaryAction({
        targetKey: this.key,
        action,
        locator,
        timeoutMs,
        invoke,
      });
    } catch (error) {
      if (!(error instanceof MissingPrimaryLocatorError)) {
        throw error;
      }

      await this.auditMissingTarget(action, error);
      throw error;
    }
  }

  private async auditMissingTarget(
    action: TargetAction,
    primaryError: MissingPrimaryLocatorError,
  ): Promise<void> {
    const mode = this.runtime.mode;
    if (mode === 'off') {
      return;
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

    const rankedCandidates = rankCandidates(this.definition.fingerprint, candidates);
    const assessment = assessCandidates(rankedCandidates, this.definition.policy.healing);
    const event = createHealingAuditEvent({
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
  });
}
