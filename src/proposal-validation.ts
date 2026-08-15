import { readFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import { ProposalBundleValidationError } from './errors.js';
import {
  HEALING_PROPOSAL_SCHEMA_URL,
  HEALING_PROPOSAL_SCHEMA_VERSION,
  verifyHealingProposal,
  type HealingProposal,
  type HealingProposalBundle,
  type HealingProposalRejection,
  type HealingProposalRejectionReason,
  type HealingProposalVerification,
} from './proposals.js';
import { SUPPORTED_ARIA_ROLES } from './registry.js';
import {
  TARGET_ACTIONS,
  type PrimaryLocatorDefinition,
  type RoleLocatorDefinition,
  type TargetAction,
  type TargetRegistry,
} from './types.js';

const REJECTION_REASONS = [
  'insufficient-evidence',
  'conflicting-candidates',
  'inconsistent-audit-chain',
  'inconsistent-provenance',
  'missing-provenance',
  'insufficient-independent-runs',
  'mixed-commits',
  'stale-primary',
  'stale-policy',
  'unknown-target',
  'unsupported-candidate',
  'already-current',
] as const satisfies readonly HealingProposalRejectionReason[];

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProposalBundleValidationError(path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected !== undefined) {
    throw new ProposalBundleValidationError(`${path}.${unexpected}`, 'unexpected property');
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProposalBundleValidationError(path, 'expected a non-empty string');
  }
  return value;
}

function integer(value: unknown, path: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new ProposalBundleValidationError(
      path,
      `expected an integer greater than or equal to ${minimum}`,
    );
  }
  return value;
}

function probability(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ProposalBundleValidationError(path, 'expected a finite number between zero and one');
  }
  return value;
}

function dateTime(value: unknown, path: string): string {
  const result = text(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    Number.isNaN(Date.parse(result))
  ) {
    throw new ProposalBundleValidationError(path, 'expected a valid date-time string');
  }
  return result;
}

function hash(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) {
    throw new ProposalBundleValidationError(path, 'expected a lowercase SHA-256 identifier');
  }
  return result;
}

function action(value: unknown, path: string): TargetAction {
  if (typeof value !== 'string' || !TARGET_ACTIONS.includes(value as TargetAction)) {
    throw new ProposalBundleValidationError(path, 'unsupported target action');
  }
  return value as TargetAction;
}

function stringSet(value: unknown, path: string, minimumItems = 0): readonly string[] {
  if (!Array.isArray(value) || value.length < minimumItems) {
    throw new ProposalBundleValidationError(
      path,
      `expected at least ${minimumItems} string values`,
    );
  }
  const entries = value.map((entry, index) => text(entry, `${path}[${index}]`));
  if (
    new Set(entries).size !== entries.length ||
    [...entries].sort().join('\0') !== entries.join('\0')
  ) {
    throw new ProposalBundleValidationError(path, 'expected unique values in deterministic order');
  }
  return entries;
}

function integerSet(value: unknown, path: string, minimumItems = 0): readonly number[] {
  if (!Array.isArray(value) || value.length < minimumItems) {
    throw new ProposalBundleValidationError(
      path,
      `expected at least ${minimumItems} integer values`,
    );
  }
  const entries = value.map((entry, index) => integer(entry, `${path}[${index}]`, 0));
  const sorted = [...entries].sort((left, right) => left - right);
  if (
    new Set(entries).size !== entries.length ||
    sorted.some((entry, index) => entry !== entries[index])
  ) {
    throw new ProposalBundleValidationError(
      path,
      'expected unique integers in deterministic order',
    );
  }
  return entries;
}

function safeScreenshotPaths(value: unknown, path: string): readonly string[] {
  const paths = stringSet(value, path, 2);
  for (const [index, screenshotPath] of paths.entries()) {
    if (
      posix.isAbsolute(screenshotPath) ||
      win32.isAbsolute(screenshotPath) ||
      /^[a-z][a-z0-9+.-]*:/i.test(screenshotPath) ||
      screenshotPath.split(/[\\/]/).includes('..')
    ) {
      throw new ProposalBundleValidationError(`${path}[${index}]`, 'unsafe screenshot path');
    }
  }
  return paths;
}

