import type { Locator, Page } from '@playwright/test';

import { executePrimaryAction } from './classification.js';
import { TargetActionNotAllowedError, UnknownTargetError } from './errors.js';
import { resolvePrimaryLocator } from './locator.js';
import type { TargetAction, TargetDefinition, TargetRegistry } from './types.js';

type ClickOptions = Parameters<Locator['click']>[0];
type FillOptions = Parameters<Locator['fill']>[1];
type CheckOptions = Parameters<Locator['check']>[0];
type SelectOptionValues = Parameters<Locator['selectOption']>[0];
type SelectOptionOptions = Parameters<Locator['selectOption']>[1];

class HealerTarget {
  public constructor(
    private readonly page: Page,
    private readonly key: string,
    private readonly definition: TargetDefinition,
    private readonly primaryActionTimeoutMs: number,
  ) {}

  public async click(options?: ClickOptions): Promise<void> {
    this.assertActionAllowed('click');
    const locator = this.primaryLocator();
    const effectiveOptions = {
      ...options,
      timeout: options?.timeout ?? this.primaryActionTimeoutMs,
    };
    await executePrimaryAction({
      targetKey: this.key,
      action: 'click',
      locator,
      timeoutMs: effectiveOptions.timeout,
      invoke: () => locator.click(effectiveOptions),
    });
  }

  public async fill(value: string, options?: FillOptions): Promise<void> {
    this.assertActionAllowed('fill');
    const locator = this.primaryLocator();
    const effectiveOptions = {
      ...options,
      timeout: options?.timeout ?? this.primaryActionTimeoutMs,
    };
    await executePrimaryAction({
      targetKey: this.key,
      action: 'fill',
      locator,
      timeoutMs: effectiveOptions.timeout,
      invoke: () => locator.fill(value, effectiveOptions),
    });
  }

  public async check(options?: CheckOptions): Promise<void> {
    this.assertActionAllowed('check');
    const locator = this.primaryLocator();
    const effectiveOptions = {
      ...options,
      timeout: options?.timeout ?? this.primaryActionTimeoutMs,
    };
    await executePrimaryAction({
      targetKey: this.key,
      action: 'check',
      locator,
      timeoutMs: effectiveOptions.timeout,
      invoke: () => locator.check(effectiveOptions),
    });
  }

  public async selectOption(
    values: SelectOptionValues,
    options?: SelectOptionOptions,
  ): Promise<readonly string[]> {
    this.assertActionAllowed('selectOption');
    const locator = this.primaryLocator();
    const effectiveOptions = {
      ...options,
      timeout: options?.timeout ?? this.primaryActionTimeoutMs,
    };
    return executePrimaryAction({
      targetKey: this.key,
      action: 'selectOption',
      locator,
      timeoutMs: effectiveOptions.timeout,
      invoke: () => locator.selectOption(values, effectiveOptions),
    });
  }

  private primaryLocator(): Locator {
    return resolvePrimaryLocator(this.page, this.definition.primary);
  }

  private assertActionAllowed(action: TargetAction): void {
    if (!this.definition.policy.allowedActions.includes(action)) {
      throw new TargetActionNotAllowedError(this.key, action);
    }
  }
}

export class Healer<TTargetKey extends string = string> {
  public constructor(
    private readonly page: Page,
    private readonly registry: TargetRegistry<TTargetKey>,
    private readonly primaryActionTimeoutMs: number,
  ) {}

  public target(key: TTargetKey): HealerTarget {
    if (!Object.hasOwn(this.registry.targets, key)) {
      throw new UnknownTargetError(key);
    }

    return new HealerTarget(
      this.page,
      key,
      this.registry.targets[key],
      this.primaryActionTimeoutMs,
    );
  }
}

export interface CreateHealerOptions<TTargetKey extends string = string> {
  readonly page: Page;
  readonly registry: TargetRegistry<TTargetKey>;
  readonly primaryActionTimeoutMs?: number;
}

export function createHealer<TTargetKey extends string = string>({
  page,
  registry,
  primaryActionTimeoutMs = 2_000,
}: CreateHealerOptions<TTargetKey>): Healer<TTargetKey> {
  if (!Number.isFinite(primaryActionTimeoutMs) || primaryActionTimeoutMs <= 0) {
    throw new TypeError('primaryActionTimeoutMs must be a finite number greater than zero');
  }

  return new Healer(page, registry, primaryActionTimeoutMs);
}
