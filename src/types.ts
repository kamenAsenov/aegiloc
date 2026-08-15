import type { Page } from '@playwright/test';

export const TARGET_ACTIONS = ['click', 'fill', 'check', 'selectOption'] as const;

export type TargetAction = (typeof TARGET_ACTIONS)[number];
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

export interface CssLocatorDefinition {
  readonly type: 'css';
  readonly value: string;
}

export type PrimaryLocatorDefinition =
  | RoleLocatorDefinition
  | LabelLocatorDefinition
  | TestIdLocatorDefinition
  | TextLocatorDefinition
  | CssLocatorDefinition;

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
  readonly healing: HealingPolicy;
}

export interface TargetDefinition {
  readonly description: string;
  readonly primary: PrimaryLocatorDefinition;
  readonly fingerprint: TargetFingerprint;
  readonly policy: TargetPolicy;
}

export interface RegistryDefaults {
  readonly confidenceThreshold: number;
  readonly minimumScoreMargin: number;
}

export interface TargetRegistry<TTargetKey extends string = string> {
  readonly version: 1;
  readonly defaults: RegistryDefaults;
  readonly targets: Readonly<Record<TTargetKey, TargetDefinition>>;
}