function primaryLocator(value: unknown, path: string): PrimaryLocatorDefinition {
  const locator = record(value, path);
  const type = text(locator.type, `${path}.type`);
  switch (type) {
    case 'role': {
      onlyKeys(locator, ['type', 'role', 'name', 'exact'], path);
      const role = text(locator.role, `${path}.role`);
      if (!SUPPORTED_ARIA_ROLES.includes(role as RoleLocatorDefinition['role'])) {
        throw new ProposalBundleValidationError(`${path}.role`, 'unsupported ARIA role');
      }
      if (locator.exact !== undefined && typeof locator.exact !== 'boolean') {
        throw new ProposalBundleValidationError(`${path}.exact`, 'expected a boolean');
      }
      return {
        type,
        role: role as RoleLocatorDefinition['role'],
        ...(locator.name === undefined ? {} : { name: text(locator.name, `${path}.name`) }),
        ...(locator.exact === undefined ? {} : { exact: locator.exact }),
      };
    }
    case 'label':
    case 'text': {
      onlyKeys(locator, ['type', 'value', 'exact'], path);
      if (locator.exact !== undefined && typeof locator.exact !== 'boolean') {
        throw new ProposalBundleValidationError(`${path}.exact`, 'expected a boolean');
      }
      return {
        type,
        value: text(locator.value, `${path}.value`),
        ...(locator.exact === undefined ? {} : { exact: locator.exact }),
      };
    }
    case 'testId':
    case 'css':
      onlyKeys(locator, ['type', 'value'], path);
      return { type, value: text(locator.value, `${path}.value`) };
    default:
      throw new ProposalBundleValidationError(`${path}.type`, 'unsupported locator type');
  }
}

