import type { Locator, Page } from '@playwright/test';

import type { PrimaryLocatorDefinition } from './types.js';

export function resolvePrimaryLocator(page: Page, definition: PrimaryLocatorDefinition): Locator {
  switch (definition.type) {
    case 'role':
      return page.getByRole(definition.role, {
        ...(definition.name === undefined ? {} : { name: definition.name }),
        ...(definition.exact === undefined ? {} : { exact: definition.exact }),
      });
    case 'label':
      return page.getByLabel(definition.value, {
        ...(definition.exact === undefined ? {} : { exact: definition.exact }),
      });
    case 'testId':
      return page.getByTestId(definition.value);
    case 'text':
      return page.getByText(definition.value, {
        ...(definition.exact === undefined ? {} : { exact: definition.exact }),
      });
    case 'css':
      return page.locator(definition.value);
  }
}
