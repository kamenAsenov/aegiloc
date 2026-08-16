import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { Ajv2020 } from 'ajv/dist/2020.js';

import {
  ProposalBundleValidationError,
  ProposalHistoryError,
  assessCandidates,
  createHealingAuditEvent,
  createHealingExecutionAuditEvent,
  generateHealingProposals,
  parseAuditHistory,
  parseHealingProposalBundle,
  rankCandidates,
  renderHealingProposalReport,
  verifyHealingProposal,
  verifyHealingProposalBundle,
  type AuditProvenanceInput,
  type HealwrightAuditEvent,
  type HealingAuditEvent,
  type HealingExecutionAuditEvent,
  type PrimaryLocatorDefinition,
  type TargetAction,
  type TargetRegistry,
} from '../src/index.js';

const primary = { type: 'testId', value: 'checkout-terms' } as const;
const registry = {
  version: 1,
  defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
  targets: {
    'checkout.terms': {
      description: 'Store terms acceptance checkbox',
      primary,
      fingerprint: { accessibleRole: 'checkbox', tag: 'input' },
      policy: {
        allowedActions: ['check'],
        healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
      },
    },
  },
} as const satisfies TargetRegistry;

interface PairOptions {
  readonly targetKey?: string;
  readonly action?: TargetAction;
  readonly candidateId?: string;
  readonly accessibleName?: string;
  readonly candidateRole?: string;
  readonly tag?: string;
  readonly primaryLocator?: PrimaryLocatorDefinition;
  readonly parentEventId?: string;
  readonly executionStatus?: 'succeeded' | 'failed' | 'rejected';
  readonly runId?: string;
  readonly testId?: string;
  readonly projectName?: string;
  readonly retry?: number;
  readonly commitSha?: string | null;
  readonly omitProvenance?: boolean;
  readonly executionProvenance?: AuditProvenanceInput;
}

function eventPair(
  index: number,
  options: PairOptions = {},
): readonly [HealingAuditEvent, HealingExecutionAuditEvent] {
  const targetKey = options.targetKey ?? 'checkout.terms';
  const action = options.action ?? 'check';
  const candidateId = options.candidateId ?? `input:accept-terms:${index}`;
  const provenance = {
    runId: options.runId ?? `run-${index}`,
    testId: options.testId ?? 'checkout accepts terms',
    projectName: options.projectName ?? 'chromium',
    retry: options.retry ?? 0,
    ...(options.commitSha === null ? {} : { commitSha: options.commitSha ?? 'abcdef0123456789' }),
  } satisfies AuditProvenanceInput;
  const ranked = rankCandidates(registry.targets['checkout.terms'].fingerprint, [
    {
      id: candidateId,
      ...(options.candidateRole === undefined
        ? { role: 'checkbox' }
        : { role: options.candidateRole }),
      ...(options.accessibleName === undefined
        ? { accessibleName: 'Accept store terms' }
        : options.accessibleName === ''
          ? {}
          : { accessibleName: options.accessibleName }),
      stableAttributes: { name: 'terms', type: 'checkbox' },
      visibleText: 'Accept store terms',
      tag: options.tag ?? 'input',
      ancestorText: ['Checkout'],
      neighborText: ['Accept store terms'],
    },
  ]);
  const assessment = assessCandidates(ranked, registry.targets['checkout.terms'].policy.healing);
  const assessmentEventId = `assessment-${index}`;
  const assessmentEvent = createHealingAuditEvent({
    eventId: assessmentEventId,
    timestamp: `2026-08-15T00:${String(index).padStart(2, '0')}:00.000Z`,
    ...(options.omitProvenance ? {} : { provenance }),
    mode: 'guarded',
    modeDecision: 'eligible',
    targetKey,
    action,
    primaryLocator: options.primaryLocator ?? primary,
    primaryError: new Error('not serialized'),
    collectionStatus: 'completed',
    assessment,
    rankedCandidates: ranked,
  });
  const executionStatus = options.executionStatus ?? 'succeeded';
  const executionEvent = createHealingExecutionAuditEvent({
    eventId: `execution-${index}`,
    timestamp: `2026-08-15T00:${String(index).padStart(2, '0')}:01.000Z`,
    ...(options.omitProvenance ? {} : { provenance: options.executionProvenance ?? provenance }),
    parentEventId: options.parentEventId ?? assessmentEventId,
    targetKey,
    action,
    candidateId,
    status: executionStatus,
    reason: executionStatus === 'succeeded' ? 'succeeded' : 'action-failed',
    screenshots: [
      {
        phase: 'before',
        name: `before-${index}.png`,
        filePath: `/private/not-audited/before-${index}.png`,
        auditPath: `test-results/healwright/before-${index}.png`,
        contentType: 'image/png',
      },
      {
        phase: 'after',
        name: `after-${index}.png`,
        filePath: `/private/not-audited/after-${index}.png`,
        auditPath: `test-results/healwright/after-${index}.png`,
        contentType: 'image/png',
      },
    ],
  });
  return [assessmentEvent, executionEvent];
}

