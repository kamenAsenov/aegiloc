import type { Locator, Page } from '@playwright/test';

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
  ) {}

  public async click(options?: ClickOptions): Promise<void> {
    this.assertActionAllowed('click');
    const locator = this.primaryLocator();
    await (options === undefined ? locator.click() : locator.click(options));
  }

  public async fill(value: string, options?: FillOptions): Promise<void> {
    this.assertActionAllowed('fill');
    const locator = this.primaryLocator();
    await (options === undefined ? locator.fill(value) : locator.fill(value, options));
  }

  public async check(options?: CheckOptions): Promise<void> {
    this.assertActionAllowed('check');
    const locator = this.primaryLocator();
    await (options === undefined ? locator.check() : locator.check(options));
  }

  public async selectOption(
    values: SelectOptionValues,
    options?: SelectOptionOptions,
  ): Promise<readonly string[]> {
    this.assertActionAllowed('selectOption');
    const locator = this.primaryLocator();
    return options === undefined
      ? locator.selectOption(values)
      : locator.selectOption(values, options);
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
  ) {}

  public target(key: TTargetKey): HealerTarget {
    if (!Object.hasOwn(this.registry.targets, key)) {
      throw new UnknownTargetError(key);
    }

    return new HealerTarget(this.page, key, this.registry.targets[key]);
  }
}

export interface CreateHealerOptions<TTargetKey extends string = string> {
  readonly page: Page;
  readonly registry: TargetRegistry<TTargetKey>;
}

export function createHealer<TTargetKey extends string = string>({
  page,
  registry,
}: CreateHealerOptions<TTargetKey>): Healer<TTargetKey> {
  return new Healer(page, registry);
}
