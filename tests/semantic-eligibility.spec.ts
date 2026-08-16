import { expect, test } from '@playwright/test';

import {
  assessCandidates,
  createHealingAuditEvent,
  rankCandidates,
  scoreCandidate,
  type CandidateSnapshot,
  type HealingPolicy,
  type TargetFingerprint,
} from '../src/index.js';

const fingerprint: TargetFingerprint = {
  accessibleRole: 'button',
  accessibleName: 'Place order',
  stableAttributes: { 'data-target': 'place-order' },
  visibleText: 'Place order',
  tag: 'button',
  ancestorText: ['Checkout'],
};

const permissivePolicy: HealingPolicy = {
  enabled: true,
  confidenceThreshold: 0.5,
  minimumScoreMargin: 0,
};

function candidate(overrides: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
  return {
    id: 'button:place-order:0',
    role: 'button',
    accessibleName: 'Place order',
    stableAttributes: { 'data-target': 'place-order' },
    visibleText: 'Place order',
    tag: 'button',
    ancestorText: ['Checkout'],
    neighborText: [],
    ...overrides,
  };
}

test('same text with the wrong known role is semantically ineligible', () => {
  const ranked = rankCandidates(fingerprint, [candidate({ role: 'link' })], 'click');
  expect(ranked[0]).toMatchObject({
    eligibility: { eligible: false, reasons: ['role-mismatch'] },
  });
  expect(assessCandidates(ranked, permissivePolicy)).toMatchObject({
    eligible: false,
    reason: 'semantic-ineligible',
    semanticRejectionReasons: ['role-mismatch'],
  });
});

test('matching attributes cannot compensate for an incompatible registered tag', () => {
  const result = scoreCandidate(fingerprint, candidate({ tag: 'a' }), 'click');
  expect(result.eligibility).toEqual({ eligible: false, reasons: ['tag-mismatch'] });
});

test('a high weighted score never overrides a semantic contradiction', () => {
  const ranked = rankCandidates(
    fingerprint,
    [candidate({ role: 'link', tag: 'a', stableAttributes: { 'data-target': 'place-order' } })],
    'click',
  );
  expect(ranked[0]?.score).toBeGreaterThan(permissivePolicy.confidenceThreshold);
  expect(assessCandidates(ranked, permissivePolicy).eligible).toBe(false);
});

test('missing accessible identity fails closed', () => {
  const { role: omittedRole, accessibleName: omittedName, ...withoutIdentity } = candidate();
  void omittedRole;
  void omittedName;
  const ranked = rankCandidates(fingerprint, [withoutIdentity], 'click');
  expect(ranked[0]?.eligibility).toEqual({
    eligible: false,
    reasons: ['missing-role', 'missing-accessible-name'],
  });
});

test('action compatibility is mandatory even when no registered tag is available', () => {
  const noTagFingerprint: TargetFingerprint = {
    accessibleRole: 'textbox',
    accessibleName: 'Cardholder name',
  };
  const result = scoreCandidate(
    noTagFingerprint,
    candidate({ role: 'textbox', accessibleName: 'Cardholder name', tag: 'button' }),
    'fill',
  );
  expect(result.eligibility).toEqual({
    eligible: false,
    reasons: ['action-incompatible'],
  });
});

test('semantic rejection is serialized deterministically in audit evidence', () => {
  const ranked = rankCandidates(fingerprint, [candidate({ role: 'link' })], 'click');
  const assessment = assessCandidates(ranked, permissivePolicy);
  const options = {
    eventId: 'semantic-audit',
    timestamp: '2026-08-16T00:00:00.000Z',
    mode: 'observe' as const,
    modeDecision: 'observed' as const,
    targetKey: 'checkout.placeOrder',
    action: 'click' as const,
    primaryLocator: { type: 'role' as const, role: 'button' as const, name: 'Place order' },
    primaryError: new Error('not serialized'),
    collectionStatus: 'completed' as const,
    assessment,
    rankedCandidates: ranked,
  };

  const first = createHealingAuditEvent(options);
  const second = createHealingAuditEvent(options);
  expect(second).toEqual(first);
  expect(first).toMatchObject({
    assessment: {
      eligible: false,
      reason: 'semantic-ineligible',
      semanticRejectionReasons: ['role-mismatch'],
    },
    rankedCandidates: [{ eligibility: { eligible: false, reasons: ['role-mismatch'] } }],
  });
});
