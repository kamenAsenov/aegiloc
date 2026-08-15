import type { Locator, Page } from '@playwright/test';

import type { TargetAction, TargetGeometry } from './types.js';

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
  selectOption: 'select',
};

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

async function snapshotDomCandidate(locator: Locator): Promise<DomCandidateSnapshot> {
  return locator.evaluate((element) => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden';

    const stableAttributes: Record<string, string> = {};
    for (const attribute of element.attributes) {
      if (
        attribute.name.startsWith('data-') ||
        ['autocomplete', 'href', 'id', 'name', 'placeholder', 'title', 'type', 'value'].includes(
          attribute.name,
        )
      ) {
        stableAttributes[attribute.name] = attribute.value;
      }
    }

    const contextText = (context: Element | null): string => {
      if (context === null) {
        return '';
      }
      const ariaLabel = context.getAttribute('aria-label');
      const heading = context.querySelector('h1, h2, h3, legend');
      return normalize(ariaLabel ?? heading?.textContent ?? '');
    };

    const ancestorText: string[] = [];
    let ancestor = element.parentElement;
    while (ancestor !== null && ancestorText.length < 3) {
      if (ancestor.matches('form, fieldset, section, article, nav, main, [aria-label]')) {
        const text = contextText(ancestor);
        if (text !== '' && !ancestorText.includes(text)) {
          ancestorText.push(text);
        }
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
}

export async function collectCandidates(
  page: Page,
  action: TargetAction,
): Promise<readonly CandidateSnapshot[]> {
  const candidates = page.locator(ACTION_SELECTORS[action]);
  const count = await candidates.count();
  const snapshots: CandidateSnapshot[] = [];

  for (let index = 0; index < count; index += 1) {
    const locator = candidates.nth(index);
    const dom = await snapshotDomCandidate(locator);
    if (!dom.visible) {
      continue;
    }

    let ariaSnapshot = '';
    try {
      ariaSnapshot = await locator.ariaSnapshot();
    } catch {
      // A candidate without an accessibility snapshot remains scoreable by other signals.
    }
    const aria = parseAriaIdentity(ariaSnapshot);
    const stableId =
      dom.stableAttributes['data-testid'] ??
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
