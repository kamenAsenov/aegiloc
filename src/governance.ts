import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import type {
  HealingAuditEvent,
  HealingExecutionAuditEvent,
  HealwrightAuditEvent,
} from './audit.js';
import { canonicalizeAuditEvents } from './evidence.js';
import { GovernanceEvidenceError, GovernancePolicyError } from './errors.js';
import {
  TARGET_ACTIONS,
  resolveExecutionRisk,
  type TargetAction,
  type TargetRegistry,
} from './types.js';

export const GOVERNANCE_POLICY_SCHEMA_VERSION = 1 as const;
export const HEALTH_SUMMARY_SCHEMA_VERSION = 1 as const;

export interface GovernanceBudget {
  readonly maxSuccessfulHeals?: number;
}

export interface GovernanceTargetBudget extends GovernanceBudget {
  readonly actions?: Readonly<Partial<Record<TargetAction, GovernanceBudget>>>;
}

export interface GovernanceLimits {
  readonly maxSuccessfulHealsPerRun?: number;
  readonly maxRejectedAttemptsPerRun?: number;
  readonly targets?: Readonly<Record<string, GovernanceTargetBudget>>;
}

export interface GovernanceBaseline {
  readonly successfulHeals?: number;
  readonly rejectedAttempts?: number;
}

export interface GovernanceWaiver {
  readonly targetKey: string;
  readonly action?: TargetAction;
  readonly reason: string;
  readonly expiresAt: string;
}

export interface GovernancePolicy {
  readonly version: typeof GOVERNANCE_POLICY_SCHEMA_VERSION;
  readonly failOnUnknownTargets?: boolean;
  readonly limits?: GovernanceLimits;
  readonly baseline?: GovernanceBaseline;
  readonly waivers?: readonly GovernanceWaiver[];
}

export type HealthOutcome = 'successful' | 'rejected' | 'protected' | 'failed' | 'observed';
export type GovernanceViolationCode =
  | 'successful-heals-per-run-exceeded'
  | 'rejected-attempts-per-run-exceeded'
  | 'target-successful-heals-exceeded'
  | 'target-action-successful-heals-exceeded'
  | 'successful-heals-baseline-regression'
  | 'rejected-attempts-baseline-regression'
  | 'unknown-target'
  | 'execution-risk-mismatch'
  | 'protected-target-executed'
  | 'expired-waiver';

export interface GovernanceViolation {
  readonly code: GovernanceViolationCode;
  readonly scope: string;
  readonly actual?: number;
  readonly limit?: number;
  readonly message: string;
}

export interface HealthSummaryGroup {
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly projectName: string;
  readonly outcome: HealthOutcome;
  readonly attemptCount: number;
  readonly successfulHeals: number;
  readonly rejectedAttempts: number;
  readonly protectedAttempts: number;
  readonly waivedCount: number;
  readonly policyStatus: 'pass' | 'fail';
  readonly waiverStatus: 'none' | 'active';
}

export interface HealthSummaryWaiver extends GovernanceWaiver {
  readonly status: 'active' | 'expired';
  readonly matchedAttempts: number;
}

export interface HealthSummary {
  readonly schemaVersion: typeof HEALTH_SUMMARY_SCHEMA_VERSION;
  readonly evaluatedAt: string;
  readonly policyConfigured: boolean;
  readonly status: 'pass' | 'fail';
  readonly totals: {
    readonly attempts: number;
    readonly successfulHeals: number;
    readonly rejectedAttempts: number;
    readonly protectedAttempts: number;
    readonly failedAttempts: number;
    readonly observedAttempts: number;
    readonly waivedAttempts: number;
    readonly discardedRetryAttempts: number;
  };
  readonly runIds: readonly string[];
  readonly projects: readonly string[];
  readonly groups: readonly HealthSummaryGroup[];
  readonly waivers: readonly HealthSummaryWaiver[];
  readonly violations: readonly GovernanceViolation[];
}

export interface EvaluateGovernanceOptions {
  readonly evaluatedAt?: string;
}

