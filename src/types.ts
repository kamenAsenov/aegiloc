import type { Page } from '@playwright/test';

export const TARGET_ACTIONS = [
  'click',
  'fill',
  'check',
  'uncheck',
  'selectOption',
  'hover',
  'focus',
] as const;
export const HEALING_MODES = ['off', 'observe', 'guarded', 'strict-ci'] as const;
export const EXECUTION_RISKS = ['automatic', 'proposal-only'] as const;

export type TargetAction = (typeof TARGET_ACTIONS)[number];
export type HealingMode = (typeof HEALING_MODES)[number];
export type ExecutionRisk = (typeof EXECUTION_RISKS)[number];
export type AriaRole = Parameters<Page['getByRole']>[0];

export interface RoleLocatorDefinition {
  readonly type: 'role';
  readonly role: AriaRole;
  readonly name?: string;
  readonly exact?: boolean;
}

export interface LabelLocatorDefinition {
  readonly type: 'label';
  readonly value: string;
  readonly exact?: boolean;
}

export interface TestIdLocatorDefinition {
  readonly type: 'testId';
  readonly value: string;
}

export interface TextLocatorDefinition {
  readonly type: 'text';
  readonly value: string;
  readonly exact?: boolean;
}

export interface PlaceholderLocatorDefinition {
  readonly type: 'placeholder';
  readonly value: string;
  readonly exact?: boolean;
}

export interface TitleLocatorDefinition {
  readonly type: 'title';
  readonly value: string;
  readonly exact?: boolean;
}

export interface AltTextLocatorDefinition {
  readonly type: 'altText';
  readonly value: string;
  readonly exact?: boolean;
}

export interface CssLocatorDefinition {
  readonly type: 'css';
  readonly value: string;
}

export type PrimaryLocatorDefinition =
  | RoleLocatorDefinition
  | LabelLocatorDefinition
  | TestIdLocatorDefinition
  | TextLocatorDefinition
  | PlaceholderLocatorDefinition
  | TitleLocatorDefinition
  | AltTextLocatorDefinition
  | CssLocatorDefinition;

export interface TargetContextDefinition {
  /** Exact URL pathname required before the target may be resolved. Query and hash are ignored. */
  readonly pathname?: string;
  /** Locator for exactly one iframe. The frame boundary itself is never eligible for healing. */
  readonly frame?: PrimaryLocatorDefinition;
  /** Locator for exactly one container inside the page or configured frame. */
  readonly container?: PrimaryLocatorDefinition;
}

export interface TargetFingerprint {
  readonly accessibleRole?: AriaRole;
  readonly accessibleName?: string;
  readonly stableAttributes?: Readonly<Record<string, string>>;
  readonly visibleText?: string;
  readonly tag?: string;
  readonly ancestorText?: readonly string[];
  readonly neighborText?: readonly string[];
  readonly geometry?: TargetGeometry;
}

export interface TargetGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HealingPolicy {
  readonly enabled: boolean;
  readonly confidenceThreshold: number;
  readonly minimumScoreMargin: number;
}

export interface TargetPolicy {
  readonly allowedActions: readonly TargetAction[];
  /** Missing in a v0.3 registry means `automatic`; v0.4 registries should declare it explicitly. */
  readonly executionRisk?: ExecutionRisk;
  readonly healing: HealingPolicy;
}

export function resolveExecutionRisk(policy: TargetPolicy): ExecutionRisk {
  return policy.executionRisk ?? 'automatic';
}

export interface TargetDefinition {
  readonly description: string;
  readonly context?: TargetContextDefinition;
  readonly primary: PrimaryLocatorDefinition;
  readonly fingerprint: TargetFingerprint;
  readonly policy: TargetPolicy;
}

export interface RegistryDefaults {
  readonly confidenceThreshold: number;
  readonly minimumScoreMargin: number;
  /** Attribute used by Playwright's getByTestId contract. Defaults to data-testid. */
  readonly testIdAttribute?: string;
}

export interface TargetRegistry<TTargetKey extends string = string> {
  readonly version: 1;
  readonly defaults: RegistryDefaults;
  readonly targets: Readonly<Record<TTargetKey, TargetDefinition>>;
}
