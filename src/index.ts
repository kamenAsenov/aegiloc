export {
  createHealer,
  Healer,
  type CandidateCollector,
  type CreateHealerOptions,
} from './healer.js';
export {
  AUDIT_SCHEMA_VERSION,
  CompositeAuditSink,
  InMemoryAuditSink,
  JsonlAuditSink,
  NoopAuditSink,
  PlaywrightAttachmentAuditSink,
  createHealingAuditEvent,
  createHealingExecutionAuditEvent,
  type AuditCollectionStatus,
  type AuditModeDecision,
  type AuditRankedCandidate,
  type AuditSink,
  type HealwrightAuditEvent,
  type HealingAuditEvent,
  type HealingExecutionAuditEvent,
  type HealingExecutionReason,
  type HealingExecutionStatus,
} from './audit.js';
export {
  FileScreenshotCapture,
  type CapturedScreenshot,
  type ScreenshotCapture,
  type ScreenshotCaptureOptions,
  type ScreenshotPhase,
} from './artifacts.js';
export {
  collectCandidates,
  parseAriaIdentity,
  type AriaIdentity,
  type CandidateSnapshot,
} from './candidates.js';
export { executePrimaryAction, type PrimaryLocatorProbe } from './classification.js';
export {
  ArtifactCaptureError,
  AuditWriteError,
  HealingResultWriteError,
  MissingPrimaryLocatorError,
  RegistryValidationError,
  TargetActionNotAllowedError,
  UnknownTargetError,
} from './errors.js';
export {
  ConsoleHealingResultSink,
  InMemoryHealingResultSink,
  NoopHealingResultSink,
  PASSED_WITH_HEALING,
  PlaywrightHealingResultSink,
  type HealingResultSink,
  type HealingSuccessResult,
} from './result.js';
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
export { HEALING_MODES, TARGET_ACTIONS } from './types.js';
export type {
  AriaRole,
  HealingPolicy,
  HealingMode,
  PrimaryLocatorDefinition,
  TargetAction,
  TargetDefinition,
  TargetFingerprint,
  TargetGeometry,
  TargetPolicy,
  TargetRegistry,
} from './types.js';
