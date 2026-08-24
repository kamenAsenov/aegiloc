import type { Locator, Page } from '@playwright/test';

import { resolveTargetContext } from './context.js';
import type { LocatorRoot } from './locator.js';
import type { AriaRole, TargetAction, TargetContextDefinition, TargetGeometry } from './types.js';

const ACTION_SELECTORS: Readonly<Record<TargetAction, string>> = {
  click: [
    'button',
    'a[href]',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="reset"]',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="switch"]',
  ].join(', '),
  fill: [
    'input:not([type])',
    'input[type="email"]',
    'input[type="number"]',
    'input[type="password"]',
    'input[type="search"]',
    'input[type="tel"]',
    'input[type="text"]',
    'input[type="url"]',
    'textarea',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="spinbutton"]',
  ].join(', '),
  check: [
    'input[type="checkbox"]',
    'input[type="radio"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
  ].join(', '),
  uncheck: ['input[type="checkbox"]', '[role="checkbox"]', '[role="switch"]'].join(', '),
  selectOption: 'select',
  hover: [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[role]',
    '[tabindex]',
    '[title]',
  ].join(', '),
  focus: [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '[tabindex]',
  ].join(', '),
};

export interface CandidateCollectionOptions {
  readonly targetKey?: string;
  readonly context?: TargetContextDefinition;
  readonly testIdAttribute?: string;
}

export interface CandidateSnapshot {
  readonly id: string;
  readonly role?: string;
  readonly accessibleName?: string;
  readonly stableAttributes: Readonly<Record<string, string>>;
  readonly visibleText: string;
  readonly tag: string;
  readonly ancestorText: readonly string[];
  readonly neighborText: readonly string[];
  readonly geometry?: TargetGeometry;
}

interface DomCandidateSnapshot {
  readonly visible: boolean;
  readonly stableAttributes: Record<string, string>;
  readonly visibleText: string;
  readonly tag: string;
  readonly ancestorText: string[];
  readonly neighborText: string[];
  readonly geometry?: TargetGeometry;
}

export interface AriaIdentity {
  readonly role?: string;
  readonly accessibleName?: string;
}

function decodeSnapshotName(value: string): string {
  try {
    const decoded = JSON.parse(`"${value}"`) as unknown;
    return typeof decoded === 'string' ? decoded : value;
  } catch {
    return value;
  }
}

export function parseAriaIdentity(snapshot: string): AriaIdentity {
  const firstNode = snapshot
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('- '));

  if (firstNode === undefined) {
    return {};
  }

  const match = /^- ([a-z][\w-]*)(?: "((?:\\.|[^"])*)")?/.exec(firstNode);
  if (match === null) {
    return {};
  }

  const role = match[1];
  const accessibleName = match[2];
  return {
    ...(role === undefined ? {} : { role }),
    ...(accessibleName === undefined ? {} : { accessibleName: decodeSnapshotName(accessibleName) }),
  };
}

function normalizeDomText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

async function snapshotDomCandidates(
  locator: Locator,
  testIdAttribute: string,
): Promise<readonly DomCandidateSnapshot[]> {
  return locator.evaluateAll((elements, configuredTestIdAttribute) => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);

    return elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden';

      const stableAttributes: Record<string, string> = {};
      const stableAttributeNames = new Set([
        'autocomplete',
        'alt',
        'data-cy',
        'data-qa',
        'data-target',
        'data-test',
        'data-testid',
        'id',
        'name',
        'placeholder',
        'title',
        'type',
        configuredTestIdAttribute,
      ]);
      for (const attribute of element.attributes) {
        if (stableAttributeNames.has(attribute.name)) {
          stableAttributes[attribute.name] = attribute.value;
        } else if (attribute.name === 'href') {
          try {
            stableAttributes.href = new URL(attribute.value, window.location.href).pathname;
          } catch {
            // Ignore malformed or non-URL href values rather than auditing them verbatim.
          }
        }
      }

      const contextText = (context: Element | null): string => {
        if (context === null) return '';
        const ariaLabel = context.getAttribute('aria-label');
        const heading = context.querySelector('h1, h2, h3, legend');
        return normalize(ariaLabel ?? heading?.textContent ?? '');
      };

      const ancestorText: string[] = [];
      let ancestor = element.parentElement;
      while (ancestor !== null && ancestorText.length < 3) {
        if (ancestor.matches('form, fieldset, section, article, nav, main, [aria-label]')) {
          const text = contextText(ancestor);
          if (text !== '' && !ancestorText.includes(text)) ancestorText.push(text);
        }
        ancestor = ancestor.parentElement;
      }

      const neighborText = [element.previousElementSibling, element.nextElementSibling]
        .map((neighbor) => normalize((neighbor as HTMLElement | null)?.innerText))
        .filter((text) => text !== '')
        .slice(0, 4);
      const viewportWidth = Math.max(window.innerWidth, 1);
      const viewportHeight = Math.max(window.innerHeight, 1);

      return {
        visible,
        stableAttributes,
        visibleText: normalize((element as HTMLElement).innerText ?? element.textContent),
        tag: element.tagName.toLowerCase(),
        ancestorText,
        neighborText,
        geometry: {
          x: (rect.x + rect.width / 2) / viewportWidth,
          y: (rect.y + rect.height / 2) / viewportHeight,
          width: rect.width / viewportWidth,
          height: rect.height / viewportHeight,
        },
      };
    });
  }, testIdAttribute);
}

