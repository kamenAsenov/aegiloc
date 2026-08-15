export { createHealer, Healer, type CreateHealerOptions } from './healer.js';
export {
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