export interface WriteHealthSummaryOptions {
  readonly jsonPath: string;
  readonly markdownPath: string;
}

interface Attempt {
  readonly assessment: HealingAuditEvent;
  readonly execution?: HealingExecutionAuditEvent;
  readonly runId: string;
  readonly projectName: string;
  readonly retry: number;
  readonly outcome: HealthOutcome;
  readonly waived: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new GovernancePolicyError(`${path}.${unexpected}`, 'unexpected property');
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GovernancePolicyError(path, 'expected a non-empty string');
  }
  if ([...value].some((character) => (character.codePointAt(0) ?? 0) < 0x20)) {
    throw new GovernancePolicyError(path, 'control characters are not allowed');
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new GovernancePolicyError(path, 'expected a non-negative integer');
  }
  return value;
}

function optionalBudget(
  value: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  return value[key] === undefined ? undefined : nonNegativeInteger(value[key], `${path}.${key}`);
}

function utcDateTime(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  const normalized =
    result.endsWith('Z') && !result.includes('.') ? result.replace(/Z$/, '.000Z') : result;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result) ||
    Number.isNaN(Date.parse(result)) ||
    new Date(result).toISOString() !== normalized
  ) {
    throw new GovernancePolicyError(path, 'expected a valid UTC date-time ending in Z');
  }
  return result;
}

function targetIdentity(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  if (result.includes('*') || result.includes('?')) {
    throw new GovernancePolicyError(path, 'wildcards are not allowed');
  }
  return result;
}

function parseAction(value: unknown, path: string): TargetAction {
  if (typeof value !== 'string' || !TARGET_ACTIONS.includes(value as TargetAction)) {
    throw new GovernancePolicyError(path, 'unsupported target action');
  }
  return value as TargetAction;
}

function parseTargetBudget(value: unknown, path: string): GovernanceTargetBudget {
  if (!isRecord(value)) throw new GovernancePolicyError(path, 'expected an object');
  onlyKeys(value, ['maxSuccessfulHeals', 'actions'], path);
  const maxSuccessfulHeals = optionalBudget(value, 'maxSuccessfulHeals', path);
  let actions: Partial<Record<TargetAction, GovernanceBudget>> | undefined;
  if (value.actions !== undefined) {
    if (!isRecord(value.actions))
      throw new GovernancePolicyError(`${path}.actions`, 'expected an object');
    actions = {};
    for (const [actionName, rawBudget] of Object.entries(value.actions)) {
      const action = parseAction(actionName, `${path}.actions key`);
      if (!isRecord(rawBudget)) {
        throw new GovernancePolicyError(`${path}.actions.${action}`, 'expected an object');
      }
      onlyKeys(rawBudget, ['maxSuccessfulHeals'], `${path}.actions.${action}`);
      if (rawBudget.maxSuccessfulHeals === undefined) {
        throw new GovernancePolicyError(
          `${path}.actions.${action}`,
          'maxSuccessfulHeals is required',
        );
      }
      actions[action] = {
        maxSuccessfulHeals: nonNegativeInteger(
          rawBudget.maxSuccessfulHeals,
          `${path}.actions.${action}.maxSuccessfulHeals`,
        ),
      };
    }
    if (Object.keys(actions).length === 0) {
      throw new GovernancePolicyError(`${path}.actions`, 'expected at least one action budget');
    }
  }
  if (maxSuccessfulHeals === undefined && actions === undefined) {
    throw new GovernancePolicyError(path, 'expected at least one target budget');
  }
  return {
    ...(maxSuccessfulHeals === undefined ? {} : { maxSuccessfulHeals }),
    ...(actions === undefined ? {} : { actions }),
  };
}

