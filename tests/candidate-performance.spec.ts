import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { expect, test } from '@playwright/test';

import { collectCandidates } from '../src/index.js';

interface CandidateCollectionBudget {
  readonly schemaVersion: 1;
  readonly scenario: string;
  readonly candidateCount: number;
  readonly warmupRuns: number;
  readonly sampleRuns: number;
  readonly maximumMedianMilliseconds: number;
  readonly maximumP95Milliseconds: number;
}

async function loadBudget(): Promise<CandidateCollectionBudget> {
  const parsed = JSON.parse(
    await readFile(
      new URL('../performance/candidate-collection-budget.json', import.meta.url),
      'utf8',
    ),
  ) as CandidateCollectionBudget;
  if (
    parsed.schemaVersion !== 1 ||
    !Number.isInteger(parsed.candidateCount) ||
    parsed.candidateCount < 1 ||
    !Number.isInteger(parsed.warmupRuns) ||
    parsed.warmupRuns < 0 ||
    !Number.isInteger(parsed.sampleRuns) ||
    parsed.sampleRuns < 3 ||
    parsed.maximumMedianMilliseconds <= 0 ||
    parsed.maximumP95Milliseconds < parsed.maximumMedianMilliseconds
  ) {
    throw new TypeError('Candidate collection performance budget is malformed');
  }
  return parsed;
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? Number.POSITIVE_INFINITY;
}

test('candidate collection stays within the reviewed browser budget', async ({
  page,
  browserName,
}) => {
  test.slow();
  const budget = await loadBudget();
  const buttons = Array.from(
    { length: budget.candidateCount },
    (_, index) =>
      `<div><span>Neighbor ${String(index)}</span><button data-testid="action-${String(index)}" type="button">Action ${String(index)}</button><span>Context ${String(index)}</span></div>`,
  ).join('');
  await page.setContent(`<main aria-label="Performance fixture">${buttons}</main>`);

  for (let index = 0; index < budget.warmupRuns; index += 1) {
    expect(await collectCandidates(page, 'click')).toHaveLength(budget.candidateCount);
  }

  const durations: number[] = [];
  for (let index = 0; index < budget.sampleRuns; index += 1) {
    const startedAt = performance.now();
    const candidates = await collectCandidates(page, 'click');
    durations.push(performance.now() - startedAt);
    expect(candidates).toHaveLength(budget.candidateCount);
  }
  durations.sort((left, right) => left - right);
  const median = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  process.stdout.write(
    `CANDIDATE_COLLECTION_PERF ${browserName} · ${String(budget.candidateCount)} candidates · median ${median.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms\n`,
  );

  expect(median, `${budget.scenario}: median budget`).toBeLessThanOrEqual(
    budget.maximumMedianMilliseconds,
  );
  expect(p95, `${budget.scenario}: p95 budget`).toBeLessThanOrEqual(budget.maximumP95Milliseconds);
});
