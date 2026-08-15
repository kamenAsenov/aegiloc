import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import { PASSED_WITH_HEALING } from './result.js';

export function healingStatusLines(test: TestCase, result: TestResult): readonly string[] {
  if (result.status !== 'passed') {
    return [];
  }

  const testTitle = test
    .titlePath()
    .filter((part) => part !== '')
    .join(' › ');
  return result.attachments
    .filter((attachment) => attachment.name.startsWith(PASSED_WITH_HEALING))
    .map((attachment) => `${PASSED_WITH_HEALING} ${testTitle} · ${attachment.name}`);
}

export default class HealwrightReporter implements Reporter {
  public onTestEnd(test: TestCase, result: TestResult): void {
    for (const line of healingStatusLines(test, result)) {
      process.stdout.write(`${line}\n`);
    }
  }
}