function threeSuccessfulPairs(options: PairOptions = {}): readonly HealwrightAuditEvent[] {
  return [1, 2, 3].flatMap((index) => eventPair(index, options));
}

test('parses JSONL history while ignoring empty lines', () => {
  const events = eventPair(1);
  const contents = `\n${events.map((event) => JSON.stringify(event)).join('\n')}\n\n`;

  expect(parseAuditHistory(contents)).toEqual(events);
});

test('reports the exact malformed JSONL line', () => {
  let caught: unknown;
  try {
    parseAuditHistory(`\n{bad-json}\n`);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ProposalHistoryError);
  expect(caught).toMatchObject({
    message: 'Invalid Healwright history at line 2: invalid JSON',
    cause: expect.any(SyntaxError),
  });
});

test('rejects unsupported audit schema versions', () => {
  const [event] = eventPair(1);
  expect(() => parseAuditHistory(JSON.stringify({ ...event, schemaVersion: 2 }))).toThrow(
    /unsupported audit schema version/,
  );
});

test('rejects duplicate event IDs instead of inflating evidence', () => {
  const [event] = eventPair(1);
  expect(() => parseAuditHistory(`${JSON.stringify(event)}\n${JSON.stringify(event)}`)).toThrow(
    /duplicate eventId/,
  );
});

test('rejects malformed or extended provenance objects from imported history', () => {
  const [assessment] = eventPair(1);
  for (const provenance of [
    { ...assessment.provenance, version: 2 },
    { ...assessment.provenance, retry: -1 },
    { ...assessment.provenance, commitSha: 'not-a-sha' },
    { ...assessment.provenance, unexpected: 'field' },
  ]) {
    expect(() => parseAuditHistory(JSON.stringify({ ...assessment, provenance }))).toThrow(
      /assessment provenance is malformed/,
    );
  }
});

test('rejects malformed semantic eligibility from imported history', () => {
  const [assessment] = eventPair(1);
  const malformedReasons = {
    ...assessment,
    assessment: {
      ...assessment.assessment,
      semanticRejectionReasons: ['not-a-supported-reason'],
    },
  };
  expect(() => parseAuditHistory(JSON.stringify(malformedReasons))).toThrow(
    /semantic rejection reasons are malformed/,
  );

  const malformedEligibility = {
    ...assessment,
    rankedCandidates: assessment.rankedCandidates.map((candidate) => ({
      ...candidate,
      eligibility: { eligible: true, reasons: ['role-mismatch'] },
    })),
  };
  expect(() => parseAuditHistory(JSON.stringify(malformedEligibility))).toThrow(
    /candidate eligibility is malformed/,
  );

  const inconsistentDecision = {
    ...assessment,
    assessment: {
      ...assessment.assessment,
      semanticRejectionReasons: ['role-mismatch'],
    },
  };
  expect(() => parseAuditHistory(JSON.stringify(inconsistentDecision))).toThrow(
    /semantic decision is inconsistent/,
  );
});

test('rejects malformed screenshot records', () => {
  const [, execution] = eventPair(1);
  expect(() =>
    parseAuditHistory(JSON.stringify({ ...execution, screenshots: [{ path: 'before.png' }] })),
  ).toThrow(/execution screenshot is malformed/);
});

test('rejects absolute and traversal screenshot paths from imported history', () => {
  const [, execution] = eventPair(1);
  for (const path of ['/private/screenshot.png', '../screenshot.png', 'file:///screenshot.png']) {
    expect(() =>
      parseAuditHistory(
        JSON.stringify({
          ...execution,
          screenshots: execution.screenshots.map((screenshot, index) =>
            index === 0 ? { ...screenshot, path } : screenshot,
          ),
        }),
      ),
    ).toThrow(/execution screenshot is malformed/);
  }
});

