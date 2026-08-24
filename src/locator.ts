import type { FrameLocator, Locator, Page } from '@playwright/test';

import type { PrimaryLocatorDefinition } from './types.js';

export type LocatorRoot = Page | Locator | FrameLocator;

export function resolvePrimaryLocator(
  root: LocatorRoot,
  definition: PrimaryLocatorDefinition,
): Locator {
  switch (definition.type) {
    case 'role':
      return root.getByRole(definition.role, {
        ...(definition.name === undefined ? {} : { name: definition.name }),
        ...(definition.exact === undefined ? {} : { exact: definition.exact }),
      });
    case 'label':
      return root.getByLabel(definition.value, {
        ...(definition.exact === undefined ? {} : { exact: definition.exact }),
      });
    case 'testId':
      return root.getByTestId(definition.value);
    case 'text':
      return root.getByText(definition.value, {
        ...(definition.exact === undefined ? {} : { exact: definition.exact }),
      });
    case 'placeholder':
      return root.getByPlaceholder(definition.value, {
        ...(definition.exact === undefined ? {} : { exact: definition.exact }),
      });
    case 'title':
      return root.getByTitle(definition.value, {
        ...(definition.exact === undefined ? {} : { exact: definition.exact }),
      });
    case 'altText':
      return root.getByAltText(definition.value, {
        ...(definition.exact === undefined ? {} : { exact: definition.exact }),
      });
    case 'css':
      return root.locator(definition.value);
  }
}
