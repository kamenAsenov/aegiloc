import { errors, expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import {
  CompositeAuditSink,
  FileScreenshotCapture,
  PASSED_WITH_HEALING,
  PlaywrightHealingResultSink,
  TargetActionNotAllowedError,
  UnknownTargetError,
  assessCandidates,
  createHealer,
  createHealingAuditEvent,
  executePrimaryAction,
  type AuditSink,
  type CapturedScreenshot,
  type HealingAuditEvent,
  type HealingMode,
  type TargetRegistry,
} from '../src/index.js';

const registry = {
  version: 1,
  defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
  targets: {
    submit: {
      description: 'Submit button',
      primary: { type: 'role', role: 'button', name: 'Submit', exact: true },
      fingerprint: { accessibleRole: 'button', accessibleName: 'Submit', tag: 'button' },
      policy: {
        allowedActions: ['click'],
        healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
      },
    },
  },
} as const satisfies TargetRegistry<'submit'>;

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
}

function auditEvent(): HealingAuditEvent {
  return createHealingAuditEvent({
    eventId: 'assessment-1',
    timestamp: '2026-08-15T00:00:00.000Z',
    mode: 'observe',
    modeDecision: 'observed',
    targetKey: 'submit',
    action: 'click',
    primaryLocator: registry.targets.submit.primary,
    primaryError: new Error('private primary details'),
    collectionStatus: 'completed',
    assessment: assessCandidates([], {
      enabled: true,
      confidenceThreshold: 0.9,
      minimumScoreMargin: 0.15,
    }),
    rankedCandidates: [],
  });
}

test('zero classification timeout invokes the action without starting a probe', async () => {
  let probeCalls = 0;
  const result = await executePrimaryAction({
    targetKey: 'submit',
    action: 'click',
    locator: {
      waitFor: () => {
        probeCalls += 1;
        return Promise.resolve();
      },
      count: () => Promise.resolve(0),
    },
    timeoutMs: 0,
    invoke: () => Promise.resolve('completed'),
  });

  expect(result).toBe('completed');
  expect(probeCalls).toBe(0);
});

test('a nonzero final locator count preserves the original Playwright timeout', async () => {
  const timeout = new errors.TimeoutError('actionability timeout');
  const error = await captureError(
    executePrimaryAction({
      targetKey: 'submit',
      action: 'click',
      locator: {
        waitFor: () => Promise.reject(new errors.TimeoutError('never attached')),
        count: () => Promise.resolve(1),
      },
      timeoutMs: 100,
      invoke: () => Promise.reject(timeout),
    }),
  );

  expect(error).toBe(timeout);
});

test('a failed final locator count preserves the original Playwright timeout', async () => {
  const timeout = new errors.TimeoutError('actionability timeout');
  const error = await captureError(
    executePrimaryAction({
      targetKey: 'submit',
      action: 'click',
      locator: {
        waitFor: () => Promise.reject(new errors.TimeoutError('never attached')),
        count: () => Promise.reject(new Error('page closed')),
      },
      timeoutMs: 100,
      invoke: () => Promise.reject(timeout),
    }),
  );

  expect(error).toBe(timeout);
});

test('createHealer rejects unsupported runtime modes', () => {
  expect(() =>
    createHealer({
      page: {} as Page,
      registry,
      mode: 'unsafe-auto' as HealingMode,
    }),
  ).toThrow('Unsupported Aegiloc mode: unsafe-auto');
});

test('createHealer rejects nonpositive and nonfinite classification timeouts', () => {
  for (const primaryActionTimeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => createHealer({ page: {} as Page, registry, primaryActionTimeoutMs })).toThrow(
      'primaryActionTimeoutMs must be a finite number greater than zero',
    );
  }
});

test('unknown semantic targets fail before any page interaction', () => {
  const healer = createHealer({ page: {} as Page, registry, mode: 'off' });

  expect(() => healer.target('missing' as 'submit')).toThrow(UnknownTargetError);
});

test('disallowed actions fail before primary locator resolution', async () => {
  const healer = createHealer({ page: {} as Page, registry, mode: 'off' });

  const error = await captureError(healer.target('submit').check());

  expect(error).toBeInstanceOf(TargetActionNotAllowedError);
});

test('composite audit writing stops immediately after a sink failure', async () => {
  const calls: string[] = [];
  const failure = new Error('first sink unavailable');
  const failingSink: AuditSink = {
    write: () => {
      calls.push('failing');
      return Promise.reject(failure);
    },
  };
  const laterSink: AuditSink = {
    write: () => {
      calls.push('later');
      return Promise.resolve();
    },
  };
  const sink = new CompositeAuditSink([failingSink, laterSink]);

  const error = await captureError(sink.write(auditEvent()));

  expect(error).toBe(failure);
  expect(calls).toEqual(['failing']);
});

test('file screenshot capture sanitizes names and applies sensitive-control masking', async ({
  browserName,
}, testInfo) => {
  void browserName;
  let locatorSelector = '';
  let screenshotOptions: Record<string, unknown> | undefined;
  const sensitiveLocator = {} as Locator;
  const page = {
    locator: (selector: string): Locator => {
      locatorSelector = selector;
      return sensitiveLocator;
    },
    screenshot: (options: Record<string, unknown>): Promise<Buffer> => {
      screenshotOptions = options;
      return Promise.resolve(Buffer.alloc(0));
    },
  } as unknown as Page;
  const capture = new FileScreenshotCapture(page, testInfo.outputPath('screenshots'));

  const screenshot = await capture.capture({
    eventId: '../unsafe/event',
    targetKey: 'Checkout / Place Order',
    action: 'click',
    phase: 'before',
  });

  expect(screenshot.name).toBe('checkout-place-order-click-unsafe-event-before.png');
  expect(screenshot.auditPath).not.toMatch(/^\//);
  expect(screenshot.auditPath).not.toContain('..');
  expect(locatorSelector).toContain('input[type="password"]');
  expect(screenshotOptions).toMatchObject({
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    mask: [sensitiveLocator],
    maskColor: '#6d5dfc',
  });
});

test('Playwright healing results add one annotation and structured attachments in order', async () => {
  const annotations: { type: string; description?: string }[] = [];
  const attachmentNames: string[] = [];
  const testInfo = {
    annotations,
    attach: (name: string): Promise<void> => {
      attachmentNames.push(name);
      return Promise.resolve();
    },
  } as unknown as Pick<TestInfo, 'annotations' | 'attach'>;
  const screenshots: readonly CapturedScreenshot[] = [
    {
      phase: 'before',
      name: 'before.png',
      filePath: '/tmp/before.png',
      auditPath: 'test-results/before.png',
      contentType: 'image/png',
    },
    {
      phase: 'after',
      name: 'after.png',
      filePath: '/tmp/after.png',
      auditPath: 'test-results/after.png',
      contentType: 'image/png',
    },
  ];
  const sink = new PlaywrightHealingResultSink(testInfo);

  await sink.record({
    status: PASSED_WITH_HEALING,
    targetKey: 'submit',
    action: 'click',
    candidateId: 'button:submit:0',
    assessmentEventId: 'assessment-1',
    executionEventId: 'execution-1',
    screenshots,
  });

  expect(annotations).toEqual([
    {
      type: PASSED_WITH_HEALING,
      description: 'submit click via button:submit:0',
    },
  ]);
  expect(attachmentNames).toEqual([
    'PASSED_WITH_HEALING · submit click via button:submit:0',
    'aegiloc-before-execution-1',
    'aegiloc-after-execution-1',
  ]);
});
