import type { Page } from '@playwright/test';

import { TargetContextError } from './errors.js';
import { resolvePrimaryLocator, type LocatorRoot } from './locator.js';
import type { TargetContextDefinition } from './types.js';

export interface ResolvedTargetContext {
  readonly root: LocatorRoot;
  readonly pathname?: string;
  readonly frameScoped: boolean;
  readonly containerScoped: boolean;
}

function requireUniqueScope(targetKey: string, kind: 'frame' | 'container', count: number): void {
  if (count === 0) {
    throw new TargetContextError(targetKey, `${kind}-missing`);
  }
  if (count !== 1) {
    throw new TargetContextError(targetKey, `${kind}-ambiguous`);
  }
}

export async function resolveTargetContext(
  page: Page,
  targetKey: string,
  context?: TargetContextDefinition,
): Promise<ResolvedTargetContext> {
  if (context?.pathname !== undefined) {
    let actualPathname: string;
    try {
      actualPathname = new URL(page.url()).pathname;
    } catch {
      actualPathname = '';
    }
    if (actualPathname !== context.pathname) {
      throw new TargetContextError(targetKey, 'pathname-mismatch');
    }
  }

  let root: LocatorRoot = page;
  if (context?.frame !== undefined) {
    const frameOwner = resolvePrimaryLocator(root, context.frame);
    requireUniqueScope(targetKey, 'frame', await frameOwner.count());
    const tagName = await frameOwner.evaluate((element) => element.tagName.toLowerCase());
    if (tagName !== 'iframe' && tagName !== 'frame') {
      throw new TargetContextError(targetKey, 'frame-not-iframe');
    }
    root = frameOwner.contentFrame();
  }

  if (context?.container !== undefined) {
    const container = resolvePrimaryLocator(root, context.container);
    requireUniqueScope(targetKey, 'container', await container.count());
    root = container;
  }

  return {
    root,
    ...(context?.pathname === undefined ? {} : { pathname: context.pathname }),
    frameScoped: context?.frame !== undefined,
    containerScoped: context?.container !== undefined,
  };
}