test('requires repeated evidence before creating a proposal', () => {
  const bundle = generateHealingProposals(eventPair(1), registry, {
    generatedAt: '2026-08-15T01:00:00.000Z',
  });

  expect(bundle.proposals).toEqual([]);
  expect(bundle.rejections).toEqual([
    {
      targetKey: 'checkout.terms',
      action: 'check',
      reason: 'insufficient-independent-runs',
      occurrenceCount: 1,
    },
  ]);
});

test('creates a review-required proposal after three successful agreements', () => {
  const bundle = generateHealingProposals(threeSuccessfulPairs(), registry, {
    generatedAt: '2026-08-15T01:00:00.000Z',
  });

  expect(bundle.rejections).toEqual([]);
  expect(bundle.proposals).toHaveLength(1);
  expect(bundle.proposals[0]).toMatchObject({
    status: 'review-required',
    targetKey: 'checkout.terms',
    action: 'check',
    currentPrimary: primary,
    suggestedPrimary: {
      type: 'role',
      role: 'checkbox',
      name: 'Accept store terms',
      exact: true,
    },
    evidence: {
      occurrenceCount: 3,
      distinctRunCount: 3,
      ignoredLegacyCount: 0,
      runIds: ['run-1', 'run-2', 'run-3'],
      testIds: ['checkout accepts terms'],
      projectNames: ['chromium'],
      retryIndices: [0],
      commitShas: ['abcdef0123456789'],
      candidateIds: ['input:accept-terms:1', 'input:accept-terms:2', 'input:accept-terms:3'],
      screenshotPaths: [
        'test-results/healwright/after-1.png',
        'test-results/healwright/after-2.png',
        'test-results/healwright/after-3.png',
        'test-results/healwright/before-1.png',
        'test-results/healwright/before-2.png',
        'test-results/healwright/before-3.png',
      ],
    },
  });
  expect(bundle.proposals[0]?.proposalId).toMatch(/^sha256:[a-f0-9]{64}$/);
});

test('excludes pre-eligibility evidence from locator proposals', () => {
  const events = threeSuccessfulPairs().map((event): HealwrightAuditEvent => {
    if (event.eventType !== 'locator-drift-assessed') {
      return event;
    }
    return {
      ...event,
      rankedCandidates: event.rankedCandidates.map(({ eligibility: omitted, ...candidate }) => {
        void omitted;
        return candidate;
      }),
    };
  });

  const parsed = parseAuditHistory(events.map((event) => JSON.stringify(event)).join('\n'));
  const bundle = generateHealingProposals(parsed, registry);

  expect(bundle.proposals).toEqual([]);
  expect(bundle.rejections[0]).toMatchObject({
    reason: 'unsupported-candidate',
    occurrenceCount: 3,
  });
});

test('keeps legacy history readable but excludes it from proposal confidence', () => {
  const legacyEvents = threeSuccessfulPairs({ omitProvenance: true });
  const parsed = parseAuditHistory(legacyEvents.map((event) => JSON.stringify(event)).join('\n'));
  const bundle = generateHealingProposals(parsed, registry);

  expect(parsed).toEqual(legacyEvents);
  expect(bundle.proposals).toEqual([]);
  expect(bundle.rejections[0]).toEqual({
    targetKey: 'checkout.terms',
    action: 'check',
    reason: 'missing-provenance',
    occurrenceCount: 3,
  });
});

test('ignores legacy observations once enough independent runs exist', () => {
  const bundle = generateHealingProposals(
    [...eventPair(0, { omitProvenance: true }), ...threeSuccessfulPairs()],
    registry,
  );

  expect(bundle.proposals[0]?.evidence).toMatchObject({
    occurrenceCount: 3,
    distinctRunCount: 3,
    ignoredLegacyCount: 1,
  });
});

test('does not let retries or repeated actions in one run inflate confidence', () => {
  const events = [1, 2, 3].flatMap((index) =>
    eventPair(index, {
      runId: 'github-run-100',
      retry: index - 1,
      testId: `checkout-test-${index}`,
    }),
  );
  const bundle = generateHealingProposals(events, registry);

  expect(bundle.proposals).toEqual([]);
  expect(bundle.rejections[0]?.reason).toBe('insufficient-independent-runs');
});

test('rejects assessment and execution events with mismatched provenance', () => {
  const events = threeSuccessfulPairs({
    executionProvenance: {
      runId: 'different-run',
      testId: 'checkout accepts terms',
      projectName: 'chromium',
      retry: 0,
      commitSha: 'abcdef0123456789',
    },
  });

  expect(generateHealingProposals(events, registry).rejections[0]?.reason).toBe(
    'inconsistent-provenance',
  );
});

