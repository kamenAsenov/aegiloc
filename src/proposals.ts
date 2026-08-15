import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import {
  AUDIT_SCHEMA_VERSION,
  type AuditRankedCandidate,
  type HealingAuditEvent,
  type HealingExecutionAuditEvent,
  type HealwrightAuditEvent,
} from './audit.js';
import { ProposalHistoryError } from './errors.js';
import { SUPPORTED_ARIA_ROLES } from './registry.js';
import {
  TARGET_ACTIONS,
  type PrimaryLocatorDefinition,
  type RoleLocatorDefinition,
  type TargetAction,
  type TargetDefinition,
  type TargetRegistry,
} from './types.js';

export const HEALING_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const DEFAULT_PROPOSAL_MINIMUM_OBSERVATIONS = 3;
export const HEALING_PROPOSAL_SCHEMA_URL =
  'https://github.com/kamenAsenov/healwright/registry/healing-proposals.schema.json';

export type HealingProposalRejectionReason =
  | 'insufficient-evidence'
  | 'conflicting-candidates'
  | 'inconsistent-audit-chain'
  | 'stale-primary'
  | 'stale-policy'
  | 'unknown-target'
  | 'unsupported-candidate'
  | 'already-current';

export interface HealingProposalEvidence {
  readonly occurrenceCount: number;
  readonly candidateIds: readonly string[];
  readonly assessmentEventIds: readonly string[];
  readonly executionEventIds: readonly string[];
  readonly screenshotPaths: readonly string[];
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly minimumScore: number;
  readonly maximumScore: number;
  readonly minimumMargin: number;
}

export interface HealingProposal {
  readonly schemaVersion: typeof HEALING_PROPOSAL_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly status: 'review-required';
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly targetDefinitionHash: string;
  readonly currentPrimary: PrimaryLocatorDefinition;
  readonly suggestedPrimary: RoleLocatorDefinition;
  readonly candidate: {
    readonly role: RoleLocatorDefinition['role'];
    readonly accessibleName: string;
    readonly tag: string;
  };
  readonly evidence: HealingProposalEvidence;
}

export interface HealingProposalRejection {
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly reason: HealingProposalRejectionReason;
  readonly occurrenceCount: number;
}

export interface HealingProposalBundle {
  readonly $schema: typeof HEALING_PROPOSAL_SCHEMA_URL;
  readonly schemaVersion: typeof HEALING_PROPOSAL_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly minimumObservations: number;
  readonly proposals: readonly HealingProposal[];
  readonly rejections: readonly HealingProposalRejection[];
}

export type HealingProposalVerification =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reason: 'hash-mismatch' | 'stale-primary' | 'stale-target' | 'unknown-target';
    };

interface ProposalObservation {
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly targetDefinitionHash: string;
  readonly currentPrimary: PrimaryLocatorDefinition;
  readonly suggestedPrimary: RoleLocatorDefinition;
  readonly candidate: HealingProposal['candidate'];
  readonly candidateId: string;
  readonly assessmentEventId: string;
  readonly executionEventId: string;
  readonly timestamp: string;
  readonly score: number;
  readonly margin: number;
  readonly screenshotPaths: readonly string[];
}

