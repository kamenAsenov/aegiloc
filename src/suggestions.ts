import type { Page } from '@playwright/test';

import {
  resolveUniqueCandidateLocator,
  type CandidateCollectionOptions,
  type CandidateSnapshot,
} from './candidates.js';
import { resolveTargetContext } from './context.js';
import { resolvePrimaryLocator } from './locator.js';
import type { PrimaryLocatorDefinition } from './types.js';

export interface LocatorSuggestionEvidence {
  readonly locator: PrimaryLocatorDefinition;
  readonly strategy: PrimaryLocatorDefinition['type'];
  readonly matchCount: number;
  readonly matchesCandidate: boolean;
}

const STRATEGY_PRIORITY: Readonly<Record<PrimaryLocatorDefinition['type'], number>> = {
  testId: 0,
  role: 1,
  label: 2,
  placeholder: 3,
  title: 4,
  altText: 5,
  text: 6,
  css: 7,
};

function cssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\a ')
    .replace(/\r/g, '\\d ');
}

function attributeSelector(name: string, value: string, tag?: string): string {
  return `${tag ?? ''}[${name}="${cssString(value)}"]`;
}

function candidateDefinitions(
  candidate: CandidateSnapshot,
  testIdAttribute: string,
): readonly PrimaryLocatorDefinition[] {
  const definitions: PrimaryLocatorDefinition[] = [];
  const testId = candidate.stableAttributes[testIdAttribute];
  if (testId !== undefined) definitions.push({ type: 'testId', value: testId });
  if (candidate.role !== undefined && candidate.accessibleName !== undefined) {
    definitions.push({
      type: 'role',
      role: candidate.role as Parameters<Page['getByRole']>[0],
      name: candidate.accessibleName,
      exact: true,
    });
    definitions.push({ type: 'label', value: candidate.accessibleName, exact: true });
  }
  const placeholder = candidate.stableAttributes.placeholder;
  if (placeholder !== undefined) {
    definitions.push({ type: 'placeholder', value: placeholder, exact: true });
  }
  const title = candidate.stableAttributes.title;
  if (title !== undefined) definitions.push({ type: 'title', value: title, exact: true });
  const alt = candidate.stableAttributes.alt;
  if (alt !== undefined) definitions.push({ type: 'altText', value: alt, exact: true });
  if (candidate.visibleText !== '') {
    definitions.push({ type: 'text', value: candidate.visibleText, exact: true });
  }

  if (testId !== undefined) {
    definitions.push({
      type: 'css',
      value: attributeSelector(testIdAttribute, testId, candidate.tag),
    });
  } else if (candidate.stableAttributes.id !== undefined) {
    definitions.push({
      type: 'css',
      value: attributeSelector('id', candidate.stableAttributes.id, candidate.tag),
    });
  } else if (candidate.stableAttributes.name !== undefined) {
    definitions.push({
      type: 'css',
      value: attributeSelector('name', candidate.stableAttributes.name, candidate.tag),
    });
  }

  const seen = new Set<string>();
  return definitions.filter((definition) => {
    const identity = JSON.stringify(definition);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export async function collectLocatorSuggestions(
  page: Page,
  candidate: CandidateSnapshot,
  options: CandidateCollectionOptions = {},
): Promise<readonly LocatorSuggestionEvidence[]> {
  const candidateLocator = await resolveUniqueCandidateLocator(page, candidate, options);
  if (candidateLocator === undefined) return [];

  const root = (
    await resolveTargetContext(page, options.targetKey ?? '<locator-suggestions>', options.context)
  ).root;
  const testIdAttribute = options.testIdAttribute ?? 'data-testid';
  const suggestions: LocatorSuggestionEvidence[] = [];
  for (const definition of candidateDefinitions(candidate, testIdAttribute)) {
    try {
      const locator = resolvePrimaryLocator(root, definition);
      const matchCount = await locator.count();
      suggestions.push({
        locator: definition,
        strategy: definition.type,
        matchCount,
        matchesCandidate: matchCount === 1 && (await locator.and(candidateLocator).count()) === 1,
      });
    } catch {
      // A malformed or unsupported live selector is omitted rather than weakening review evidence.
    }
  }

  return suggestions.sort(
    (left, right) =>
      STRATEGY_PRIORITY[left.strategy] - STRATEGY_PRIORITY[right.strategy] ||
      JSON.stringify(left.locator).localeCompare(JSON.stringify(right.locator)),
  );
}
