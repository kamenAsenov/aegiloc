export { createHealer, Healer, type CreateHealerOptions } from './healer.js';
export {
  collectCandidates,
  parseAriaIdentity,
  type AriaIdentity,
  type CandidateSnapshot,
} from './candidates.js';
export { executePrimaryAction, type PrimaryLocatorProbe } from './classification.js';
export {
  MissingPrimaryLocatorError,
  RegistryValidationError,
  TargetActionNotAllowedError,
  UnknownTargetError,
} from './errors.js';
export { resolvePrimaryLocator } from './locator.js';
export {
  SCORE_WEIGHTS,
  assessCandidates,
  rankCandidates,
  scoreCandidate,
  type CandidateAssessment,
  type CandidateAssessmentReason,
  type RankedCandidate,
  type ScoreDetail,
  type ScoreSignal,
} from './scoring.js';
export { loadTargetRegistry, parseTargetRegistry } from './registry.js';
export type {
  AriaRole,
  HealingPolicy,
  PrimaryLocatorDefinition,
  TargetAction,
  TargetDefinition,
  TargetFingerprint,
  TargetGeometry,
  TargetPolicy,
  TargetRegistry,
} from './types.js';