interface ObservationGroup {
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly observations: ProposalObservation[];
  readonly rejectionReasons: Set<HealingProposalRejectionReason>;
  occurrenceCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isTargetAction(value: unknown): value is TargetAction {
  return typeof value === 'string' && TARGET_ACTIONS.includes(value as TargetAction);
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isDateTime(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isSafeAuditPath(value: string): boolean {
  const containsControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  return (
    !posix.isAbsolute(value) &&
    !win32.isAbsolute(value) &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !value.split(/[\\/]/).includes('..') &&
    !containsControlCharacter
  );
}

function requireCommonEvent(value: Record<string, unknown>, line: number): void {
  if (value.schemaVersion !== AUDIT_SCHEMA_VERSION) {
    throw new ProposalHistoryError(line, 'unsupported audit schema version');
  }
  if (!isNonEmptyString(value.eventId)) {
    throw new ProposalHistoryError(line, 'eventId must be a non-empty string');
  }
  if (!isDateTime(value.timestamp)) {
    throw new ProposalHistoryError(line, 'timestamp must be a valid date-time string');
  }
  if (!isNonEmptyString(value.targetKey)) {
    throw new ProposalHistoryError(line, 'targetKey must be a non-empty string');
  }
  if (!isTargetAction(value.action)) {
    throw new ProposalHistoryError(line, 'action is unsupported');
  }
}

function requireAssessmentEvent(
  value: Record<string, unknown>,
  line: number,
): asserts value is Record<string, unknown> & HealingAuditEvent {
  if (!isRecord(value.primaryLocator)) {
    throw new ProposalHistoryError(line, 'assessment primaryLocator must be an object');
  }
  if (!['observe', 'guarded', 'strict-ci'].includes(String(value.mode))) {
    throw new ProposalHistoryError(line, 'assessment mode is unsupported');
  }
  if (
    !['observed', 'eligible', 'rejected', 'strict-ci-failure'].includes(String(value.modeDecision))
  ) {
    throw new ProposalHistoryError(line, 'assessment modeDecision is unsupported');
  }
  if (
    !isRecord(value.collection) ||
    !['completed', 'failed', 'skipped-policy-disabled'].includes(String(value.collection.status))
  ) {
    throw new ProposalHistoryError(line, 'assessment collection is malformed');
  }
  if (!isRecord(value.assessment) || typeof value.assessment.eligible !== 'boolean') {
    throw new ProposalHistoryError(line, 'assessment decision is malformed');
  }
  if (
    !isProbability(value.assessment.margin) ||
    !isProbability(value.assessment.confidenceThreshold) ||
    !isProbability(value.assessment.minimumScoreMargin)
  ) {
    throw new ProposalHistoryError(line, 'assessment thresholds and margin must be probabilities');
  }
  if (
    value.assessment.topCandidateId !== undefined &&
    !isNonEmptyString(value.assessment.topCandidateId)
  ) {
    throw new ProposalHistoryError(line, 'assessment topCandidateId must be a non-empty string');
  }
  if (!Array.isArray(value.rankedCandidates)) {
    throw new ProposalHistoryError(line, 'rankedCandidates must be an array');
  }
  for (const candidate of value.rankedCandidates) {
    if (
      !isRecord(candidate) ||
      !isNonEmptyString(candidate.id) ||
      !isNonEmptyString(candidate.tag) ||
      typeof candidate.rank !== 'number' ||
      !Number.isInteger(candidate.rank) ||
      candidate.rank < 1 ||
      !isProbability(candidate.score) ||
      (candidate.role !== undefined && !isNonEmptyString(candidate.role)) ||
      (candidate.accessibleName !== undefined && !isNonEmptyString(candidate.accessibleName))
    ) {
      throw new ProposalHistoryError(line, 'ranked candidate is malformed');
    }
  }
}

function requireExecutionEvent(
  value: Record<string, unknown>,
  line: number,
): asserts value is Record<string, unknown> & HealingExecutionAuditEvent {
  if (!isNonEmptyString(value.parentEventId)) {
    throw new ProposalHistoryError(line, 'execution parentEventId must be a non-empty string');
  }
  if (!isNonEmptyString(value.candidateId)) {
    throw new ProposalHistoryError(line, 'execution candidateId must be a non-empty string');
  }
  if (value.mode !== 'guarded') {
    throw new ProposalHistoryError(line, 'execution mode must be guarded');
  }
  if (!['succeeded', 'failed', 'rejected'].includes(String(value.status))) {
    throw new ProposalHistoryError(line, 'execution status is unsupported');
  }
  if (
    ![
      'succeeded',
      'revalidation-changed',
      'candidate-not-unique',
      'artifact-capture-failed',
      'action-failed',
    ].includes(String(value.reason))
  ) {
    throw new ProposalHistoryError(line, 'execution reason is unsupported');
  }
  if (!Array.isArray(value.screenshots)) {
    throw new ProposalHistoryError(line, 'execution screenshots must be an array');
  }
  for (const screenshot of value.screenshots) {
    if (
      !isRecord(screenshot) ||
      !['before', 'after'].includes(String(screenshot.phase)) ||
      !isNonEmptyString(screenshot.name) ||
      !isNonEmptyString(screenshot.path) ||
      !isSafeAuditPath(screenshot.path) ||
      screenshot.contentType !== 'image/png'
    ) {
      throw new ProposalHistoryError(line, 'execution screenshot is malformed');
    }
  }
}

function parseAuditEvent(value: unknown, line: number): HealwrightAuditEvent {
  if (!isRecord(value)) {
    throw new ProposalHistoryError(line, 'expected a JSON object');
  }
  requireCommonEvent(value, line);

  switch (value.eventType) {
    case 'locator-drift-assessed':
      requireAssessmentEvent(value, line);
      return value;
    case 'locator-heal-execution':
      requireExecutionEvent(value, line);
      return value;
    default:
      throw new ProposalHistoryError(line, 'eventType is unsupported');
  }
}

export function parseAuditHistory(contents: string): readonly HealwrightAuditEvent[] {
  const events: HealwrightAuditEvent[] = [];
  const eventIds = new Set<string>();
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === '') {
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new ProposalHistoryError(index + 1, 'invalid JSON', error);
    }
    const event = parseAuditEvent(value, index + 1);
    if (eventIds.has(event.eventId)) {
      throw new ProposalHistoryError(index + 1, `duplicate eventId "${event.eventId}"`);
    }
    eventIds.add(event.eventId);
    events.push(event);
  }
  return events;
}

export async function loadAuditHistory(
  filePath: string | URL,
): Promise<readonly HealwrightAuditEvent[]> {
  return parseAuditHistory(await readFile(filePath, 'utf8'));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function proposalHash(proposal: Omit<HealingProposal, 'proposalId'>): string {
  return sha256(proposal);
}

function targetDefinitionHash(definition: TargetDefinition): string {
  return sha256(definition);
}

function targetActionKey(targetKey: string, action: TargetAction): string {
  return `${targetKey}\u0000${action}`;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function primaryEquals(left: PrimaryLocatorDefinition, right: PrimaryLocatorDefinition): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function getGroup(
  groups: Map<string, ObservationGroup>,
  targetKey: string,
  action: TargetAction,
): ObservationGroup {
  const key = targetActionKey(targetKey, action);
  let group = groups.get(key);
  if (group === undefined) {
    group = {
      targetKey,
      action,
      observations: [],
      rejectionReasons: new Set(),
      occurrenceCount: 0,
    };
    groups.set(key, group);
  }
  return group;
}

function candidateFromAssessment(
  assessment: HealingAuditEvent,
  execution: HealingExecutionAuditEvent,
): AuditRankedCandidate | undefined {
  const top = assessment.rankedCandidates[0];
  if (
    !assessment.assessment.eligible ||
    assessment.mode !== 'guarded' ||
    assessment.modeDecision !== 'eligible' ||
    assessment.collection.status !== 'completed' ||
    execution.reason !== 'succeeded' ||
    assessment.assessment.topCandidateId !== execution.candidateId ||
    top?.id !== execution.candidateId ||
    top.rank !== 1
  ) {
    return undefined;
  }
  return top;
}

function createProposal(observations: readonly ProposalObservation[]): HealingProposal {
  const first = observations[0];
  if (first === undefined) {
    throw new TypeError('Cannot create a proposal without observations');
  }
  const timestamps = observations.map((observation) => observation.timestamp).sort();
  const scores = observations.map((observation) => observation.score);
  const margins = observations.map((observation) => observation.margin);
  const unsigned = {
    schemaVersion: HEALING_PROPOSAL_SCHEMA_VERSION,
    status: 'review-required',
    targetKey: first.targetKey,
    action: first.action,
    targetDefinitionHash: first.targetDefinitionHash,
    currentPrimary: first.currentPrimary,
    suggestedPrimary: first.suggestedPrimary,
    candidate: first.candidate,
    evidence: {
      occurrenceCount: observations.length,
      candidateIds: sortedUnique(observations.map((observation) => observation.candidateId)),
      assessmentEventIds: sortedUnique(
        observations.map((observation) => observation.assessmentEventId),
      ),
      executionEventIds: sortedUnique(
        observations.map((observation) => observation.executionEventId),
      ),
      screenshotPaths: sortedUnique(
        observations.flatMap((observation) => observation.screenshotPaths),
      ),
      firstSeen: timestamps[0] ?? first.timestamp,
      lastSeen: timestamps.at(-1) ?? first.timestamp,
      minimumScore: Math.min(...scores),
      maximumScore: Math.max(...scores),
      minimumMargin: Math.min(...margins),
    },
  } as const satisfies Omit<HealingProposal, 'proposalId'>;

  return { ...unsigned, proposalId: proposalHash(unsigned) };
}

function rejectionPriority(
  reasons: ReadonlySet<HealingProposalRejectionReason>,
): HealingProposalRejectionReason | undefined {
  const priority: readonly HealingProposalRejectionReason[] = [
    'inconsistent-audit-chain',
    'unknown-target',
    'stale-primary',
    'stale-policy',
    'unsupported-candidate',
    'already-current',
  ];
  return priority.find((reason) => reasons.has(reason));
}

export interface GenerateHealingProposalOptions {
  readonly minimumObservations?: number;
  readonly generatedAt?: string;
}

export function generateHealingProposals(
  events: readonly HealwrightAuditEvent[],
  registry: TargetRegistry,
  {
    minimumObservations = DEFAULT_PROPOSAL_MINIMUM_OBSERVATIONS,
    generatedAt = new Date().toISOString(),
  }: GenerateHealingProposalOptions = {},
): HealingProposalBundle {
  if (!Number.isInteger(minimumObservations) || minimumObservations < 2) {
    throw new TypeError('minimumObservations must be an integer greater than or equal to 2');
  }
  if (!isDateTime(generatedAt)) {
    throw new TypeError('generatedAt must be a valid date-time string');
  }

  const assessments = new Map<string, HealingAuditEvent>();
  const duplicateAssessmentIds = new Set<string>();
  for (const event of events) {
    if (event.eventType !== 'locator-drift-assessed') {
      continue;
    }
    if (assessments.has(event.eventId)) {
      duplicateAssessmentIds.add(event.eventId);
    }
    assessments.set(event.eventId, event);
  }
  const groups = new Map<string, ObservationGroup>();
  const usedAssessmentIds = new Set<string>();
  const usedExecutionIds = new Set<string>();

  for (const execution of events) {
    if (execution.eventType !== 'locator-heal-execution' || execution.status !== 'succeeded') {
      continue;
    }
    const group = getGroup(groups, execution.targetKey, execution.action);
    group.occurrenceCount += 1;
    if (usedExecutionIds.has(execution.eventId) || usedAssessmentIds.has(execution.parentEventId)) {
      group.rejectionReasons.add('inconsistent-audit-chain');
      continue;
    }
    usedExecutionIds.add(execution.eventId);
    usedAssessmentIds.add(execution.parentEventId);
    const assessment = assessments.get(execution.parentEventId);
    if (
      assessment === undefined ||
      duplicateAssessmentIds.has(execution.parentEventId) ||
      assessment.targetKey !== execution.targetKey ||
      assessment.action !== execution.action ||
      Date.parse(execution.timestamp) < Date.parse(assessment.timestamp) ||
      !execution.screenshots.some((screenshot) => screenshot.phase === 'before') ||
      !execution.screenshots.some((screenshot) => screenshot.phase === 'after')
    ) {
      group.rejectionReasons.add('inconsistent-audit-chain');
      continue;
    }

    const definition = registry.targets[execution.targetKey];
    if (definition === undefined) {
      group.rejectionReasons.add('unknown-target');
      continue;
    }
    if (!primaryEquals(definition.primary, assessment.primaryLocator)) {
      group.rejectionReasons.add('stale-primary');
      continue;
    }
    if (
      !definition.policy.healing.enabled ||
      !definition.policy.allowedActions.includes(execution.action)
    ) {
      group.rejectionReasons.add('inconsistent-audit-chain');
      continue;
    }

    const candidate = candidateFromAssessment(assessment, execution);
    if (
      candidate?.role === undefined ||
      candidate.accessibleName === undefined ||
      !SUPPORTED_ARIA_ROLES.includes(candidate.role as RoleLocatorDefinition['role']) ||
      !/^[a-z][a-z0-9-]*$/.test(candidate.tag)
    ) {
      group.rejectionReasons.add('unsupported-candidate');
      continue;
    }
    if (
      assessment.assessment.confidenceThreshold !== definition.policy.healing.confidenceThreshold ||
      assessment.assessment.minimumScoreMargin !== definition.policy.healing.minimumScoreMargin ||
      candidate.score < definition.policy.healing.confidenceThreshold ||
      assessment.assessment.margin < definition.policy.healing.minimumScoreMargin
    ) {
      group.rejectionReasons.add('stale-policy');
      continue;
    }
    const suggestedPrimary = {
      type: 'role',
      role: candidate.role as RoleLocatorDefinition['role'],
      name: candidate.accessibleName,
      exact: true,
    } as const;
    if (primaryEquals(definition.primary, suggestedPrimary)) {
      group.rejectionReasons.add('already-current');
      continue;
    }

    group.observations.push({
      targetKey: execution.targetKey,
      action: execution.action,
      targetDefinitionHash: targetDefinitionHash(definition),
      currentPrimary: definition.primary,
      suggestedPrimary,
      candidate: {
        role: suggestedPrimary.role,
        accessibleName: candidate.accessibleName,
        tag: candidate.tag,
      },
      candidateId: execution.candidateId,
      assessmentEventId: assessment.eventId,
      executionEventId: execution.eventId,
      timestamp: execution.timestamp,
      score: candidate.score,
      margin: assessment.assessment.margin,
      screenshotPaths: execution.screenshots.map((screenshot) => screenshot.path),
    });
  }

  const proposals: HealingProposal[] = [];
  const rejections: HealingProposalRejection[] = [];
  const orderedGroups = [...groups.values()].sort((left, right) =>
    targetActionKey(left.targetKey, left.action).localeCompare(
      targetActionKey(right.targetKey, right.action),
    ),
  );

  for (const group of orderedGroups) {
    const prioritizedRejection = rejectionPriority(group.rejectionReasons);
    if (prioritizedRejection !== undefined) {
      rejections.push({
        targetKey: group.targetKey,
        action: group.action,
        reason: prioritizedRejection,
        occurrenceCount: group.occurrenceCount,
      });
      continue;
    }

    const identities = new Set(
      group.observations.map((observation) => canonicalJson(observation.suggestedPrimary)),
    );
    if (identities.size !== 1) {
      rejections.push({
        targetKey: group.targetKey,
        action: group.action,
        reason: 'conflicting-candidates',
        occurrenceCount: group.occurrenceCount,
      });
      continue;
    }
    if (group.observations.length < minimumObservations) {
      rejections.push({
        targetKey: group.targetKey,
        action: group.action,
        reason: 'insufficient-evidence',
        occurrenceCount: group.observations.length,
      });
      continue;
    }
    proposals.push(createProposal(group.observations));
  }

  return {
    $schema: HEALING_PROPOSAL_SCHEMA_URL,
    schemaVersion: HEALING_PROPOSAL_SCHEMA_VERSION,
    generatedAt,
    minimumObservations,
    proposals,
    rejections,
  };
}

export function verifyHealingProposal(
  proposal: HealingProposal,
  registry: TargetRegistry,
): HealingProposalVerification {
  const { proposalId, ...unsigned } = proposal;
  if (proposalId !== proposalHash(unsigned)) {
    return { valid: false, reason: 'hash-mismatch' };
  }
  const definition = registry.targets[proposal.targetKey];
  if (definition === undefined) {
    return { valid: false, reason: 'unknown-target' };
  }
  if (!primaryEquals(definition.primary, proposal.currentPrimary)) {
    return { valid: false, reason: 'stale-primary' };
  }
  if (proposal.targetDefinitionHash !== targetDefinitionHash(definition)) {
    return { valid: false, reason: 'stale-target' };
  }
  return { valid: true };
}

function markdownCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_[\]<>#])/g, '\\$1')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

export function renderHealingProposalReport(bundle: HealingProposalBundle): string {
  const lines = [
    '# Healwright locator proposals',
    '',
    '> Review required: this report never edits test source or the locator registry.',
    '',
    `Generated: ${bundle.generatedAt}`,
    `Minimum observations: ${bundle.minimumObservations}`,
    '',
    '## Proposals',
    '',
  ];

  if (bundle.proposals.length === 0) {
    lines.push('No proposal met every safety gate.', '');
  } else {
    lines.push(
      '| Target | Action | Suggested locator | Observations | Min score | Min margin | Proposal ID |',
      '| --- | --- | --- | ---: | ---: | ---: | --- |',
    );
    for (const proposal of bundle.proposals) {
      lines.push(
        `| ${markdownCell(proposal.targetKey)} | ${proposal.action} | role=${markdownCell(proposal.suggestedPrimary.role)} name=${markdownCell(proposal.suggestedPrimary.name ?? '')} | ${proposal.evidence.occurrenceCount} | ${proposal.evidence.minimumScore.toFixed(6)} | ${proposal.evidence.minimumMargin.toFixed(6)} | \`${proposal.proposalId}\` |`,
      );
    }
    lines.push('');

    lines.push('## Evidence', '');
    for (const proposal of bundle.proposals) {
      lines.push(
        `### ${markdownCell(proposal.targetKey)} · ${proposal.action}`,
        '',
        `- Target definition: \`${proposal.targetDefinitionHash}\``,
        `- Current primary: \`${markdownCell(JSON.stringify(proposal.currentPrimary))}\``,
        `- Suggested primary: \`${markdownCell(JSON.stringify(proposal.suggestedPrimary))}\``,
        `- Assessment events: ${proposal.evidence.assessmentEventIds.map((id) => `\`${markdownCell(id)}\``).join(', ')}`,
        `- Execution events: ${proposal.evidence.executionEventIds.map((id) => `\`${markdownCell(id)}\``).join(', ')}`,
        `- Screenshots: ${
          proposal.evidence.screenshotPaths.length === 0
            ? 'none recorded'
            : proposal.evidence.screenshotPaths
                .map((path) => `\`${markdownCell(path)}\``)
                .join(', ')
        }`,
        '',
      );
    }
  }

  lines.push('## Rejections', '');
  if (bundle.rejections.length === 0) {
    lines.push('None.', '');
  } else {
    lines.push('| Target | Action | Reason | Observations |', '| --- | --- | --- | ---: |');
    for (const rejection of bundle.rejections) {
      lines.push(
        `| ${markdownCell(rejection.targetKey)} | ${rejection.action} | ${rejection.reason} | ${rejection.occurrenceCount} |`,
      );
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
