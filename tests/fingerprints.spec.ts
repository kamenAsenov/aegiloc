import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { Ajv2020 } from 'ajv/dist/2020.js';

import {
  createPrimaryFingerprintObservation,
  generateFingerprintProposals,
  parseFingerprintObservationHistory,
  renderFingerprintProposalReport,
  type CandidateSnapshot,
  type TargetRegistry,
} from '../src/index.js';

const candidate: CandidateSnapshot = {
  id: 'button:continue:0',
  role: 'button',
  accessibleName: 'Continue securely',
  stableAttributes: { 'data-testid': 'continue', type: 'button' },
  visibleText: 'Continue securely',
  tag: 'button',
  ancestorText: ['Checkout'],
  neighborText: ['Encrypted'],
};

const registry = {
  version: 1,
  defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
  targets: {
    'checkout.continue': {
      description: 'Continue checkout',
      primary: { type: 'testId', value: 'continue' },
      fingerprint: { accessibleRole: 'button', tag: 'button' },
      policy: {
        allowedActions: ['click'],
        healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
      },
    },
  },
} as const satisfies TargetRegistry;

function observation(index: number) {
  return createPrimaryFingerprintObservation({
    eventId: `fingerprint-${index}`,
    timestamp: `2026-08-24T00:0${index}:00.000Z`,
    provenance: {
      runId: `run-${index}`,
      testId: 'checkout continues',
      projectName: 'chromium',
      retry: 0,
      commitSha: 'abcdef0123456789',
    },
    targetKey: 'checkout.continue',
    action: 'click',
    primaryLocator: registry.targets['checkout.continue'].primary,
    candidate,
  });
}

test('round-trips strict primary fingerprint JSONL observations', () => {
  const observations = [observation(1), observation(2)];
  const parsed = parseFingerprintObservationHistory(
    `${observations.map((item) => JSON.stringify(item)).join('\n')}\n`,
  );

  expect(parsed).toEqual(observations);
});

test('creates a review-only fingerprint patch after three independent successful runs', () => {
  const bundle = generateFingerprintProposals(
    [observation(1), observation(2), observation(3)],
    registry,
    {
      generatedAt: '2026-08-24T01:00:00.000Z',
    },
  );

  expect(bundle.rejections).toEqual([]);
  expect(bundle.proposals).toHaveLength(1);
  expect(bundle.proposals[0]).toMatchObject({
    status: 'review-required',
    targetKey: 'checkout.continue',
    registryPatch: [
      {
        op: 'test',
        path: '/targets/checkout.continue/fingerprint',
        value: registry.targets['checkout.continue'].fingerprint,
      },
      {
        op: 'replace',
        path: '/targets/checkout.continue/fingerprint',
      },
    ],
    evidence: { occurrenceCount: 3, distinctRunCount: 3 },
  });
  expect(renderFingerprintProposalReport(bundle)).toContain('never modify the target registry');
});

test('fails closed for conflicting fingerprints and repeated observations from one run', () => {
  const conflicting = {
    ...observation(3),
    fingerprint: { ...observation(3).fingerprint, accessibleName: 'Different' },
  };
  expect(
    generateFingerprintProposals([observation(1), observation(2), conflicting], registry)
      .rejections[0]?.reason,
  ).toBe('conflicting-fingerprints');

  const sameRun = [1, 2, 3].map((index) => {
    const item = observation(index);
    if (item.provenance === undefined) throw new Error('test observation provenance is required');
    return {
      ...item,
      provenance: { ...item.provenance, runId: 'same-run' },
    };
  });
  expect(generateFingerprintProposals(sameRun, registry).rejections[0]?.reason).toBe(
    'insufficient-independent-runs',
  );
});

test('rejects malformed and duplicate observation evidence', () => {
  expect(() => parseFingerprintObservationHistory('{bad-json}')).toThrow(
    /invalid fingerprint observation JSON/,
  );
  const item = observation(1);
  expect(() =>
    parseFingerprintObservationHistory(`${JSON.stringify(item)}\n${JSON.stringify(item)}`),
  ).toThrow(/duplicate eventId/);
});

test('generated bundles satisfy the checked-in JSON Schema', async () => {
  const [proposalSchemaSource, targetSchemaSource] = await Promise.all([
    readFile(new URL('../registry/fingerprint-proposals.schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../registry/targets.schema.json', import.meta.url), 'utf8'),
  ]);
  const proposalSchema = JSON.parse(proposalSchemaSource) as Record<string, unknown>;
  const targetSchema = JSON.parse(targetSchemaSource) as Record<string, unknown>;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    formats: { 'date-time': true },
  });
  ajv.addSchema(targetSchema);
  const validate = ajv.compile(proposalSchema);
  const bundle = generateFingerprintProposals(
    [observation(1), observation(2), observation(3)],
    registry,
    { generatedAt: '2026-08-24T01:00:00.000Z' },
  );

  expect(validate(bundle), JSON.stringify(validate.errors)).toBe(true);
});