function proposal(value: unknown, path: string, minimumObservations: number): HealingProposal {
  const item = record(value, path);
  onlyKeys(
    item,
    [
      'schemaVersion',
      'proposalId',
      'status',
      'targetKey',
      'action',
      'targetDefinitionHash',
      'currentPrimary',
      'suggestedPrimary',
      'candidate',
      'evidence',
    ],
    path,
  );
  if (item.schemaVersion !== HEALING_PROPOSAL_SCHEMA_VERSION || item.status !== 'review-required') {
    throw new ProposalBundleValidationError(path, 'unsupported proposal version or status');
  }
  const suggested = primaryLocator(item.suggestedPrimary, `${path}.suggestedPrimary`);
  if (suggested.type !== 'role' || suggested.name === undefined || suggested.exact !== true) {
    throw new ProposalBundleValidationError(
      `${path}.suggestedPrimary`,
      'expected an exact named role locator',
    );
  }
  const candidateValue = record(item.candidate, `${path}.candidate`);
  onlyKeys(candidateValue, ['role', 'accessibleName', 'tag'], `${path}.candidate`);
  const candidateRole = text(candidateValue.role, `${path}.candidate.role`);
  if (!SUPPORTED_ARIA_ROLES.includes(candidateRole as RoleLocatorDefinition['role'])) {
    throw new ProposalBundleValidationError(`${path}.candidate.role`, 'unsupported ARIA role');
  }
  const candidateAccessibleName = text(
    candidateValue.accessibleName,
    `${path}.candidate.accessibleName`,
  );
  const tag = text(candidateValue.tag, `${path}.candidate.tag`);
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
    throw new ProposalBundleValidationError(`${path}.candidate.tag`, 'invalid HTML tag');
  }
  if (candidateRole !== suggested.role || candidateAccessibleName !== suggested.name) {
    throw new ProposalBundleValidationError(
      `${path}.candidate`,
      'candidate identity must match the suggested role locator',
    );
  }

  const evidenceValue = record(item.evidence, `${path}.evidence`);
  onlyKeys(
    evidenceValue,
    [
      'occurrenceCount',
      'distinctRunCount',
      'ignoredLegacyCount',
      'runIds',
      'testIds',
      'projectNames',
      'retryIndices',
      'commitShas',
      'candidateIds',
      'assessmentEventIds',
      'executionEventIds',
      'screenshotPaths',
      'firstSeen',
      'lastSeen',
      'minimumScore',
      'maximumScore',
      'minimumMargin',
    ],
    `${path}.evidence`,
  );
  const occurrenceCount = integer(
    evidenceValue.occurrenceCount,
    `${path}.evidence.occurrenceCount`,
    2,
  );
  const distinctRunCount = integer(
    evidenceValue.distinctRunCount,
    `${path}.evidence.distinctRunCount`,
    2,
  );
  const runIds = stringSet(evidenceValue.runIds, `${path}.evidence.runIds`, 2);
  const assessmentEventIds = stringSet(
    evidenceValue.assessmentEventIds,
    `${path}.evidence.assessmentEventIds`,
    2,
  );
  const executionEventIds = stringSet(
    evidenceValue.executionEventIds,
    `${path}.evidence.executionEventIds`,
    2,
  );
  if (
    distinctRunCount !== runIds.length ||
    occurrenceCount < distinctRunCount ||
    distinctRunCount < minimumObservations ||
    assessmentEventIds.length !== occurrenceCount ||
    executionEventIds.length !== occurrenceCount
  ) {
    throw new ProposalBundleValidationError(`${path}.evidence`, 'inconsistent evidence counts');
  }
  const commitShas = stringSet(evidenceValue.commitShas, `${path}.evidence.commitShas`);
  if (commitShas.length > 1 || commitShas.some((value) => !/^[a-f0-9]{7,64}$/.test(value))) {
    throw new ProposalBundleValidationError(`${path}.evidence.commitShas`, 'invalid commit set');
  }
  const firstSeen = dateTime(evidenceValue.firstSeen, `${path}.evidence.firstSeen`);
  const lastSeen = dateTime(evidenceValue.lastSeen, `${path}.evidence.lastSeen`);
  if (Date.parse(firstSeen) > Date.parse(lastSeen)) {
    throw new ProposalBundleValidationError(
      `${path}.evidence`,
      'firstSeen must not follow lastSeen',
    );
  }
  const minimumScore = probability(evidenceValue.minimumScore, `${path}.evidence.minimumScore`);
  const maximumScore = probability(evidenceValue.maximumScore, `${path}.evidence.maximumScore`);
  if (minimumScore > maximumScore) {
    throw new ProposalBundleValidationError(
      `${path}.evidence`,
      'minimumScore exceeds maximumScore',
    );
  }

  return {
    schemaVersion: HEALING_PROPOSAL_SCHEMA_VERSION,
    proposalId: hash(item.proposalId, `${path}.proposalId`),
    status: 'review-required',
    targetKey: text(item.targetKey, `${path}.targetKey`),
    action: action(item.action, `${path}.action`),
    targetDefinitionHash: hash(item.targetDefinitionHash, `${path}.targetDefinitionHash`),
    currentPrimary: primaryLocator(item.currentPrimary, `${path}.currentPrimary`),
    suggestedPrimary: suggested,
    candidate: {
      role: candidateRole,
      accessibleName: candidateAccessibleName,
      tag,
    },
    evidence: {
      occurrenceCount,
      distinctRunCount,
      ignoredLegacyCount: integer(
        evidenceValue.ignoredLegacyCount,
        `${path}.evidence.ignoredLegacyCount`,
        0,
      ),
      runIds,
      testIds: stringSet(evidenceValue.testIds, `${path}.evidence.testIds`, 1),
      projectNames: stringSet(evidenceValue.projectNames, `${path}.evidence.projectNames`, 1),
      retryIndices: integerSet(evidenceValue.retryIndices, `${path}.evidence.retryIndices`, 1),
      commitShas,
      candidateIds: stringSet(evidenceValue.candidateIds, `${path}.evidence.candidateIds`, 1),
      assessmentEventIds,
      executionEventIds,
      screenshotPaths: safeScreenshotPaths(
        evidenceValue.screenshotPaths,
        `${path}.evidence.screenshotPaths`,
      ),
      firstSeen,
      lastSeen,
      minimumScore,
      maximumScore,
      minimumMargin: probability(evidenceValue.minimumMargin, `${path}.evidence.minimumMargin`),
    },
  };
}