test('rejects mixed commit revisions across otherwise independent runs', () => {
  const events = [
    ...eventPair(1, { commitSha: 'aaaaaaa' }),
    ...eventPair(2, { commitSha: 'bbbbbbb' }),
    ...eventPair(3, { commitSha: 'aaaaaaa' }),
  ];

  expect(generateHealingProposals(events, registry).rejections[0]?.reason).toBe('mixed-commits');
});

test('rejects partially recorded commit provenance', () => {
  const events = [
    ...eventPair(1, { commitSha: 'aaaaaaa' }),
    ...eventPair(2, { commitSha: null }),
    ...eventPair(3, { commitSha: 'aaaaaaa' }),
  ];

  expect(generateHealingProposals(events, registry).rejections[0]?.reason).toBe('mixed-commits');
});

test('uses semantic identity consensus even when live candidate IDs change', () => {
  const events = [1, 2, 3].flatMap((index) =>
    eventPair(index, { candidateId: `different-dom-path-${index}` }),
  );

  expect(generateHealingProposals(events, registry).proposals).toHaveLength(1);
});

test('rejects conflicting semantic candidates', () => {
  const events = [
    ...eventPair(1, { accessibleName: 'Accept store terms' }),
    ...eventPair(2, { accessibleName: 'Accept terms and marketing' }),
    ...eventPair(3, { accessibleName: 'Accept store terms' }),
  ];

  expect(generateHealingProposals(events, registry).rejections[0]?.reason).toBe(
    'conflicting-candidates',
  );
});

test('rejects orphaned successful executions', () => {
  const events = threeSuccessfulPairs({ parentEventId: 'missing-assessment' });
  expect(generateHealingProposals(events, registry).rejections[0]?.reason).toBe(
    'inconsistent-audit-chain',
  );
});

test('rejects reuse of one assessment by multiple executions', () => {
  const [assessment, execution] = eventPair(1);
  const reusedExecution = {
    ...execution,
    eventId: 'execution-reused',
  } as HealwrightAuditEvent;

  expect(
    generateHealingProposals([assessment, execution, reusedExecution], registry).rejections[0]
      ?.reason,
  ).toBe('inconsistent-audit-chain');
});

test('rejects audit chains for an unknown target', () => {
  expect(
    generateHealingProposals(threeSuccessfulPairs({ targetKey: 'checkout.unknown' }), registry)
      .rejections[0]?.reason,
  ).toBe('unknown-target');
});

test('rejects evidence captured against a stale primary locator', () => {
  expect(
    generateHealingProposals(
      threeSuccessfulPairs({ primaryLocator: { type: 'testId', value: 'older-terms' } }),
      registry,
    ).rejections[0]?.reason,
  ).toBe('stale-primary');
});

test('rejects candidates without an accessible name', () => {
  expect(
    generateHealingProposals(threeSuccessfulPairs({ accessibleName: '' }), registry).rejections[0]
      ?.reason,
  ).toBe('unsupported-candidate');
});

test('rejects candidates with an unsupported role', () => {
  expect(
    generateHealingProposals(threeSuccessfulPairs({ candidateRole: 'invented-widget' }), registry)
      .rejections[0]?.reason,
  ).toBe('unsupported-candidate');
});

test('rejects actions no longer allowed by registry policy', () => {
  expect(
    generateHealingProposals(threeSuccessfulPairs({ action: 'click' }), registry).rejections[0]
      ?.reason,
  ).toBe('inconsistent-audit-chain');
});

test('rejects evidence produced under stale healing thresholds', () => {
  const stricterRegistry = {
    ...registry,
    targets: {
      'checkout.terms': {
        ...registry.targets['checkout.terms'],
        policy: {
          ...registry.targets['checkout.terms'].policy,
          healing: {
            ...registry.targets['checkout.terms'].policy.healing,
            minimumScoreMargin: 0.2,
          },
        },
      },
    },
  } as const satisfies TargetRegistry;

  expect(
    generateHealingProposals(threeSuccessfulPairs(), stricterRegistry).rejections[0]?.reason,
  ).toBe('stale-policy');
});

test('rejects successful execution evidence without both screenshot phases', () => {
  const events = threeSuccessfulPairs().map((event) =>
    event.eventType === 'locator-heal-execution'
      ? { ...event, screenshots: event.screenshots.filter(({ phase }) => phase === 'before') }
      : event,
  );

  expect(generateHealingProposals(events, registry).rejections[0]?.reason).toBe(
    'inconsistent-audit-chain',
  );
});

