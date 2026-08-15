import { expect, test } from '@playwright/test';

import {
  assessCandidates,
  scoreCandidate,
  type CandidateSnapshot,
  type RankedCandidate,
  type TargetFingerprint,
} from '../src/index.js';

function candidate(overrides: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
  return {
    id: 'candidate',
    role: 'button',
    accessibleName: 'Place order',
    stableAttributes: {},
    visibleText: 'Place order',
    tag: 'button',
    ancestorText: [],
    neighborText: [],
    ...overrides,
  };
}

function ranked(id: string, score: number): RankedCandidate {
  return { candidate: candidate({ id }), score, details: [] };
}

test('normalizes case, punctuation, and diacritics in accessible names', () => {
  const result = scoreCandidate(
    { accessibleName: 'Résumé—READY!' },
    candidate({ accessibleName: 'resume ready' }),
  );

  expect(result.score).toBe(1);
});

test('assigns zero role similarity to a semantic role mismatch', () => {
  const result = scoreCandidate({ accessibleRole: 'button' }, candidate({ role: 'link' }));

  expect(result.score).toBe(0);
  expect(result.details[0]).toMatchObject({ signal: 'accessibleRole', similarity: 0 });
});

test('assigns zero similarity when a candidate signal is absent', () => {
  const { accessibleName: omittedName, ...candidateWithoutName } = candidate();
  void omittedName;
  const result = scoreCandidate({ accessibleName: 'Place order' }, candidateWithoutName);

  expect(result.score).toBe(0);
});

test('averages stable-attribute matches across all expected attributes', () => {
  const result = scoreCandidate(
    { stableAttributes: { name: 'terms', type: 'checkbox' } },
    candidate({ stableAttributes: { name: 'terms' } }),
  );

  expect(result.score).toBe(0.5);
  expect(result.details[0]).toMatchObject({ signal: 'stableAttributes', similarity: 0.5 });
});

test('matches ancestor context by best semantic value rather than array order', () => {
  const fingerprint: TargetFingerprint = { ancestorText: ['Payment', 'Checkout'] };
  const result = scoreCandidate(fingerprint, candidate({ ancestorText: ['Checkout', 'Payment'] }));

  expect(result.score).toBe(1);
});

test('penalizes missing expected neighboring context', () => {
  const result = scoreCandidate(
    { neighborText: ['Store terms', 'Order total'] },
    candidate({ neighborText: ['Store terms'] }),
  );

  expect(result.score).toBeGreaterThan(0.5);
  expect(result.score).toBeLessThan(1);
});

test('assigns a perfect geometry signal to identical normalized boxes', () => {
  const geometry = { x: 0.5, y: 0.75, width: 0.25, height: 0.1 };
  const result = scoreCandidate({ geometry }, candidate({ geometry }));

  expect(result.score).toBe(1);
});

test('clamps maximally distant geometry to zero', () => {
  const result = scoreCandidate(
    { geometry: { x: 0, y: 0, width: 1, height: 1 } },
    candidate({ geometry: { x: 1, y: 1, width: 0, height: 0 } }),
  );

  expect(result.score).toBe(0);
});

test('reweights sparse fingerprints over only their applicable signals', () => {
  const result = scoreCandidate({ tag: 'button' }, candidate({ tag: 'button' }));

  expect(result.score).toBe(1);
  expect(result.details).toHaveLength(1);
  expect(result.details[0]).toMatchObject({ signal: 'tag', contribution: 1 });
});

test('treats confidence and runner-up margin boundaries as inclusive', () => {
  const assessment = assessCandidates([ranked('top', 0.9), ranked('runner-up', 0.75)], {
    enabled: true,
    confidenceThreshold: 0.9,
    minimumScoreMargin: 0.15,
  });

  expect(assessment).toMatchObject({ eligible: true, reason: 'eligible', margin: 0.15 });
});