export function parseGovernancePolicy(value: unknown): GovernancePolicy {
  if (!isRecord(value)) throw new GovernancePolicyError('$', 'expected an object');
  onlyKeys(
    value,
    ['$schema', 'version', 'failOnUnknownTargets', 'limits', 'baseline', 'waivers'],
    '$',
  );
  if (value.$schema !== undefined) nonEmptyString(value.$schema, '$.$schema');
  if (value.version !== GOVERNANCE_POLICY_SCHEMA_VERSION) {
    throw new GovernancePolicyError('$.version', 'only policy version 1 is supported');
  }
  if (value.failOnUnknownTargets !== undefined && typeof value.failOnUnknownTargets !== 'boolean') {
    throw new GovernancePolicyError('$.failOnUnknownTargets', 'expected a boolean');
  }

  let limits: GovernanceLimits | undefined;
  if (value.limits !== undefined) {
    if (!isRecord(value.limits)) throw new GovernancePolicyError('$.limits', 'expected an object');
    onlyKeys(
      value.limits,
      ['maxSuccessfulHealsPerRun', 'maxRejectedAttemptsPerRun', 'targets'],
      '$.limits',
    );
    const maxSuccessfulHealsPerRun = optionalBudget(
      value.limits,
      'maxSuccessfulHealsPerRun',
      '$.limits',
    );
    const maxRejectedAttemptsPerRun = optionalBudget(
      value.limits,
      'maxRejectedAttemptsPerRun',
      '$.limits',
    );
    let targets: Record<string, GovernanceTargetBudget> | undefined;
    if (value.limits.targets !== undefined) {
      if (!isRecord(value.limits.targets)) {
        throw new GovernancePolicyError('$.limits.targets', 'expected an object');
      }
      const targetEntries = Object.entries(value.limits.targets)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([targetKey, budget]): readonly [string, GovernanceTargetBudget] => {
          targetIdentity(targetKey, '$.limits.targets key');
          return [targetKey, parseTargetBudget(budget, `$.limits.targets.${targetKey}`)];
        });
      if (targetEntries.length === 0) {
        throw new GovernancePolicyError('$.limits.targets', 'expected at least one target budget');
      }
      targets = Object.fromEntries(targetEntries);
    }
    if (
      maxSuccessfulHealsPerRun === undefined &&
      maxRejectedAttemptsPerRun === undefined &&
      targets === undefined
    ) {
      throw new GovernancePolicyError('$.limits', 'expected at least one limit');
    }
    limits = {
      ...(maxSuccessfulHealsPerRun === undefined ? {} : { maxSuccessfulHealsPerRun }),
      ...(maxRejectedAttemptsPerRun === undefined ? {} : { maxRejectedAttemptsPerRun }),
      ...(targets === undefined ? {} : { targets }),
    };
  }

  let baseline: GovernanceBaseline | undefined;
  if (value.baseline !== undefined) {
    if (!isRecord(value.baseline))
      throw new GovernancePolicyError('$.baseline', 'expected an object');
    onlyKeys(value.baseline, ['successfulHeals', 'rejectedAttempts'], '$.baseline');
    const successfulHeals = optionalBudget(value.baseline, 'successfulHeals', '$.baseline');
    const rejectedAttempts = optionalBudget(value.baseline, 'rejectedAttempts', '$.baseline');
    if (successfulHeals === undefined && rejectedAttempts === undefined) {
      throw new GovernancePolicyError('$.baseline', 'expected at least one baseline');
    }
    baseline = {
      ...(successfulHeals === undefined ? {} : { successfulHeals }),
      ...(rejectedAttempts === undefined ? {} : { rejectedAttempts }),
    };
  }

  let waivers: GovernanceWaiver[] | undefined;
  if (value.waivers !== undefined) {
    if (!Array.isArray(value.waivers))
      throw new GovernancePolicyError('$.waivers', 'expected an array');
    waivers = value.waivers.map((rawWaiver, index) => {
      const path = `$.waivers[${index}]`;
      if (!isRecord(rawWaiver)) throw new GovernancePolicyError(path, 'expected an object');
      onlyKeys(rawWaiver, ['targetKey', 'action', 'reason', 'expiresAt'], path);
      const action =
        rawWaiver.action === undefined
          ? undefined
          : parseAction(rawWaiver.action, `${path}.action`);
      return {
        targetKey: targetIdentity(rawWaiver.targetKey, `${path}.targetKey`),
        ...(action === undefined ? {} : { action }),
        reason: nonEmptyString(rawWaiver.reason, `${path}.reason`),
        expiresAt: utcDateTime(rawWaiver.expiresAt, `${path}.expiresAt`),
      };
    });
    const scopes = new Set<string>();
    for (const waiver of waivers) {
      const scope = `${waiver.targetKey}\u0000${waiver.action ?? '*'}`;
      if (scopes.has(scope)) {
        throw new GovernancePolicyError(
          '$.waivers',
          `duplicate waiver scope for "${waiver.targetKey}"`,
        );
      }
      scopes.add(scope);
      if (waiver.action !== undefined && scopes.has(`${waiver.targetKey}\u0000*`)) {
        throw new GovernancePolicyError(
          '$.waivers',
          `conflicting waiver scopes for "${waiver.targetKey}"`,
        );
      }
      if (
        waiver.action === undefined &&
        waivers.some(
          (candidate) => candidate !== waiver && candidate.targetKey === waiver.targetKey,
        )
      ) {
        throw new GovernancePolicyError(
          '$.waivers',
          `conflicting waiver scopes for "${waiver.targetKey}"`,
        );
      }
    }
  }

  return {
    version: GOVERNANCE_POLICY_SCHEMA_VERSION,
    ...(value.failOnUnknownTargets === undefined
      ? {}
      : { failOnUnknownTargets: value.failOnUnknownTargets }),
    ...(limits === undefined ? {} : { limits }),
    ...(baseline === undefined ? {} : { baseline }),
    ...(waivers === undefined ? {} : { waivers }),
  };
}

