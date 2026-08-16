import { expect, test } from '@playwright/test';
import fc from 'fast-check';

import {
  assessCandidates,
  rankCandidates,
  scoreCandidate,
  type CandidateSnapshot,
  type HealingPolicy,
  type TargetFingerprint,
  type TargetGeometry,
} from '../src/index.js';

const PROPERTY_SEED = 20_260_815;
const PROPERTY_RUNS = 300;

const semanticCharacterArbitrary = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789БългарияΕλλάδα日本語',
);
const textArbitrary = fc
  .array(semanticCharacterArbitrary, { minLength: 1, maxLength: 32 })
  .map((characters) => characters.join(''));
const probabilityArbitrary = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});
const geometryArbitrary: fc.Arbitrary<TargetGeometry> = fc.record({
  x: probabilityArbitrary,
  y: probabilityArbitrary,
  width: probabilityArbitrary,
  height: probabilityArbitrary,
});
const attributesArbitrary = fc.dictionary(textArbitrary, textArbitrary, {
  minKeys: 1,
  maxKeys: 4,
});
const contextArbitrary = fc.array(textArbitrary, { minLength: 1, maxLength: 4 });

const fingerprintArbitrary: fc.Arbitrary<TargetFingerprint> = fc.record({
  accessibleRole: fc.constantFrom('button', 'checkbox', 'combobox', 'link', 'textbox'),
  accessibleName: textArbitrary,
  stableAttributes: attributesArbitrary,
  visibleText: textArbitrary,
  tag: fc.constantFrom('button', 'input', 'a', 'select', 'textarea'),
  ancestorText: contextArbitrary,
  neighborText: contextArbitrary,
  geometry: geometryArbitrary,
});

const candidateArbitrary: fc.Arbitrary<CandidateSnapshot> = fc.record({
  id: textArbitrary,
  role: fc.constantFrom('button', 'checkbox', 'combobox', 'link', 'textbox'),
  accessibleName: textArbitrary,
  stableAttributes: attributesArbitrary,
  visibleText: textArbitrary,
  tag: fc.constantFrom('button', 'input', 'a', 'select', 'textarea'),
  ancestorText: contextArbitrary,
  neighborText: contextArbitrary,
  geometry: geometryArbitrary,
});

function exactCandidate(fingerprint: TargetFingerprint): CandidateSnapshot {
  return {
    id: 'exact-candidate',
    ...(fingerprint.accessibleRole === undefined ? {} : { role: fingerprint.accessibleRole }),
    ...(fingerprint.accessibleName === undefined
      ? {}
      : { accessibleName: fingerprint.accessibleName }),
    stableAttributes: fingerprint.stableAttributes ?? {},
    visibleText: fingerprint.visibleText ?? '',
    tag: fingerprint.tag ?? '',
    ancestorText: fingerprint.ancestorText ?? [],
    neighborText: fingerprint.neighborText ?? [],
    ...(fingerprint.geometry === undefined ? {} : { geometry: fingerprint.geometry }),
  };
}

test('scoring is deterministic, finite, bounded, and side-effect free', () => {
  fc.assert(
    fc.property(fingerprintArbitrary, candidateArbitrary, (fingerprint, candidate) => {
      const before = structuredClone({ fingerprint, candidate });
      const first = scoreCandidate(fingerprint, candidate);
      const second = scoreCandidate(fingerprint, candidate);

      expect(first).toEqual(second);
      expect(Number.isFinite(first.score)).toBe(true);
      expect(first.score).toBeGreaterThanOrEqual(0);
      expect(first.score).toBeLessThanOrEqual(1);
      expect({ fingerprint, candidate }).toEqual(before);
      for (const detail of first.details) {
        expect(detail.similarity).toBeGreaterThanOrEqual(0);
        expect(detail.similarity).toBeLessThanOrEqual(1);
        expect(detail.contribution).toBeGreaterThanOrEqual(0);
        expect(detail.contribution).toBeLessThanOrEqual(1);
      }
    }),
    { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS },
  );
});

test('an exact semantic candidate always receives the maximum score', () => {
  fc.assert(
    fc.property(fingerprintArbitrary, (fingerprint) => {
      expect(scoreCandidate(fingerprint, exactCandidate(fingerprint)).score).toBe(1);
    }),
    { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS },
  );
});

test('ranking is independent of candidate input order', () => {
  fc.assert(
    fc.property(
      fingerprintArbitrary,
      fc.array(candidateArbitrary, { minLength: 1, maxLength: 20 }),
      (fingerprint, generatedCandidates) => {
        const candidates = generatedCandidates.map((candidate, index) => ({
          ...candidate,
          id: `${index}:${candidate.id}`,
        }));
        const forward = rankCandidates(fingerprint, candidates);
        const reversed = rankCandidates(fingerprint, [...candidates].reverse());

        expect(reversed).toEqual(forward);
      },
    ),
    { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS },
  );
});

test('eligible assessments always satisfy both configured safety gates', () => {
  const policyArbitrary: fc.Arbitrary<HealingPolicy> = fc.record({
    enabled: fc.boolean(),
    confidenceThreshold: probabilityArbitrary,
    minimumScoreMargin: probabilityArbitrary,
  });

  fc.assert(
    fc.property(
      fingerprintArbitrary,
      fc.array(candidateArbitrary, { maxLength: 20 }),
      policyArbitrary,
      (fingerprint, generatedCandidates, policy) => {
        const candidates = generatedCandidates.map((candidate, index) => ({
          ...candidate,
          id: `${index}:${candidate.id}`,
        }));
        const assessment = assessCandidates(rankCandidates(fingerprint, candidates), policy);

        if (assessment.eligible) {
          expect(policy.enabled).toBe(true);
          expect(assessment.topCandidate).toBeDefined();
          expect(assessment.topCandidate?.eligibility).toEqual({ eligible: true, reasons: [] });
          expect(assessment.topCandidate?.score).toBeGreaterThanOrEqual(policy.confidenceThreshold);
          if (assessment.secondCandidate !== undefined) {
            expect(assessment.margin).toBeGreaterThanOrEqual(policy.minimumScoreMargin);
          }
        }
      },
    ),
    { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS },
  );
});