test('does not treat failed executions as successful evidence', () => {
  const bundle = generateHealingProposals(
    threeSuccessfulPairs({ executionStatus: 'failed' }),
    registry,
  );
  expect(bundle.proposals).toEqual([]);
  expect(bundle.rejections).toEqual([]);
});

test('rejects a suggestion that is already the current locator', () => {
  const rolePrimary = {
    type: 'role',
    role: 'checkbox',
    name: 'Accept store terms',
    exact: true,
  } as const;
  const roleRegistry = {
    ...registry,
    targets: {
      'checkout.terms': { ...registry.targets['checkout.terms'], primary: rolePrimary },
    },
  } satisfies TargetRegistry;

  expect(
    generateHealingProposals(threeSuccessfulPairs({ primaryLocator: rolePrimary }), roleRegistry)
      .rejections[0]?.reason,
  ).toBe('already-current');
});

test('produces the same integrity hash regardless of history ordering', () => {
  const events = threeSuccessfulPairs();
  const forward = generateHealingProposals(events, registry).proposals[0]?.proposalId;
  const reverse = generateHealingProposals([...events].reverse(), registry).proposals[0]
    ?.proposalId;

  expect(reverse).toBe(forward);
});

test('verifies an unchanged proposal against the current registry', () => {
  const proposal = generateHealingProposals(threeSuccessfulPairs(), registry).proposals[0];
  expect(proposal).toBeDefined();
  if (proposal !== undefined) {
    expect(verifyHealingProposal(proposal, registry)).toEqual({ valid: true });
  }
});

test('detects proposal tampering through the integrity hash', () => {
  const proposal = generateHealingProposals(threeSuccessfulPairs(), registry).proposals[0];
  expect(proposal).toBeDefined();
  if (proposal !== undefined) {
    const tampered = {
      ...proposal,
      suggestedPrimary: { ...proposal.suggestedPrimary, name: 'Accept marketing too' },
    };
    expect(verifyHealingProposal(tampered, registry)).toEqual({
      valid: false,
      reason: 'hash-mismatch',
    });
  }
});

test('detects a registry change after proposal generation', () => {
  const proposal = generateHealingProposals(threeSuccessfulPairs(), registry).proposals[0];
  const changedRegistry = {
    ...registry,
    targets: {
      'checkout.terms': {
        ...registry.targets['checkout.terms'],
        primary: { type: 'testId', value: 'manually-updated-terms' },
      },
    },
  } as const satisfies TargetRegistry;
  expect(proposal).toBeDefined();
  if (proposal !== undefined) {
    expect(verifyHealingProposal(proposal, changedRegistry)).toEqual({
      valid: false,
      reason: 'stale-primary',
    });
  }
});

test('detects later fingerprint or policy drift in the target definition', () => {
  const proposal = generateHealingProposals(threeSuccessfulPairs(), registry).proposals[0];
  const changedRegistry = {
    ...registry,
    targets: {
      'checkout.terms': {
        ...registry.targets['checkout.terms'],
        fingerprint: {
          ...registry.targets['checkout.terms'].fingerprint,
          accessibleName: 'A newly reviewed name',
        },
      },
    },
  } as const satisfies TargetRegistry;
  expect(proposal).toBeDefined();
  if (proposal !== undefined) {
    expect(verifyHealingProposal(proposal, changedRegistry)).toEqual({
      valid: false,
      reason: 'stale-target',
    });
  }
});

test('renders a human-review warning and traceable evidence', () => {
  const bundle = generateHealingProposals(threeSuccessfulPairs(), registry, {
    generatedAt: '2026-08-15T01:00:00.000Z',
  });
  const report = renderHealingProposalReport(bundle);

  expect(report).toContain('Review required');
  expect(report).toContain('never edits test source or the locator registry');
  expect(report).toContain('assessment-1');
  expect(report).toContain('test-results/healwright/before-1.png');
});

test('rejects invalid generation options', () => {
  expect(() => generateHealingProposals([], registry, { minimumObservations: 1 })).toThrow(
    /greater than or equal to 2/,
  );
  expect(() => generateHealingProposals([], registry, { generatedAt: 'not-a-date' })).toThrow(
    /valid date-time/,
  );
  expect(() => generateHealingProposals([], registry, { generatedAt: '2026-08-15' })).toThrow(
    /valid date-time/,
  );
});

