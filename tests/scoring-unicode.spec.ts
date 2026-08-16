import { expect, test } from '@playwright/test';

import { scoreCandidate, type CandidateSnapshot } from '../src/index.js';

function candidate(accessibleName: string): CandidateSnapshot {
  return {
    id: 'button:unicode:0',
    role: 'button',
    accessibleName,
    stableAttributes: {},
    visibleText: accessibleName,
    tag: 'button',
    ancestorText: [],
    neighborText: [],
  };
}

function nameSimilarity(expected: string, actual: string): number {
  const result = scoreCandidate({ accessibleName: expected }, candidate(actual));
  return result.details.find((detail) => detail.signal === 'accessibleName')?.similarity ?? -1;
}

test('matches identical Bulgarian labels', () => {
  expect(nameSimilarity('Направи поръчка', 'Направи поръчка')).toBe(1);
});

test('scores an intentionally changed Bulgarian label below an exact match', () => {
  const similarity = nameSimilarity('Направи поръчка', 'Завърши поръчката');
  expect(similarity).toBeGreaterThan(0);
  expect(similarity).toBeLessThan(1);
});

test('does not give unrelated Bulgarian labels a perfect score', () => {
  expect(nameSimilarity('Поръчай', 'Отказ')).toBeLessThan(1);
});

test('distinguishes Bulgarian text from empty text', () => {
  expect(nameSimilarity('Поръчай', '')).toBe(0);
});

test('assigns zero similarity to punctuation-only strings', () => {
  expect(nameSimilarity('!!!', '???')).toBe(0);
  expect(nameSimilarity('—', '—')).toBe(0);
});

test('matches accented and unaccented Latin labels deterministically', () => {
  expect(nameSimilarity('Résumé prêt', 'Resume pret')).toBe(1);
});

test('preserves Greek letters during normalization', () => {
  expect(nameSimilarity('Ολοκλήρωση αγοράς', 'Ολοκλήρωση αγοράς')).toBe(1);
  expect(nameSimilarity('Αποδοχή', 'Ακύρωση')).toBeLessThan(1);
});

test('preserves CJK identity without equating unrelated labels', () => {
  expect(nameSimilarity('注文を確定', '注文を確定')).toBe(1);
  expect(nameSimilarity('注文を確定', 'キャンセル')).toBeLessThan(1);
});

test('supports mixed-script labels without collapsing their content', () => {
  expect(nameSimilarity('Pay Поръчай 支払', 'Pay Поръчай 支払')).toBe(1);
  expect(nameSimilarity('Pay Поръчай 支払', 'Pay Отказ 取消')).toBeLessThan(1);
});

test('repeated multilingual scoring is deterministic', () => {
  const scores = Array.from({ length: 25 }, () =>
    nameSimilarity('Плащане Résumé 支払', 'Плащане Resume 支払'),
  );
  expect(new Set(scores)).toEqual(new Set([1]));
});