export async function loadGovernancePolicy(filePath: string | URL): Promise<GovernancePolicy> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new GovernancePolicyError('$', 'policy is not valid JSON', error);
  }
  return parseGovernancePolicy(value);
}

function ensureEvaluatedAt(value: string): string {
  const normalized =
    value.endsWith('Z') && !value.includes('.') ? value.replace(/Z$/, '.000Z') : value;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== normalized
  ) {
    throw new TypeError('evaluatedAt must be a valid UTC date-time ending in Z');
  }
  return value;
}

function sameProvenance(
  assessment: HealingAuditEvent,
  execution: HealingExecutionAuditEvent,
): boolean {
  return JSON.stringify(assessment.provenance) === JSON.stringify(execution.provenance);
}

function attemptOutcome(
  assessment: HealingAuditEvent,
  execution: HealingExecutionAuditEvent | undefined,
  registry: TargetRegistry,
): HealthOutcome {
  const definition = registry.targets[assessment.targetKey];
  const evidenceRisk = assessment.executionPolicy?.risk ?? 'automatic';
  const registryRisk =
    definition === undefined ? 'automatic' : resolveExecutionRisk(definition.policy);
  const risk =
    evidenceRisk === 'proposal-only' || registryRisk === 'proposal-only'
      ? 'proposal-only'
      : 'automatic';
  if (risk === 'proposal-only') return 'protected';
  if (execution?.status === 'succeeded') return 'successful';
  if (execution?.status === 'failed') return 'failed';
  if (execution?.status === 'rejected') return 'rejected';
  if (assessment.modeDecision === 'observed') return 'observed';
  return 'rejected';
}

function validatePolicyReferences(policy: GovernancePolicy, registry: TargetRegistry): void {
  const references: readonly (readonly [string, TargetAction | undefined, string])[] = [
    ...Object.entries(policy.limits?.targets ?? {}).flatMap(([targetKey, budget]) => [
      [targetKey, undefined, `$.limits.targets.${targetKey}`] as const,
      ...Object.keys(budget.actions ?? {}).map(
        (action) =>
          [
            targetKey,
            action as TargetAction,
            `$.limits.targets.${targetKey}.actions.${action}`,
          ] as const,
      ),
    ]),
    ...(policy.waivers ?? []).map(
      (waiver, index) => [waiver.targetKey, waiver.action, `$.waivers[${index}]`] as const,
    ),
  ];
  for (const [targetKey, action, path] of references) {
    const target = registry.targets[targetKey];
    if (target === undefined) throw new GovernancePolicyError(path, 'references an unknown target');
    if (action !== undefined && !target.policy.allowedActions.includes(action)) {
      throw new GovernancePolicyError(path, `action "${action}" is not allowed for the target`);
    }
  }
}

