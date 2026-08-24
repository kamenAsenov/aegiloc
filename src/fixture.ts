import {
  test as playwrightTest,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestInfo,
  type TestType,
} from '@playwright/test';

import { PlaywrightAttachmentAuditSink } from './audit.js';
import { FileScreenshotCapture } from './artifacts.js';
import {
  createHealer,
  type CandidateCollector,
  type CreateHealerOptions,
  type Healer,
} from './healer.js';
import { PlaywrightHealingResultSink } from './result.js';
import type { HealingMode, TargetRegistry } from './types.js';

export interface AegilocFixtures<TTargetKey extends string = string> {
  readonly healer: Healer<TTargetKey>;
}

export type AegilocTest<TTargetKey extends string = string> = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & AegilocFixtures<TTargetKey>,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

export interface CreateAegilocTestOptions<TTargetKey extends string = string> {
  readonly registry: TargetRegistry<TTargetKey>;
  readonly runId: string | ((testInfo: TestInfo) => string);
  readonly commitSha?: string;
  readonly mode?: HealingMode;
  readonly primaryActionTimeoutMs?: number;
  readonly candidateCollector?: CandidateCollector;
  readonly fingerprintObservation?: CreateHealerOptions<TTargetKey>['fingerprintObservation'];
}

function requiredRunId(value: CreateAegilocTestOptions['runId'], testInfo: TestInfo): string {
  const runId = typeof value === 'function' ? value(testInfo) : value;
  if (runId.trim() === '') {
    throw new TypeError('Aegiloc fixture runId must resolve to a non-empty string');
  }
  return runId;
}

export function createAegilocTest<TTargetKey extends string>(
  options: CreateAegilocTestOptions<TTargetKey>,
): AegilocTest<TTargetKey> {
  return playwrightTest.extend<AegilocFixtures<TTargetKey>>({
    healer: async ({ page }, use, testInfo) => {
      const runId = requiredRunId(options.runId, testInfo);
      const healer = createHealer({
        page,
        registry: options.registry,
        ...(options.mode === undefined ? {} : { mode: options.mode }),
        ...(options.primaryActionTimeoutMs === undefined
          ? {}
          : { primaryActionTimeoutMs: options.primaryActionTimeoutMs }),
        ...(options.candidateCollector === undefined
          ? {}
          : { candidateCollector: options.candidateCollector }),
        auditSink: new PlaywrightAttachmentAuditSink(testInfo),
        screenshotCapture: new FileScreenshotCapture(
          page,
          testInfo.outputPath('aegiloc-screenshots'),
        ),
        resultSink: new PlaywrightHealingResultSink(testInfo),
        auditProvenance: {
          runId,
          testId: testInfo.testId,
          projectName: testInfo.project.name.trim() === '' ? 'default' : testInfo.project.name,
          retry: testInfo.retry,
          ...(options.commitSha === undefined ? {} : { commitSha: options.commitSha }),
        },
        ...(options.fingerprintObservation === undefined
          ? {}
          : { fingerprintObservation: options.fingerprintObservation }),
      });
      await use(healer);
    },
  });
}
