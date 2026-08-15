import type { CandidateSnapshot } from './candidates.js';
import type { HealingPolicy, TargetFingerprint, TargetGeometry } from './types.js';

export const SCORE_WEIGHTS = {
  accessibleRole: 0.22,
  accessibleName: 0.24,
  stableAttributes: 0.2,
  visibleText: 0.12,
  tag: 0.06,
  ancestorContext: 0.07,
  neighborContext: 0.06,
  geometry: 0.03,
} as const;

export type ScoreSignal = keyof typeof SCORE_WEIGHTS;

export interface ScoreDetail {
  readonly signal: ScoreSignal;
  readonly weight: number;
  readonly similarity: number;
  readonly contribution: number;
}

export interface RankedCandidate {
  readonly candidate: CandidateSnapshot;
  readonly score: number;
  readonly details: readonly ScoreDetail[];
}

export type CandidateAssessmentReason =
  'eligible' | 'disabled' | 'no-candidates' | 'low-confidence' | 'ambiguous';

export interface CandidateAssessment {
  readonly eligible: boolean;
  readonly reason: CandidateAssessmentReason;
  readonly topCandidate?: RankedCandidate;
  readonly secondCandidate?: RankedCandidate;
  readonly margin: number;
  readonly confidenceThreshold: number;
  readonly minimumScoreMargin: number;
}

interface RawDetail {
  readonly signal: ScoreSignal;
  readonly weight: number;
  readonly similarity: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[right.length] ?? Math.max(left.length, right.length);
}

function stringSimilarity(expected: string, actual: string | undefined): number {
  if (actual === undefined) {
    return 0;
  }

  const left = normalizeText(expected);
  const right = normalizeText(actual);
  if (left === '' || right === '') {
    return left === right ? 1 : 0;
  }
  if (left === right) {
    return 1;
  }

  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const tokenScore = union === 0 ? 0 : intersection / union;
  const editScore = 1 - levenshteinDistance(left, right) / Math.max(left.length, right.length);
  return clamp(tokenScore * 0.6 + editScore * 0.4);
}

function contextSimilarity(expected: readonly string[], actual: readonly string[]): number {
  if (expected.length === 0) {
    return 0;
  }

  const total = expected.reduce((sum, expectedText) => {
    const best = actual.reduce(
      (maximum, actualText) => Math.max(maximum, stringSimilarity(expectedText, actualText)),
      0,
    );
    return sum + best;
  }, 0);
  return total / expected.length;
}

function attributeSimilarity(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): number {
  const entries = Object.entries(expected);
  if (entries.length === 0) {
    return 0;
  }

  return (
    entries.reduce((sum, [name, value]) => sum + stringSimilarity(value, actual[name]), 0) /
    entries.length
  );
}

function geometrySimilarity(expected: TargetGeometry, actual: TargetGeometry | undefined): number {
  if (actual === undefined) {
    return 0;
  }

  const distance = Math.hypot(expected.x - actual.x, expected.y - actual.y) / Math.SQRT2;
  const positionScore = clamp(1 - distance);
  const widthScore = 1 - Math.abs(expected.width - actual.width);
  const heightScore = 1 - Math.abs(expected.height - actual.height);
  return clamp(positionScore * 0.7 + ((widthScore + heightScore) / 2) * 0.3);
}

function addDetail(
  details: RawDetail[],
  signal: ScoreSignal,
  similarity: number | undefined,
): void {
  if (similarity === undefined) {
    return;
  }
  details.push({ signal, weight: SCORE_WEIGHTS[signal], similarity: clamp(similarity) });
}

export function scoreCandidate(
  fingerprint: TargetFingerprint,
  candidate: CandidateSnapshot,
): RankedCandidate {
  const rawDetails: RawDetail[] = [];

  addDetail(
    rawDetails,
    'accessibleRole',
    fingerprint.accessibleRole === undefined
      ? undefined
      : normalizeText(fingerprint.accessibleRole) === normalizeText(candidate.role ?? '')
        ? 1
        : 0,
  );
  addDetail(
    rawDetails,
    'accessibleName',
    fingerprint.accessibleName === undefined
      ? undefined
      : stringSimilarity(fingerprint.accessibleName, candidate.accessibleName),
  );
  addDetail(
    rawDetails,
    'stableAttributes',
    fingerprint.stableAttributes === undefined
      ? undefined
      : attributeSimilarity(fingerprint.stableAttributes, candidate.stableAttributes),
  );
  addDetail(
    rawDetails,
    'visibleText',
    fingerprint.visibleText === undefined
      ? undefined
      : stringSimilarity(fingerprint.visibleText, candidate.visibleText),
  );
  addDetail(
    rawDetails,
    'tag',
    fingerprint.tag === undefined
      ? undefined
      : normalizeText(fingerprint.tag) === normalizeText(candidate.tag)
        ? 1
        : 0,
  );
  addDetail(
    rawDetails,
    'ancestorContext',
    fingerprint.ancestorText === undefined
      ? undefined
      : contextSimilarity(fingerprint.ancestorText, candidate.ancestorText),
  );
  addDetail(
    rawDetails,
    'neighborContext',
    fingerprint.neighborText === undefined
      ? undefined
      : contextSimilarity(fingerprint.neighborText, candidate.neighborText),
  );
  addDetail(
    rawDetails,
    'geometry',
    fingerprint.geometry === undefined
      ? undefined
      : geometrySimilarity(fingerprint.geometry, candidate.geometry),
  );

  const applicableWeight = rawDetails.reduce((sum, detail) => sum + detail.weight, 0);
  const details = rawDetails.map((detail) => ({
    ...detail,
    contribution:
      applicableWeight === 0 ? 0 : round((detail.weight * detail.similarity) / applicableWeight),
  }));
  const score = round(details.reduce((sum, detail) => sum + detail.contribution, 0));

  return { candidate, score, details };
}

export function rankCandidates(
  fingerprint: TargetFingerprint,
  candidates: readonly CandidateSnapshot[],
): readonly RankedCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(fingerprint, candidate))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.candidate.id < right.candidate.id
        ? -1
        : left.candidate.id > right.candidate.id
          ? 1
          : 0;
    });
}

export function assessCandidates(
  rankedCandidates: readonly RankedCandidate[],
  policy: HealingPolicy,
): CandidateAssessment {
  const topCandidate = rankedCandidates[0];
  const secondCandidate = rankedCandidates[1];
  const margin = round((topCandidate?.score ?? 0) - (secondCandidate?.score ?? 0));
  const common = {
    ...(topCandidate === undefined ? {} : { topCandidate }),
    ...(secondCandidate === undefined ? {} : { secondCandidate }),
    margin,
    confidenceThreshold: policy.confidenceThreshold,
    minimumScoreMargin: policy.minimumScoreMargin,
  };

  if (!policy.enabled) {
    return { eligible: false, reason: 'disabled', ...common };
  }
  if (topCandidate === undefined) {
    return { eligible: false, reason: 'no-candidates', ...common };
  }
  if (topCandidate.score < policy.confidenceThreshold) {
    return { eligible: false, reason: 'low-confidence', ...common };
  }
  if (secondCandidate !== undefined && margin < policy.minimumScoreMargin) {
    return { eligible: false, reason: 'ambiguous', ...common };
  }

  return { eligible: true, reason: 'eligible', ...common };
}