function buildAttempts(
  inputEvents: readonly HealwrightAuditEvent[],
  registry: TargetRegistry,
): {
  readonly attempts: readonly Omit<Attempt, 'waived'>[];
  readonly discardedRetryAttempts: number;
} {
  let events: readonly HealwrightAuditEvent[];
  try {
    events = canonicalizeAuditEvents(inputEvents);
  } catch (error) {
    throw new GovernanceEvidenceError('event IDs conflict', error);
  }
  const assessments = events.filter(
    (event): event is HealingAuditEvent => event.eventType === 'locator-drift-assessed',
  );
  for (const assessment of assessments) {
    if (
      assessment.targetKey.length > 300 ||
      [...assessment.targetKey].some((character) => (character.codePointAt(0) ?? 0) < 0x20)
    ) {
      throw new GovernanceEvidenceError('target identity is unsafe or exceeds 300 characters');
    }
  }
  const assessmentIds = new Set(assessments.map((event) => event.eventId));
  const assessmentsById = new Map(assessments.map((event) => [event.eventId, event]));
  const executionsByParent = new Map<string, HealingExecutionAuditEvent>();
  for (const event of events) {
    if (event.eventType !== 'locator-heal-execution') continue;
    if (!assessmentIds.has(event.parentEventId)) {
      throw new GovernanceEvidenceError(`execution "${event.eventId}" has no assessment parent`);
    }
    if (executionsByParent.has(event.parentEventId)) {
      throw new GovernanceEvidenceError(
        `assessment "${event.parentEventId}" has multiple executions`,
      );
    }
    const assessment = assessmentsById.get(event.parentEventId);
    if (
      assessment === undefined ||
      assessment.targetKey !== event.targetKey ||
      assessment.action !== event.action ||
      assessment.operationIndex !== event.operationIndex ||
      !sameProvenance(assessment, event) ||
      (assessment.executionPolicy !== undefined &&
        event.executionRisk !== undefined &&
        assessment.executionPolicy.risk !== event.executionRisk)
    ) {
      throw new GovernanceEvidenceError(
        `execution "${event.eventId}" disagrees with its assessment`,
      );
    }
    executionsByParent.set(event.parentEventId, event);
  }

  const all = assessments.map((assessment) => {
    const provenance = assessment.provenance;
    const execution = executionsByParent.get(assessment.eventId);
    return {
      assessment,
      ...(execution === undefined ? {} : { execution }),
      runId: provenance?.runId ?? 'legacy',
      projectName: provenance?.projectName ?? 'legacy',
      retry: provenance?.retry ?? 0,
      outcome: attemptOutcome(assessment, execution, registry),
    };
  });

  const retryGroups = new Map<string, typeof all>();
  for (const attempt of all) {
    const provenance = attempt.assessment.provenance;
    const key =
      provenance === undefined
        ? `legacy\u0000${attempt.assessment.eventId}`
        : [
            provenance.runId,
            provenance.projectName,
            provenance.testId,
            provenance.commitSha ?? 'no-commit',
            attempt.assessment.targetKey,
            attempt.assessment.action,
            String(attempt.assessment.operationIndex ?? 0),
          ].join('\u0000');
    const group = retryGroups.get(key) ?? [];
    group.push(attempt);
    retryGroups.set(key, group);
  }
  const attempts: typeof all = [];
  let discardedRetryAttempts = 0;
  for (const group of retryGroups.values()) {
    const highestRetry = Math.max(...group.map((attempt) => attempt.retry));
    const retained = group.filter((attempt) => attempt.retry === highestRetry);
    attempts.push(...retained);
    discardedRetryAttempts += group.length - retained.length;
  }
  attempts.sort((left, right) => left.assessment.eventId.localeCompare(right.assessment.eventId));
  return { attempts, discardedRetryAttempts };
}