function rejection(value: unknown, path: string): HealingProposalRejection {
  const item = record(value, path);
  onlyKeys(item, ['targetKey', 'action', 'reason', 'occurrenceCount'], path);
  if (
    typeof item.reason !== 'string' ||
    !REJECTION_REASONS.includes(item.reason as HealingProposalRejectionReason)
  ) {
    throw new ProposalBundleValidationError(`${path}.reason`, 'unsupported rejection reason');
  }
  return {
    targetKey: text(item.targetKey, `${path}.targetKey`),
    action: action(item.action, `${path}.action`),
    reason: item.reason as HealingProposalRejectionReason,
    occurrenceCount: integer(item.occurrenceCount, `${path}.occurrenceCount`, 1),
  };
}

export function parseHealingProposalBundle(contents: string): HealingProposalBundle {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new ProposalBundleValidationError('$', 'invalid JSON', error);
  }
  const bundle = record(value, '$');
  onlyKeys(
    bundle,
    ['$schema', 'schemaVersion', 'generatedAt', 'minimumObservations', 'proposals', 'rejections'],
    '$',
  );
  if (
    bundle.$schema !== HEALING_PROPOSAL_SCHEMA_URL ||
    bundle.schemaVersion !== HEALING_PROPOSAL_SCHEMA_VERSION
  ) {
    throw new ProposalBundleValidationError('$', 'unsupported proposal bundle schema');
  }
  const minimumObservations = integer(bundle.minimumObservations, '$.minimumObservations', 2);
  if (!Array.isArray(bundle.proposals) || !Array.isArray(bundle.rejections)) {
    throw new ProposalBundleValidationError('$', 'proposals and rejections must be arrays');
  }
  const proposals = bundle.proposals.map((item, index) =>
    proposal(item, `$.proposals[${index}]`, minimumObservations),
  );
  const rejections = bundle.rejections.map((item, index) =>
    rejection(item, `$.rejections[${index}]`),
  );
  const keys = proposals.map((item) => `${item.targetKey}\0${item.action}`);
  if (new Set(keys).size !== keys.length) {
    throw new ProposalBundleValidationError('$.proposals', 'duplicate target/action proposal');
  }
  return {
    $schema: HEALING_PROPOSAL_SCHEMA_URL,
    schemaVersion: HEALING_PROPOSAL_SCHEMA_VERSION,
    generatedAt: dateTime(bundle.generatedAt, '$.generatedAt'),
    minimumObservations,
    proposals,
    rejections,
  };
}

export async function loadHealingProposalBundle(
  filePath: string | URL,
): Promise<HealingProposalBundle> {
  return parseHealingProposalBundle(await readFile(filePath, 'utf8'));
}

export interface HealingProposalVerificationIssue {
  readonly proposalId: string;
  readonly targetKey: string;
  readonly reason: Exclude<HealingProposalVerification, { readonly valid: true }>['reason'];
}

export type HealingProposalBundleVerification =
  | { readonly valid: true; readonly proposalCount: number }
  | { readonly valid: false; readonly issues: readonly HealingProposalVerificationIssue[] };

export function verifyHealingProposalBundle(
  bundle: HealingProposalBundle,
  registry: TargetRegistry,
): HealingProposalBundleVerification {
  const issues = bundle.proposals.flatMap((item) => {
    const result = verifyHealingProposal(item, registry);
    return result.valid
      ? []
      : [{ proposalId: item.proposalId, targetKey: item.targetKey, reason: result.reason }];
  });
  return issues.length === 0
    ? { valid: true, proposalCount: bundle.proposals.length }
    : { valid: false, issues };
}