test('generated bundles satisfy the checked-in JSON Schema', async () => {
  const [proposalSchemaSource, targetSchemaSource] = await Promise.all([
    readFile(new URL('../registry/healing-proposals.schema.json', import.meta.url), 'utf8'),
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
  const bundle = generateHealingProposals(threeSuccessfulPairs(), registry, {
    generatedAt: '2026-08-15T01:00:00.000Z',
  });

  expect(validate(bundle), JSON.stringify(validate.errors)).toBe(true);
});

test('round-trips generated proposal bundles through strict runtime validation', () => {
  const generated = generateHealingProposals(threeSuccessfulPairs(), registry, {
    generatedAt: '2026-08-15T01:00:00.000Z',
  });
  const parsed = parseHealingProposalBundle(JSON.stringify(generated));

  expect(parsed).toEqual(generated);
  expect(verifyHealingProposalBundle(parsed, registry)).toEqual({
    valid: true,
    proposalCount: 1,
  });
});

test('rejects malformed, obsolete, and extended proposal bundles', () => {
  const generated = generateHealingProposals(threeSuccessfulPairs(), registry, {
    generatedAt: '2026-08-15T01:00:00.000Z',
  });
  for (const value of [
    [],
    { ...generated, schemaVersion: 1 },
    { ...generated, unexpected: true },
    { ...generated, proposals: 'not-an-array' },
  ]) {
    expect(() => parseHealingProposalBundle(JSON.stringify(value))).toThrow(
      ProposalBundleValidationError,
    );
  }
});

test('rejects internally inconsistent proposal evidence counts', () => {
  const generated = generateHealingProposals(threeSuccessfulPairs(), registry, {
    generatedAt: '2026-08-15T01:00:00.000Z',
  });
  const proposal = generated.proposals[0];
  expect(proposal).toBeDefined();
  if (proposal !== undefined) {
    const malformed = {
      ...generated,
      proposals: [
        {
          ...proposal,
          evidence: { ...proposal.evidence, distinctRunCount: 4 },
        },
      ],
    };
    expect(() => parseHealingProposalBundle(JSON.stringify(malformed))).toThrow(
      /inconsistent evidence counts/,
    );
  }
});

test('strict proposal parsing rejects unsafe screenshot references', () => {
  const generated = generateHealingProposals(threeSuccessfulPairs(), registry, {
    generatedAt: '2026-08-15T01:00:00.000Z',
  });
  const proposal = generated.proposals[0];
  expect(proposal).toBeDefined();
  if (proposal !== undefined) {
    const malformed = {
      ...generated,
      proposals: [
        {
          ...proposal,
          evidence: {
            ...proposal.evidence,
            screenshotPaths: ['/private/evidence.png', 'test-results/healwright/after.png'],
          },
        },
      ],
    };
    expect(() => parseHealingProposalBundle(JSON.stringify(malformed))).toThrow(
      /unsafe screenshot path/,
    );
  }
});

test('strict proposal parsing rejects candidate and suggested locator disagreement', () => {
  const generated = generateHealingProposals(threeSuccessfulPairs(), registry, {
    generatedAt: '2026-08-15T01:00:00.000Z',
  });
  const proposal = generated.proposals[0];
  expect(proposal).toBeDefined();
  if (proposal !== undefined) {
    const malformed = {
      ...generated,
      proposals: [
        {
          ...proposal,
          candidate: { ...proposal.candidate, accessibleName: 'Different candidate' },
        },
      ],
    };
    expect(() => parseHealingProposalBundle(JSON.stringify(malformed))).toThrow(
      /candidate identity must match/,
    );
  }
});

test('bundle verification reports proposal tampering without mutating inputs', () => {
  const generated = generateHealingProposals(threeSuccessfulPairs(), registry, {
    generatedAt: '2026-08-15T01:00:00.000Z',
  });
  const proposal = generated.proposals[0];
  expect(proposal).toBeDefined();
  if (proposal !== undefined) {
    const tampered = parseHealingProposalBundle(
      JSON.stringify({
        ...generated,
        proposals: [
          {
            ...proposal,
            suggestedPrimary: { ...proposal.suggestedPrimary, name: 'Tampered name' },
            candidate: { ...proposal.candidate, accessibleName: 'Tampered name' },
          },
        ],
      }),
    );
    expect(verifyHealingProposalBundle(tampered, registry)).toMatchObject({
      valid: false,
      issues: [{ targetKey: 'checkout.terms', reason: 'hash-mismatch' }],
    });
  }
});