function waiverFor(
  attempt: Omit<Attempt, 'waived'>,
  activeWaivers: readonly GovernanceWaiver[],
): GovernanceWaiver | undefined {
  return activeWaivers.find(
    (waiver) =>
      waiver.targetKey === attempt.assessment.targetKey &&
      (waiver.action === undefined || waiver.action === attempt.assessment.action),
  );
}

function count(
  attempts: readonly Attempt[],
  predicate: (attempt: Attempt) => boolean,
  unwaivedOnly = false,
): number {
  return attempts.filter((attempt) => predicate(attempt) && (!unwaivedOnly || !attempt.waived))
    .length;
}

function addLimitViolation(
  violations: GovernanceViolation[],
  code: GovernanceViolationCode,
  scope: string,
  actual: number,
  limit: number,
): void {
  if (actual > limit) {
    violations.push({
      code,
      scope,
      actual,
      limit,
      message: `${scope}: ${actual} exceeds ${limit}`,
    });
  }
}

export function evaluateGovernance(
  events: readonly HealwrightAuditEvent[],
  registry: TargetRegistry,
  policy?: GovernancePolicy,
  { evaluatedAt = new Date().toISOString() }: EvaluateGovernanceOptions = {},
): HealthSummary {
  evaluatedAt = ensureEvaluatedAt(evaluatedAt);
  if (policy !== undefined) validatePolicyReferences(policy, registry);
  const { attempts: rawAttempts, discardedRetryAttempts } = buildAttempts(events, registry);
  const waivers = policy?.waivers ?? [];
  const activeWaivers = waivers.filter(
    (waiver) => Date.parse(waiver.expiresAt) > Date.parse(evaluatedAt),
  );
  const attempts: Attempt[] = rawAttempts.map((attempt) => ({
    ...attempt,
    waived: waiverFor(attempt, activeWaivers) !== undefined,
  }));
  const violations: GovernanceViolation[] = [];

  for (const waiver of waivers) {
    if (Date.parse(waiver.expiresAt) <= Date.parse(evaluatedAt)) {
      violations.push({
        code: 'expired-waiver',
        scope: `${waiver.targetKey}${waiver.action === undefined ? '' : `/${waiver.action}`}`,
        message: `Waiver expired at ${waiver.expiresAt}`,
      });
    }
  }
  for (const attempt of attempts) {
    const definition = registry.targets[attempt.assessment.targetKey];
    if (definition === undefined && policy?.failOnUnknownTargets === true) {
      violations.push({
        code: 'unknown-target',
        scope: attempt.assessment.targetKey,
        message: `Evidence references unknown target "${attempt.assessment.targetKey}"`,
      });
    }
    const evidenceRisk = attempt.assessment.executionPolicy?.risk;
    const registryRisk =
      definition === undefined ? undefined : resolveExecutionRisk(definition.policy);
    if (evidenceRisk !== undefined && registryRisk !== undefined && evidenceRisk !== registryRisk) {
      violations.push({
        code: 'execution-risk-mismatch',
        scope: `${attempt.assessment.targetKey}/${attempt.assessment.action}`,
        message: 'Audit execution risk does not match the current target registry',
      });
    }
    const risk =
      evidenceRisk === 'proposal-only' || registryRisk === 'proposal-only'
        ? 'proposal-only'
        : 'automatic';
    if (risk === 'proposal-only' && attempt.execution !== undefined) {
      violations.push({
        code: 'protected-target-executed',
        scope: `${attempt.assessment.targetKey}/${attempt.assessment.action}`,
        message: 'Protected target has an execution event; waivers cannot bypass execution risk',
      });
    }
  }

  const successful = (attempt: Attempt): boolean => attempt.outcome === 'successful';
  const rejected = (attempt: Attempt): boolean =>
    attempt.outcome === 'rejected' || attempt.outcome === 'protected';
  const runIds = [...new Set(attempts.map((attempt) => attempt.runId))].sort();
  const limits = policy?.limits;
  for (const runId of runIds) {
    const runAttempts = attempts.filter((attempt) => attempt.runId === runId);
    if (limits?.maxSuccessfulHealsPerRun !== undefined) {
      addLimitViolation(
        violations,
        'successful-heals-per-run-exceeded',
        `run ${runId} successful heals`,
        count(runAttempts, successful, true),
        limits.maxSuccessfulHealsPerRun,
      );
    }
    if (limits?.maxRejectedAttemptsPerRun !== undefined) {
      addLimitViolation(
        violations,
        'rejected-attempts-per-run-exceeded',
        `run ${runId} rejected attempts`,
        count(runAttempts, rejected, true),
        limits.maxRejectedAttemptsPerRun,
      );
    }
  }
  for (const [targetKey, targetBudget] of Object.entries(limits?.targets ?? {})) {
    const targetAttempts = attempts.filter((attempt) => attempt.assessment.targetKey === targetKey);
    if (targetBudget.maxSuccessfulHeals !== undefined) {
      addLimitViolation(
        violations,
        'target-successful-heals-exceeded',
        `target ${targetKey} successful heals`,
        count(targetAttempts, successful, true),
        targetBudget.maxSuccessfulHeals,
      );
    }
    for (const [action, actionBudget] of Object.entries(targetBudget.actions ?? {})) {
      if (actionBudget.maxSuccessfulHeals === undefined) continue;
      addLimitViolation(
        violations,
        'target-action-successful-heals-exceeded',
        `target ${targetKey}/${action} successful heals`,
        count(
          targetAttempts,
          (attempt) => successful(attempt) && attempt.assessment.action === action,
          true,
        ),
        actionBudget.maxSuccessfulHeals,
      );
    }
  }
  const successfulCount = count(attempts, successful, true);
  const rejectedCount = count(attempts, rejected, true);
  if (policy?.baseline?.successfulHeals !== undefined) {
    addLimitViolation(
      violations,
      'successful-heals-baseline-regression',
      'successful heal baseline',
      successfulCount,
      policy.baseline.successfulHeals,
    );
  }
  if (policy?.baseline?.rejectedAttempts !== undefined) {
    addLimitViolation(
      violations,
      'rejected-attempts-baseline-regression',
      'rejected attempt baseline',
      rejectedCount,
      policy.baseline.rejectedAttempts,
    );
  }

  violations.sort((left, right) =>
    `${left.code}\u0000${left.scope}`.localeCompare(`${right.code}\u0000${right.scope}`),
  );
  const groupMap = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const key = [
      attempt.assessment.targetKey,
      attempt.assessment.action,
      attempt.projectName,
      attempt.outcome,
    ].join('\u0000');
    const group = groupMap.get(key) ?? [];
    group.push(attempt);
    groupMap.set(key, group);
  }
  const globalFailure = violations.some((violation) =>
    [
      'successful-heals-per-run-exceeded',
      'rejected-attempts-per-run-exceeded',
      'successful-heals-baseline-regression',
      'rejected-attempts-baseline-regression',
    ].includes(violation.code),
  );
  const failedScopes = new Set(violations.map((violation) => violation.scope));
  const groups = [...groupMap.values()]
    .map((group): HealthSummaryGroup => {
      const first = group[0];
      if (first === undefined) throw new GovernanceEvidenceError('empty summary group');
      const scope = `${first.assessment.targetKey}/${first.assessment.action}`;
      return {
        targetKey: first.assessment.targetKey,
        action: first.assessment.action,
        projectName: first.projectName,
        outcome: first.outcome,
        attemptCount: group.length,
        successfulHeals: first.outcome === 'successful' ? group.length : 0,
        rejectedAttempts: first.outcome === 'rejected' ? group.length : 0,
        protectedAttempts: first.outcome === 'protected' ? group.length : 0,
        waivedCount: group.filter((attempt) => attempt.waived).length,
        policyStatus:
          globalFailure ||
          [...failedScopes].some(
            (failedScope) =>
              failedScope === first.assessment.targetKey ||
              failedScope === scope ||
              failedScope.startsWith(`target ${first.assessment.targetKey} `) ||
              failedScope.startsWith(`target ${first.assessment.targetKey}/`),
          )
            ? 'fail'
            : 'pass',
        waiverStatus: group.some((attempt) => attempt.waived) ? 'active' : 'none',
      };
    })
    .sort((left, right) =>
      [left.targetKey, left.action, left.projectName, left.outcome]
        .join('\u0000')
        .localeCompare(
          [right.targetKey, right.action, right.projectName, right.outcome].join('\u0000'),
        ),
    );

  return {
    schemaVersion: HEALTH_SUMMARY_SCHEMA_VERSION,
    evaluatedAt,
    policyConfigured: policy !== undefined,
    status: violations.length === 0 ? 'pass' : 'fail',
    totals: {
      attempts: attempts.length,
      successfulHeals: count(attempts, successful),
      rejectedAttempts: count(attempts, rejected),
      protectedAttempts: count(attempts, (attempt) => attempt.outcome === 'protected'),
      failedAttempts: count(attempts, (attempt) => attempt.outcome === 'failed'),
      observedAttempts: count(attempts, (attempt) => attempt.outcome === 'observed'),
      waivedAttempts: count(attempts, (attempt) => attempt.waived),
      discardedRetryAttempts,
    },
    runIds,
    projects: [...new Set(attempts.map((attempt) => attempt.projectName))].sort(),
    groups,
    waivers: waivers
      .map((waiver): HealthSummaryWaiver => ({
        ...waiver,
        status: Date.parse(waiver.expiresAt) > Date.parse(evaluatedAt) ? 'active' : 'expired',
        matchedAttempts: attempts.filter(
          (attempt) =>
            attempt.assessment.targetKey === waiver.targetKey &&
            (waiver.action === undefined || attempt.assessment.action === waiver.action),
        ).length,
      }))
      .sort((left, right) =>
        `${left.targetKey}\u0000${left.action ?? ''}`.localeCompare(
          `${right.targetKey}\u0000${right.action ?? ''}`,
        ),
      ),
    violations,
  };
}

