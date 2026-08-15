export { createHealer, Healer, type CreateHealerOptions } from './healer.js';
export { executePrimaryAction, type PrimaryLocatorProbe } from './classification.js';
export {
  MissingPrimaryLocatorError,
  RegistryValidationError,
  TargetActionNotAllowedError,
  UnknownTargetError,
} from './errors.js';
export { resolvePrimaryLocator } from './locator.js';
export { loadTargetRegistry, parseTargetRegistry } from './registry.js';
export type {
  AriaRole,
  PrimaryLocatorDefinition,
  TargetAction,
  TargetDefinition,
  TargetFingerprint,
  TargetPolicy,
  TargetRegistry,
} from './types.js';
