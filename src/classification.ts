import { errors } from '@playwright/test';

import { MissingPrimaryLocatorError } from './errors.js';
import type { TargetAction } from './types.js';

export interface PrimaryLocatorProbe {
  waitFor(options: { readonly state: 'attached'; readonly timeout: number }): Promise<void>;
  count(): Promise<number>;
}

export interface ExecutePrimaryActionOptions<TResult> {
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly locator: PrimaryLocatorProbe;
  readonly timeoutMs: number;
  readonly invoke: () => Promise<TResult>;
}

type AttachmentObservation = 'attached' | 'never-attached' | 'indeterminate';

async function observeAttachment(
  locator: PrimaryLocatorProbe,
  timeoutMs: number,
): Promise<AttachmentObservation> {
  try {
    await locator.waitFor({ state: 'attached', timeout: timeoutMs });
    return 'attached';
  } catch (error) {
    return error instanceof errors.TimeoutError ? 'never-attached' : 'indeterminate';
  }
}

export async function executePrimaryAction<TResult>({
  targetKey,
  action,
  locator,
  timeoutMs,
  invoke,
}: ExecutePrimaryActionOptions<TResult>): Promise<TResult> {
  if (timeoutMs <= 0) {
    return invoke();
  }

  const attachmentObservation = observeAttachment(locator, timeoutMs);

  try {
    return await invoke();
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) {
      throw error;
    }

    const attachment = await attachmentObservation;
    if (attachment !== 'never-attached') {
      throw error;
    }

    let finalCount: number;
    try {
      finalCount = await locator.count();
    } catch {
      throw error;
    }

    if (finalCount !== 0) {
      throw error;
    }

    throw new MissingPrimaryLocatorError(targetKey, action, error);
  }
}