function markdown(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('`', '\\`')
    .replace(/[\r\n]+/g, ' ');
}

export function renderHealthSummary(summary: HealthSummary): string {
  const lines = [
    '# Healwright health summary',
    '',
    `**Status:** ${summary.status.toUpperCase()} · **Evaluated:** ${summary.evaluatedAt}`,
    '',
    `Attempts: ${summary.totals.attempts} · successful: ${summary.totals.successfulHeals} · rejected: ${summary.totals.rejectedAttempts} · protected: ${summary.totals.protectedAttempts} · waived: ${summary.totals.waivedAttempts}`,
    '',
    '## Target health',
    '',
    '| Target | Action | Project | Outcome | Attempts | Waived | Policy |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
    ...summary.groups.map(
      (group) =>
        `| ${markdown(group.targetKey)} | ${group.action} | ${markdown(group.projectName)} | ${group.outcome} | ${group.attemptCount} | ${group.waivedCount} | ${group.policyStatus} |`,
    ),
    '',
    '## Waivers',
    '',
    ...(summary.waivers.length === 0
      ? ['None.']
      : [
          '| Target | Action | Expires | Status | Matches | Reason |',
          '| --- | --- | --- | --- | ---: | --- |',
          ...summary.waivers.map(
            (waiver) =>
              `| ${markdown(waiver.targetKey)} | ${waiver.action ?? 'all target actions'} | ${waiver.expiresAt} | ${waiver.status} | ${waiver.matchedAttempts} | ${markdown(waiver.reason)} |`,
          ),
        ]),
    '',
    '## Policy findings',
    '',
    ...(summary.violations.length === 0
      ? ['No policy violations.']
      : summary.violations.map(
          (violation) =>
            `- **${violation.code}** (${markdown(violation.scope)}): ${markdown(violation.message)}`,
        )),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function writeHealthSummary(
  summary: HealthSummary,
  options: WriteHealthSummaryOptions,
): Promise<void> {
  if (resolve(options.jsonPath) === resolve(options.markdownPath)) {
    throw new TypeError('jsonPath and markdownPath must be different files');
  }
  await atomicWrite(options.jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  await atomicWrite(options.markdownPath, renderHealthSummary(summary));
}
