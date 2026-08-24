import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { CandidateSnapshot } from './candidates.js';
import { ProposalHistoryError } from './errors.js';
import {
  createAuditProvenance,
  parseAuditProvenance,
  type AuditProvenance,
  type AuditProvenanceInput,
} from './audit.js';
import { parseTargetRegistry, SUPPORTED_ARIA_ROLES } from './registry.js';
import {
  TARGET_ACTIONS,
  type PrimaryLocatorDefinition,
  type TargetAction,
  type TargetDefinition,
  type TargetFingerprint,
  type TargetRegistry,
} from './types.js';

export const FINGERPRINT_OBSERVATION_SCHEMA_VERSION = 1 as const;
export const FINGERPRINT_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const FINGERPRINT_PROPOSAL_SCHEMA_URL =
  'https://github.com/kamenAsenov/aegiloc/registry/fingerprint-proposals.schema.json';
export const DEFAULT_FINGERPRINT_PROPOSAL_MINIMUM_OBSERVATIONS = 3;

export interface PrimaryFingerprintObservation {
  readonly schemaVersion: typeof FINGERPRINT_OBSERVATION_SCHEMA_VERSION;
  readonly eventType: 'primary-fingerprint-observed';
  readonly eventId: string;
  readonly timestamp: string;
  readonly provenance?: AuditProvenance;
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly primaryLocator: PrimaryLocatorDefinition;
  readonly candidateId: string;
  readonly fingerprint: TargetFingerprint;
}

export interface CreatePrimaryFingerprintObservationOptions {
  readonly eventId?: string;
  readonly timestamp?: string;
  readonly provenance?: AuditProvenanceInput;
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly primaryLocator: PrimaryLocatorDefinition;
  readonly candidate: CandidateSnapshot;
}

export interface FingerprintObservationSink {
  write(observation: PrimaryFingerprintObservation): Promise<void>;
}

export class NoopFingerprintObservationSink implements FingerprintObservationSink {
  public write(): Promise<void> {
    return Promise.resolve();
  }
}

export class InMemoryFingerprintObservationSink implements FingerprintObservationSink {
  readonly #observations: PrimaryFingerprintObservation[] = [];

  public get observations(): readonly PrimaryFingerprintObservation[] {
    return this.#observations;
  }

  public write(observation: PrimaryFingerprintObservation): Promise<void> {
    this.#observations.push(observation);
    return Promise.resolve();
  }
}

export class JsonlFingerprintObservationSink implements FingerprintObservationSink {
  public constructor(private readonly filePath: string) {}

