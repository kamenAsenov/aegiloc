import { expect, test } from '@playwright/test';
import type { TestCase, TestResult } from '@playwright/test/reporter';

import { healingStatusLines } from '../src/reporter.js';

const testCase = {
  titlePath: () => ['chromium', 'healing.browser.spec.ts', 'heals compatible drift'],
} as unknown as TestCase;

function result(status: TestResult['status'], attachmentNames: readonly string[]): TestResult {
  return {
    status,
    attachments: attachmentNames.map((name) => ({ name })),
  } as unknown as TestResult;
}

test('formats visible PASSED_WITH_HEALING lines for successful marker attachments', () => {
  const lines = healingStatusLines(
    testCase,
    result('passed', ['trace', 'PASSED_WITH_HEALING · checkout.terms check via checkbox:terms:0']),
  );

  expect(lines).toEqual([
    'PASSED_WITH_HEALING chromium › healing.browser.spec.ts › heals compatible drift · PASSED_WITH_HEALING · checkout.terms check via checkbox:terms:0',
  ]);
});

test('does not decorate a failed test even when a marker attachment exists', () => {
  expect(healingStatusLines(testCase, result('failed', ['PASSED_WITH_HEALING · stale']))).toEqual(
    [],
  );
});