async function collectAriaIdentities(
  locator: Locator,
  indices: readonly number[],
): Promise<ReadonlyMap<number, AriaIdentity>> {
  const identities = new Map<number, AriaIdentity>();
  const concurrency = 16;
  for (let start = 0; start < indices.length; start += concurrency) {
    const batch = indices.slice(start, start + concurrency);
    const results = await Promise.all(
      batch.map(async (index) => {
        try {
          return [index, parseAriaIdentity(await locator.nth(index).ariaSnapshot())] as const;
        } catch {
          // A candidate without an accessibility snapshot remains scoreable by other signals.
          return [index, {}] as const;
        }
      }),
    );
    for (const [index, identity] of results) identities.set(index, identity);
  }
  return identities;
}

export async function collectCandidates(
  page: Page,
  action: TargetAction,
  options: CandidateCollectionOptions = {},
): Promise<readonly CandidateSnapshot[]> {
  const root = (
    await resolveTargetContext(page, options.targetKey ?? '<candidate-collection>', options.context)
  ).root;
  const testIdAttribute = options.testIdAttribute ?? 'data-testid';
  const candidates = root.locator(ACTION_SELECTORS[action]);
  const domSnapshots = await snapshotDomCandidates(candidates, testIdAttribute);
  const visibleIndices = domSnapshots.flatMap((dom, index) => (dom.visible ? [index] : []));
  const ariaIdentities = await collectAriaIdentities(candidates, visibleIndices);
  const snapshots: CandidateSnapshot[] = [];

  for (const index of visibleIndices) {
    const dom = domSnapshots[index];
    if (dom === undefined) continue;
    const aria = ariaIdentities.get(index) ?? {};
    const stableId =
      dom.stableAttributes[testIdAttribute] ??
      dom.stableAttributes.id ??
      dom.stableAttributes.name ??
      String(index);

    snapshots.push({
      id: `${dom.tag}:${stableId}:${index}`,
      ...aria,
      stableAttributes: dom.stableAttributes,
      visibleText: normalizeDomText(dom.visibleText),
      tag: dom.tag,
      ancestorText: dom.ancestorText,
      neighborText: dom.neighborText,
      ...(dom.geometry === undefined ? {} : { geometry: dom.geometry }),
    });
  }

  return snapshots;
}

export async function snapshotLocatorCandidate(
  locator: Locator,
  testIdAttribute = 'data-testid',
): Promise<CandidateSnapshot | undefined> {
  if ((await locator.count()) !== 1) return undefined;
  const [dom] = await snapshotDomCandidates(locator, testIdAttribute);
  if (dom === undefined || !dom.visible) return undefined;
  let aria: AriaIdentity = {};
  try {
    aria = parseAriaIdentity(await locator.ariaSnapshot());
  } catch {
    // The fingerprint remains useful when the accessibility snapshot is unavailable.
  }
  const stableId =
    dom.stableAttributes[testIdAttribute] ??
    dom.stableAttributes.id ??
    dom.stableAttributes.name ??
    'primary';
  return {
    id: `${dom.tag}:${stableId}:0`,
    ...aria,
    stableAttributes: dom.stableAttributes,
    visibleText: normalizeDomText(dom.visibleText),
    tag: dom.tag,
    ancestorText: dom.ancestorText,
    neighborText: dom.neighborText,
    ...(dom.geometry === undefined ? {} : { geometry: dom.geometry }),
  };
}

export async function resolveUniqueCandidateLocator(
  page: Page,
  candidate: CandidateSnapshot,
  options: CandidateCollectionOptions = {},
): Promise<Locator | undefined> {
  if (
    candidate.role === undefined ||
    candidate.accessibleName === undefined ||
    !/^[a-z][a-z0-9-]*$/.test(candidate.tag)
  ) {
    return undefined;
  }

  try {
    const root: LocatorRoot = (
      await resolveTargetContext(
        page,
        options.targetKey ?? '<candidate-revalidation>',
        options.context,
      )
    ).root;
    let locator = root
      .getByRole(candidate.role as AriaRole, {
        name: candidate.accessibleName,
        exact: true,
      })
      .and(root.locator(candidate.tag));
    const testIdAttribute = options.testIdAttribute ?? 'data-testid';
    const testId = candidate.stableAttributes[testIdAttribute];
    if (testId !== undefined) {
      locator = locator.and(root.getByTestId(testId));
    }

    return (await locator.count()) === 1 ? locator : undefined;
  } catch {
    return undefined;
  }
}