  public async write(observation: PrimaryFingerprintObservation): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(observation)}\n`, 'utf8');
  }
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

export function fingerprintFromCandidate(candidate: CandidateSnapshot): TargetFingerprint {
  const stableAttributes = Object.fromEntries(
    Object.entries(candidate.stableAttributes).filter(
      ([name, value]) => name.trim() !== '' && value.trim() !== '',
    ),
  );
  const accessibleRole =
    candidate.role !== undefined &&
    SUPPORTED_ARIA_ROLES.includes(candidate.role as (typeof SUPPORTED_ARIA_ROLES)[number])
      ? (candidate.role as (typeof SUPPORTED_ARIA_ROLES)[number])
      : undefined;
  return {
    ...(accessibleRole === undefined ? {} : { accessibleRole }),
    ...(nonEmpty(candidate.accessibleName) ? { accessibleName: candidate.accessibleName } : {}),
    ...(Object.keys(stableAttributes).length === 0 ? {} : { stableAttributes }),
    ...(nonEmpty(candidate.visibleText) ? { visibleText: candidate.visibleText } : {}),
    ...(nonEmpty(candidate.tag) ? { tag: candidate.tag } : {}),
    ...(candidate.ancestorText.length === 0 ? {} : { ancestorText: candidate.ancestorText }),
    ...(candidate.neighborText.length === 0 ? {} : { neighborText: candidate.neighborText }),
    ...(candidate.geometry === undefined ? {} : { geometry: candidate.geometry }),
  };
}

export function createPrimaryFingerprintObservation({
  eventId = randomUUID(),
  timestamp = new Date().toISOString(),
  provenance,
  targetKey,
  action,
  primaryLocator,
  candidate,
}: CreatePrimaryFingerprintObservationOptions): PrimaryFingerprintObservation {
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError('Fingerprint observation timestamp must be a valid date-time');
  }
  if (targetKey.trim() === '') {
    throw new TypeError('Fingerprint observation targetKey must be non-empty');
  }
  return {
    schemaVersion: FINGERPRINT_OBSERVATION_SCHEMA_VERSION,
    eventType: 'primary-fingerprint-observed',
    eventId,
    timestamp,
    ...(provenance === undefined ? {} : { provenance: createAuditProvenance(provenance) }),
    targetKey,
    action,
    primaryLocator,
    candidateId: candidate.id,
    fingerprint: fingerprintFromCandidate(candidate),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatedDefinition(
  primary: unknown,
  fingerprint: unknown,
  action: unknown,
  line: number,
): TargetDefinition {
  if (typeof action !== 'string' || !TARGET_ACTIONS.includes(action as TargetAction)) {
    throw new ProposalHistoryError(line, 'fingerprint observation action is unsupported');
  }
  try {
    const registry = parseTargetRegistry({
      version: 1,
      defaults: { confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
      targets: {
        observation: {
          description: 'Fingerprint observation',
          primary,
          fingerprint,
          policy: {
            allowedActions: [action],
            healing: { enabled: true, confidenceThreshold: 0.9, minimumScoreMargin: 0.15 },
          },
        },
      },
    });
    const definition = registry.targets.observation;
    if (definition === undefined) throw new Error('validated target missing');
    return definition;
  } catch (error) {
    throw new ProposalHistoryError(
      line,
      'fingerprint observation locator or fingerprint is malformed',
      error,
    );
  }
}

export function parseFingerprintObservationHistory(
  contents: string,
): readonly PrimaryFingerprintObservation[] {
  const observations: PrimaryFingerprintObservation[] = [];
  const eventIds = new Set<string>();
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (rawLine.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(rawLine) as unknown;
    } catch (error) {
      throw new ProposalHistoryError(lineNumber, 'invalid fingerprint observation JSON', error);
    }
    if (!isRecord(value)) {
      throw new ProposalHistoryError(lineNumber, 'fingerprint observation must be an object');
    }
    if (
      value.schemaVersion !== FINGERPRINT_OBSERVATION_SCHEMA_VERSION ||
      value.eventType !== 'primary-fingerprint-observed' ||
      typeof value.eventId !== 'string' ||
      value.eventId.trim() === '' ||
      typeof value.timestamp !== 'string' ||
      !Number.isFinite(Date.parse(value.timestamp)) ||
      typeof value.targetKey !== 'string' ||
      value.targetKey.trim() === '' ||
      typeof value.candidateId !== 'string' ||
      value.candidateId.trim() === ''
    ) {
      throw new ProposalHistoryError(lineNumber, 'fingerprint observation metadata is malformed');
    }
    if (eventIds.has(value.eventId)) {
      throw new ProposalHistoryError(lineNumber, `duplicate eventId "${value.eventId}"`);
    }
    eventIds.add(value.eventId);
    const definition = validatedDefinition(
      value.primaryLocator,
      value.fingerprint,
      value.action,
      lineNumber,
    );
    let provenance: AuditProvenance | undefined;
    if (value.provenance !== undefined) {
      try {
        provenance = parseAuditProvenance(value.provenance);
      } catch (error) {
        throw new ProposalHistoryError(
          lineNumber,
          'fingerprint observation provenance is malformed',
          error,
        );
      }
    }
    observations.push({
      schemaVersion: FINGERPRINT_OBSERVATION_SCHEMA_VERSION,
      eventType: 'primary-fingerprint-observed',
      eventId: value.eventId,
      timestamp: value.timestamp,
      ...(provenance === undefined ? {} : { provenance }),
      targetKey: value.targetKey,
      action: value.action as TargetAction,
      primaryLocator: definition.primary,
      candidateId: value.candidateId,
      fingerprint: definition.fingerprint,
    });
  }
  return observations;
}

export async function loadFingerprintObservationHistory(
  filePath: string | URL,
): Promise<readonly PrimaryFingerprintObservation[]> {
  return parseFingerprintObservationHistory(await readFile(filePath, 'utf8'));
}

export type FingerprintProposalRejectionReason =
  | 'unknown-target'
  | 'stale-primary'
  | 'action-not-allowed'
  | 'missing-provenance'
  | 'mixed-commits'
  | 'conflicting-fingerprints'
  | 'insufficient-independent-runs'
  | 'already-current';

export interface FingerprintReviewProposal {
  readonly schemaVersion: typeof FINGERPRINT_PROPOSAL_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly status: 'review-required';
  readonly targetKey: string;
  readonly currentFingerprint: TargetFingerprint;
  readonly suggestedFingerprint: TargetFingerprint;
  readonly registryPatch: readonly [
    { readonly op: 'test'; readonly path: string; readonly value: TargetFingerprint },
    { readonly op: 'replace'; readonly path: string; readonly value: TargetFingerprint },
  ];
  readonly evidence: {
    readonly occurrenceCount: number;
    readonly distinctRunCount: number;
    readonly runIds: readonly string[];
    readonly observationEventIds: readonly string[];
    readonly firstSeen: string;
    readonly lastSeen: string;
    readonly commitSha?: string;
  };
}

export interface FingerprintProposalBundle {
  readonly $schema: typeof FINGERPRINT_PROPOSAL_SCHEMA_URL;
  readonly schemaVersion: typeof FINGERPRINT_PROPOSAL_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly minimumObservations: number;
  readonly proposals: readonly FingerprintReviewProposal[];
  readonly rejections: readonly {
    readonly targetKey: string;
    readonly reason: FingerprintProposalRejectionReason;
    readonly occurrenceCount: number;
  }[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
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

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function fingerprintPath(targetKey: string): string {
  return `/targets/${targetKey.replace(/~/g, '~0').replace(/\//g, '~1')}/fingerprint`;
}

export function generateFingerprintProposals(
  observations: readonly PrimaryFingerprintObservation[],
  registry: TargetRegistry,
  {
    minimumObservations = DEFAULT_FINGERPRINT_PROPOSAL_MINIMUM_OBSERVATIONS,
    generatedAt = new Date().toISOString(),
  }: { readonly minimumObservations?: number; readonly generatedAt?: string } = {},
): FingerprintProposalBundle {
  if (!Number.isInteger(minimumObservations) || minimumObservations < 2) {
    throw new TypeError('minimumObservations must be an integer greater than or equal to 2');
  }
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new TypeError('generatedAt must be a valid date-time');
  }
  const groups = new Map<string, PrimaryFingerprintObservation[]>();
  for (const observation of observations) {
    const group = groups.get(observation.targetKey) ?? [];
    group.push(observation);
    groups.set(observation.targetKey, group);
  }
  const proposals: FingerprintReviewProposal[] = [];
  const rejections: FingerprintProposalBundle['rejections'][number][] = [];

  for (const [targetKey, group] of [...groups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const reject = (reason: FingerprintProposalRejectionReason): void => {
      rejections.push({ targetKey, reason, occurrenceCount: group.length });
    };
    const definition = registry.targets[targetKey];
    if (definition === undefined) {
      reject('unknown-target');
      continue;
    }
    if (
      group.some(
        (observation) =>
          canonicalJson(observation.primaryLocator) !== canonicalJson(definition.primary),
      )
    ) {
      reject('stale-primary');
      continue;
    }
    if (
      group.some((observation) => !definition.policy.allowedActions.includes(observation.action))
    ) {
      reject('action-not-allowed');
      continue;
    }
    if (group.some((observation) => observation.provenance === undefined)) {
      reject('missing-provenance');
      continue;
    }
    const fingerprints = new Set(
      group.map((observation) => canonicalJson(observation.fingerprint)),
    );
    if (fingerprints.size !== 1) {
      reject('conflicting-fingerprints');
      continue;
    }
    const provenances = group.map((observation) => observation.provenance as AuditProvenance);
    const commits = new Set(provenances.map((provenance) => provenance.commitSha ?? '<missing>'));
    if (commits.size !== 1) {
      reject('mixed-commits');
      continue;
    }
    const runIds = [...new Set(provenances.map((provenance) => provenance.runId))].sort();
    if (group.length < minimumObservations || runIds.length < minimumObservations) {
      reject('insufficient-independent-runs');
      continue;
    }
    const suggestedFingerprint = group[0]?.fingerprint;
    if (suggestedFingerprint === undefined) continue;
    if (canonicalJson(suggestedFingerprint) === canonicalJson(definition.fingerprint)) {
      reject('already-current');
      continue;
    }
    const timestamps = group.map((observation) => observation.timestamp).sort();
    const path = fingerprintPath(targetKey);
    const unsigned = {
      schemaVersion: FINGERPRINT_PROPOSAL_SCHEMA_VERSION,
      status: 'review-required',
      targetKey,
      currentFingerprint: definition.fingerprint,
      suggestedFingerprint,
      registryPatch: [
        { op: 'test', path, value: definition.fingerprint },
        { op: 'replace', path, value: suggestedFingerprint },
      ],
      evidence: {
        occurrenceCount: group.length,
        distinctRunCount: runIds.length,
        runIds,
        observationEventIds: group.map((observation) => observation.eventId).sort(),
        firstSeen: timestamps[0] ?? generatedAt,
        lastSeen: timestamps.at(-1) ?? generatedAt,
        ...(provenances[0]?.commitSha === undefined ? {} : { commitSha: provenances[0].commitSha }),
      },
    } as const satisfies Omit<FingerprintReviewProposal, 'proposalId'>;
    proposals.push({ ...unsigned, proposalId: digest(unsigned) });
  }

  return {
    $schema: FINGERPRINT_PROPOSAL_SCHEMA_URL,
    schemaVersion: FINGERPRINT_PROPOSAL_SCHEMA_VERSION,
    generatedAt,
    minimumObservations,
    proposals,
    rejections,
  };
}

export function renderFingerprintProposalReport(bundle: FingerprintProposalBundle): string {
  const lines = [
    '# Aegiloc fingerprint proposals',
    '',
    '> Review required: successful primary observations never modify the target registry.',
    '',
    `Generated: ${bundle.generatedAt}`,
    `Minimum distinct runs: ${bundle.minimumObservations}`,
    '',
  ];
  for (const proposal of bundle.proposals) {
    lines.push(
      `## ${proposal.targetKey}`,
      '',
      `- Proposal: \`${proposal.proposalId}\``,
      `- Independent runs: ${proposal.evidence.distinctRunCount}`,
      `- JSON Patch preview: \`${JSON.stringify(proposal.registryPatch)}\``,
      '',
    );
  }
  if (bundle.proposals.length === 0) lines.push('No fingerprint proposal met every gate.', '');
  if (bundle.rejections.length > 0) {
    lines.push('## Rejections', '');
    for (const rejection of bundle.rejections) {
      lines.push(`- ${rejection.targetKey}: ${rejection.reason} (${rejection.occurrenceCount})`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
