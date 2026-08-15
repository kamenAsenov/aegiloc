import { expect, test } from '@playwright/test';

import {
  assessCandidates,
  rankCandidates,
  scoreCandidate,
  type CandidateSnapshot,
  type HealingPolicy,
  type TargetFingerprint,
} from '../src/index.js';

const fingerprint: TargetFingerprint = {
  accessibleRole: 'button',
  accessibleName: 'Place order',
  stableAttributes: { 'data-target': 'place-order', type: 'submit' },
  visibleText: 'Place order',
  tag: 'button',
  ancestorText: ['Checkout'],
  neighborText: ['I agree to the store terms'],
  geometry: { x: 0.5, y: 0.75, width: 0.3, height: 0.08 },
};

const policy: HealingPolicy = {
  enabled: true,
  confidenceThreshold: 0.9,
  minimumScoreMargin: 0.15,
};

function candidate(overrides: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
  return {
    id: 'button:place-order:0',
    role: 'button',
    accessibleName: 'Place order',
    stableAttributes: { 'data-target': 'place-order', type: 'submit' },
    visibleText: 'Place order',
    tag: 'button',
    ancestorText: ['Checkout'],
    neighborText: ['I agree to the store terms'],
    geometry: { x: 0.5, y: 0.75, width: 0.3, height: 0.08 },
    ...overrides,
  };
}

test('assigns a perfect deterministic score to an exact semantic match', () => {
  const result = scoreCandidate(fingerprint, candidate());

  expect(result.score).toBe(1);
  expect(result.details.map((detail) => detail.signal)).toEqual([
    'accessibleRole',
    'accessibleName',
    'stableAttributes',
    'visibleText',
    'tag',
    'ancestorContext',
    'neighborContext',
    'geometry',
  ]);
});

test('ranks by score and uses candidate id as a deterministic tie-breaker', () => {
  const ranked = rankCandidates(fingerprint, [
    candidate({ id: 'button:z:1' }),
    candidate({ id: 'button:a:0' }),
    candidate({ id: 'button:weak:2', accessibleName: 'Cancel', visibleText: 'Cancel' }),
  ]);

  expect(ranked.map((entry) => entry.candidate.id)).toEqual([
    'button:a:0',
    'button:z:1',
    'button:weak:2',
  ]);
});

test('rejects a high-confidence but ambiguous pair', () => {
  const ranked = rankCandidates(fingerprint, [
    candidate({ id: 'button:first:0' }),
    candidate({ id: 'button:second:1' }),
  ]);

  expect(assessCandidates(ranked, policy)).toMatchObject({
    eligible: false,
    reason: 'ambiguous',
    margin: 0,
  });
});

test('rejects a low-confidence candidate', () => {
  const ranked = rankCandidates(fingerprint, [
    candidate({
      id: 'link:help:0',
      role: 'link',
      accessibleName: 'Help',
      stableAttributes: { href: '/help' },
      visibleText: 'Help',
      tag: 'a',
      ancestorText: ['Support'],
      neighborText: [],
    }),
  ]);

  expect(assessCandidates(ranked, policy)).toMatchObject({
    eligible: false,
    reason: 'low-confidence',
  });
});

test('accepts only a confident candidate with a safe runner-up margin', () => {
  const ranked = rankCandidates(fingerprint, [
    candidate(),
    candidate({
      id: 'button:cancel:1',
      accessibleName: 'Cancel order',
      stableAttributes: { 'data-target': 'cancel-order', type: 'button' },
      visibleText: 'Cancel order',
      geometry: { x: 0.2, y: 0.2, width: 0.2, height: 0.08 },
    }),
  ]);

  expect(assessCandidates(ranked, policy)).toMatchObject({
    eligible: true,
    reason: 'eligible',
  });
});

test('keeps geometry too weak to outweigh semantic mismatch', () => {
  const semanticMatch = candidate({
    id: 'button:semantic:0',
    geometry: { x: 0, y: 0, width: 0.05, height: 0.05 },
  });
  const geometricMatch = candidate({
    id: 'button:geometric:1',
    role: 'link',
    accessibleName: 'Help center',
    stableAttributes: { href: '/help' },
    visibleText: 'Help center',
    tag: 'a',
    ancestorText: ['Support'],
    neighborText: ['Contact us'],
  });

  const ranked = rankCandidates(fingerprint, [geometricMatch, semanticMatch]);
  expect(ranked[0]?.candidate.id).toBe('button:semantic:0');
});
