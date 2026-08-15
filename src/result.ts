import type { TestInfo } from '@playwright/test';

import type { CapturedScreenshot } from './artifacts.js';
import type { TargetAction } from './types.js';

export const PASSED_WITH_HEALING = 'PASSED_WITH_HEALING' as const;

export interface HealingSuccessResult {
  readonly status: typeof PASSED_WITH_HEALING;
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly candidateId: string;
  readonly assessmentEventId: string;
  readonly executionEventId: string;
  readonly screenshots: readonly CapturedScreenshot[];
}

export interface HealingResultSink {
  record(result: HealingSuccessResult): Promise<void>;
}

export class NoopHealingResultSink implements HealingResultSink {
  public record(): Promise<void> {
    return Promise.resolve();
  }
}

export class ConsoleHealingResultSink implements HealingResultSink {
  public record(result: HealingSuccessResult): Promise<void> {
    process.stdout.write(
      `${PASSED_WITH_HEALING} ${result.targetKey} ${result.action} via ${result.candidateId}\n`,
    );
    return Promise.resolve();
  }
}

export class InMemoryHealingResultSink implements HealingResultSink {
  readonly #results: HealingSuccessResult[] = [];

  public get results(): readonly HealingSuccessResult[] {
    return this.#results;
  }

  public record(result: HealingSuccessResult): Promise<void> {
    this.#results.push(result);
    return Promise.resolve();
  }
}

export class PlaywrightHealingResultSink implements HealingResultSink {
  public constructor(private readonly testInfo: Pick<TestInfo, 'annotations' | 'attach'>) {}

  public async record(result: HealingSuccessResult): Promise<void> {
    const description = `${result.targetKey} ${result.action} via ${result.candidateId}`;
    this.testInfo.annotations.push({ type: PASSED_WITH_HEALING, description });
    await this.testInfo.attach(`${PASSED_WITH_HEALING} · ${description}`, {
      body: JSON.stringify(
        {
          status: result.status,
          targetKey: result.targetKey,
          action: result.action,
          candidateId: result.candidateId,
          assessmentEventId: result.assessmentEventId,
          executionEventId: result.executionEventId,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    for (const screenshot of result.screenshots) {
      await this.testInfo.attach(`healwright-${screenshot.phase}-${result.executionEventId}`, {
        path: screenshot.filePath,
        contentType: screenshot.contentType,
      });
    }
  }
}
