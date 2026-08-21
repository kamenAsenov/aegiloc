import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type {
  AuditRankedCandidate,
  HealingAuditEvent,
  HealingExecutionAuditEvent,
  HealwrightAuditEvent,
} from './audit.js';
import { createAuditEvidenceSummary, type AuditEvidenceSummary } from './evidence.js';
import { verifyEvidenceManifest } from './evidence-manifest.js';
import { AuditEvidenceError } from './errors.js';
import { parseAuditHistory } from './proposals.js';
import type { PrimaryLocatorDefinition } from './types.js';

export type ReportEvidenceTrust =
  | { readonly level: 'validated' }
  | { readonly level: 'integrity' }
  | { readonly level: 'authenticated'; readonly keyId: string };

export interface RenderReportViewerOptions {
  readonly title?: string;
  readonly evidenceTrust?: ReportEvidenceTrust;
}

export interface GenerateReportViewerOptions extends RenderReportViewerOptions {
  readonly historyPath: string;
  readonly summaryPath: string;
  readonly outputDirectory: string;
  readonly manifestPath?: string;
  readonly key?: Uint8Array;
  readonly expectedKeyId?: string;
  readonly requireAuthenticated?: boolean;
  readonly force?: boolean;
}

export interface GeneratedReportViewer {
  readonly indexPath: string;
  readonly eventCount: number;
  readonly successfulHealingCount: number;
  readonly evidenceTrust: ReportEvidenceTrust;
}

type ReportOutcome = 'healed' | 'rejected' | 'protected' | 'failed' | 'observed';

const FILTER_SCRIPT = `(() => {
  const form = document.querySelector('[data-report-filters]');
  if (!(form instanceof HTMLFormElement)) return;
  const cards = [...document.querySelectorAll('[data-event-card]')];
  const count = document.querySelector('[data-visible-count]');
  const empty = document.querySelector('[data-filter-empty]');
  const search = form.elements.namedItem('search');
  const action = form.elements.namedItem('action');
  const outcome = form.elements.namedItem('outcome');
  const reason = form.elements.namedItem('reason');
  const value = (control) => control instanceof HTMLInputElement || control instanceof HTMLSelectElement ? control.value.toLowerCase() : '';
  const apply = () => {
    const query = value(search).trim();
    let visible = 0;
    for (const card of cards) {
      const matches =
        (query === '' || (card.getAttribute('data-search') ?? '').includes(query)) &&
        (value(action) === '' || card.getAttribute('data-action') === value(action)) &&
        (value(outcome) === '' || card.getAttribute('data-outcome') === value(outcome)) &&
        (value(reason) === '' || card.getAttribute('data-reason') === value(reason));
      card.hidden = !matches;
      if (matches) visible += 1;
    }
    if (count) count.textContent = String(visible);
    if (empty instanceof HTMLElement) empty.hidden = visible !== 0;
  };
  form.addEventListener('input', apply);
  form.addEventListener('change', apply);
  form.querySelector('[data-clear-filters]')?.addEventListener('click', () => {
    form.reset();
    apply();
    if (search instanceof HTMLInputElement) search.focus();
  });
  apply();
})();`;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSummary(
  contents: string,
  events: readonly HealwrightAuditEvent[],
): AuditEvidenceSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new AuditEvidenceError('report summary is not valid JSON', error);
  }
  if (!isRecord(parsed) || typeof parsed.generatedAt !== 'string') {
    throw new AuditEvidenceError('report summary must contain generatedAt');
  }
  let canonical: AuditEvidenceSummary;
  try {
    canonical = createAuditEvidenceSummary(events, parsed.generatedAt);
  } catch (error) {
    throw new AuditEvidenceError('report summary is malformed', error);
  }
  if (!isDeepStrictEqual(parsed, canonical)) {
    throw new AuditEvidenceError('report summary does not match the canonical history');
  }
  return canonical;
}

function locatorText(locator: PrimaryLocatorDefinition): string {
  switch (locator.type) {
    case 'role':
      return `getByRole(${JSON.stringify(locator.role)}${
        locator.name === undefined
          ? ''
          : `, { name: ${JSON.stringify(locator.name)}${locator.exact === true ? ', exact: true' : ''} }`
      })`;
    case 'label':
      return `getByLabel(${JSON.stringify(locator.value)}${locator.exact === true ? ', { exact: true }' : ''})`;
    case 'testId':
      return `getByTestId(${JSON.stringify(locator.value)})`;
    case 'text':
      return `getByText(${JSON.stringify(locator.value)}${locator.exact === true ? ', { exact: true }' : ''})`;
    case 'css':
      return `locator(${JSON.stringify(locator.value)})`;
  }
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function label(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function assessmentOutcome(
  event: HealingAuditEvent,
  execution: HealingExecutionAuditEvent | undefined,
): ReportOutcome {
  if (execution?.status === 'succeeded') return 'healed';
  if (execution?.status === 'failed') return 'failed';
  if (
    event.executionPolicy?.automaticExecutionAllowed === false ||
    execution?.reason === 'execution-risk-protected'
  ) {
    return 'protected';
  }
  if (event.modeDecision === 'rejected' || event.modeDecision === 'strict-ci-failure') {
    return 'rejected';
  }
  return 'observed';
}

function outcomeCopy(outcome: ReportOutcome): {
  readonly badge: string;
  readonly heading: string;
  readonly next: string;
} {
  switch (outcome) {
    case 'healed':
      return {
        badge: 'Passed with healing',
        heading: 'A guarded replacement executed successfully',
        next: 'Review the evidence and create or inspect a locator proposal. Do not silently rewrite the test.',
      };
    case 'rejected':
      return {
        badge: 'Rejected safely',
        heading: 'No replacement was allowed to execute',
        next: 'Inspect the rejection reason and preserve the test failure until the product or locator is reviewed.',
      };
    case 'protected':
      return {
        badge: 'Protected',
        heading: 'Policy prevented automatic execution',
        next: 'Review the evidence as a proposal-only case. Keep sensitive or irreversible actions human-controlled.',
      };
    case 'failed':
      return {
        badge: 'Execution failed',
        heading: 'The replacement action did not become a pass',
        next: 'Use the Playwright failure and captured evidence to investigate actionability or product behavior.',
      };
    case 'observed':
      return {
        badge: 'Observed',
        heading: 'Locator drift was assessed without a successful execution',
        next: 'Review the assessment. No registry or source change has been applied.',
      };
  }
}

function candidateTable(candidate: AuditRankedCandidate): string {
  const eligibility =
    candidate.eligibility?.eligible === false
      ? candidate.eligibility.reasons.map(label).join(', ')
      : 'Semantically compatible';
  const signals = candidate.details
    .map(
      (detail) => `<tr>
        <th scope="row">${escapeHtml(label(detail.signal))}</th>
        <td>${percentage(detail.similarity)}</td>
        <td>${percentage(detail.weight)}</td>
        <td>${percentage(detail.contribution)}</td>
      </tr>`,
    )
    .join('');
  return `<li class="candidate">
    <div class="candidate-heading">
      <div>
        <span class="rank">#${String(candidate.rank)}</span>
        <strong>${escapeHtml(candidate.accessibleName ?? candidate.id)}</strong>
        ${candidate.rank === 1 ? '<span class="winner">Top candidate</span>' : ''}
      </div>
      <meter min="0" max="1" value="${String(candidate.score)}">${percentage(candidate.score)}</meter>
    </div>
    <p class="candidate-identity"><code>${escapeHtml(candidate.id)}</code> · ${escapeHtml(candidate.role ?? 'role unavailable')} · <code>&lt;${escapeHtml(candidate.tag)}&gt;</code> · ${percentage(candidate.score)}</p>
    <p class="candidate-eligibility">${escapeHtml(eligibility)}</p>
    <details>
      <summary>Scoring signals</summary>
      <div class="table-scroll"><table>
        <thead><tr><th>Signal</th><th>Match</th><th>Weight</th><th>Contribution</th></tr></thead>
        <tbody>${signals}</tbody>
      </table></div>
    </details>
  </li>`;
}

function screenshotReferences(execution: HealingExecutionAuditEvent | undefined): string {
  if (execution === undefined || execution.screenshots.length === 0) {
    return '<span class="muted">No screenshot reference was recorded.</span>';
  }
  return `<ul class="evidence-list">${execution.screenshots
    .map(
      (screenshot) =>
        `<li><span class="pill">${escapeHtml(screenshot.phase)}</span><code>${escapeHtml(screenshot.path)}</code></li>`,
    )
    .join('')}</ul>`;
}

function timeline(
  event: HealingAuditEvent,
  execution: HealingExecutionAuditEvent | undefined,
  outcome: ReportOutcome,
): string {
  const candidate = event.rankedCandidates[0];
  const decision =
    candidate === undefined
      ? 'No action-compatible candidate was available.'
      : `${candidate.accessibleName ?? candidate.id} ranked first at ${percentage(candidate.score)} with a ${percentage(event.assessment.margin)} lead.`;
  const final =
    execution === undefined
      ? outcome === 'protected'
        ? 'Policy kept this target proposal-only; no replacement executed.'
        : 'No replacement execution was recorded.'
      : execution.status === 'succeeded'
        ? `Guarded execution revalidated and used ${execution.candidateId}.`
        : `Execution ended ${execution.status}: ${label(execution.reason)}.`;
  return `<ol class="timeline">
    <li><span>1</span><div><strong>Primary locator</strong><p>The registered locator timed out, was never observed attached, and remained absent.</p></div></li>
    <li><span>2</span><div><strong>Candidate decision</strong><p>${escapeHtml(decision)}</p></div></li>
    <li><span>3</span><div><strong>${outcome === 'healed' ? 'Guarded result' : 'Safe boundary'}</strong><p>${escapeHtml(final)}</p></div></li>
  </ol>`;
}

function assessmentCard(
  event: HealingAuditEvent,
  execution: HealingExecutionAuditEvent | undefined,
): string {
  const outcome = assessmentOutcome(event, execution);
  const copy = outcomeCopy(outcome);
  const topScore = event.rankedCandidates[0]?.score;
  const reasons = event.assessment.semanticRejectionReasons?.map(label).join(', ');
  const searchText = [
    event.targetKey,
    event.action,
    outcome,
    event.assessment.reason,
    reasons ?? '',
    ...event.rankedCandidates.map((candidate) => candidate.accessibleName ?? candidate.id),
  ]
    .join(' ')
    .toLowerCase();
  const candidates =
    event.rankedCandidates.length === 0
      ? '<div class="empty-state compact"><strong>No compatible candidates</strong><p>The action-compatible collection was empty.</p></div>'
      : `<ol class="candidate-list">${event.rankedCandidates.slice(0, 10).map(candidateTable).join('')}</ol>`;

  return `<article class="event-card tone-${outcome}" data-event-card data-target="${escapeHtml(event.targetKey.toLowerCase())}" data-action="${escapeHtml(event.action.toLowerCase())}" data-outcome="${outcome}" data-reason="${escapeHtml(event.assessment.reason.toLowerCase())}" data-search="${escapeHtml(searchText)}">
    <div class="event-heading">
      <div>
        <p class="eyebrow">${escapeHtml(event.action)} · ${escapeHtml(event.mode)}</p>
        <h3>${escapeHtml(event.targetKey)}</h3>
        <p class="event-summary">${escapeHtml(copy.heading)}</p>
      </div>
      <span class="status ${outcome}">${escapeHtml(copy.badge)}</span>
    </div>
    ${timeline(event, execution, outcome)}
    <dl class="details">
      <div><dt>Primary locator</dt><dd><code>${escapeHtml(locatorText(event.primaryLocator))}</code></dd></div>
      <div><dt>Decision reason</dt><dd>${escapeHtml(label(event.assessment.reason))}</dd></div>
      <div><dt>Top confidence</dt><dd>${topScore === undefined ? 'Not available' : percentage(topScore)} <span class="threshold">required ${percentage(event.assessment.confidenceThreshold)}</span></dd></div>
      <div><dt>Runner-up margin</dt><dd>${percentage(event.assessment.margin)} <span class="threshold">required ${percentage(event.assessment.minimumScoreMargin)}</span></dd></div>
      <div><dt>Execution policy</dt><dd>${escapeHtml(label(event.executionPolicy?.risk ?? 'automatic'))}</dd></div>
      <div><dt>Semantic gate</dt><dd>${escapeHtml(reasons ?? (event.assessment.eligible ? 'Passed' : 'No explicit contradiction recorded'))}</dd></div>
    </dl>
    <details class="candidate-disclosure">
      <summary>Compare ranked candidates (${String(event.rankedCandidates.length)})</summary>
      ${candidates}
    </details>
    <details>
      <summary>Evidence references</summary>
      ${screenshotReferences(execution)}
    </details>
    <aside class="next-action" aria-label="What should I do next?">
      <strong>What should I do next?</strong>
      <p>${escapeHtml(copy.next)}</p>
    </aside>
  </article>`;
}

function emptyState(message: string, next: string): string {
  return `<div class="empty-state"><span aria-hidden="true">✓</span><div><strong>No Healwright drift evidence</strong><p>${escapeHtml(message)}</p><p><b>Next:</b> ${escapeHtml(next)}</p></div></div>`;
}

function trustPanel(trust: ReportEvidenceTrust): string {
  switch (trust.level) {
    case 'validated':
      return `<div class="trust validated"><span aria-hidden="true">✓</span><div><strong>Evidence validated</strong><p>History and summary are internally consistent. No integrity manifest was supplied, so authentication was not checked.</p></div></div>`;
    case 'integrity':
      return `<div class="trust integrity"><span aria-hidden="true">◇</span><div><strong>Evidence integrity verified</strong><p>The unsigned SHA-256 manifest matches this history and summary. Integrity is verified; signer identity is not authenticated.</p></div></div>`;
    case 'authenticated':
      return `<div class="trust authenticated"><span aria-hidden="true">◆</span><div><strong>Evidence authenticated</strong><p>The manifest and evidence match an HMAC key identified as <code>${escapeHtml(trust.keyId)}</code>. Shared-key authentication is not public-key non-repudiation.</p></div></div>`;
  }
}

function runOutcome(
  assessments: readonly HealingAuditEvent[],
  executions: readonly HealingExecutionAuditEvent[],
): { readonly tone: string; readonly label: string; readonly detail: string } {
  if (executions.some((event) => event.status === 'failed')) {
    return {
      tone: 'failed',
      label: 'Action failure preserved',
      detail: 'A replacement action failed and remains a meaningful Playwright failure.',
    };
  }
  const succeeded = executions.filter((event) => event.status === 'succeeded').length;
  if (succeeded > 0) {
    return {
      tone: 'healed',
      label: 'Passed with healing — review required',
      detail: `${String(succeeded)} guarded replacement ${succeeded === 1 ? 'action was' : 'actions were'} executed and recorded visibly.`,
    };
  }
  if (assessments.some((event) => event.modeDecision === 'rejected')) {
    return {
      tone: 'rejected',
      label: 'Locator drift rejected safely',
      detail: 'Healwright found no uniquely safe replacement and did not hide the failure.',
    };
  }
  if (assessments.length > 0) {
    return {
      tone: 'observed',
      label: 'Locator drift observed',
      detail: 'Evidence was collected without a successful replacement execution.',
    };
  }
  return {
    tone: 'ordinary',
    label: 'No locator drift evidence',
    detail:
      'Healwright recorded no recovery attempt. Ordinary test results remain in the Playwright report.',
  };
}

function selectOptions(values: readonly string[]): string {
  return [...new Set(values)]
    .sort()
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(label(value))}</option>`)
    .join('');
}

export function renderReportViewer(
  events: readonly HealwrightAuditEvent[],
  summary: AuditEvidenceSummary,
  options: RenderReportViewerOptions = {},
): string {
  if (!isDeepStrictEqual(createAuditEvidenceSummary(events, summary.generatedAt), summary)) {
    throw new AuditEvidenceError('report summary does not match the supplied events');
  }
  const title = options.title ?? 'Healwright evidence report';
  const trust = options.evidenceTrust ?? { level: 'validated' };
  const assessments = events.filter(
    (event): event is HealingAuditEvent => event.eventType === 'locator-drift-assessed',
  );
  const executions = events.filter(
    (event): event is HealingExecutionAuditEvent => event.eventType === 'locator-heal-execution',
  );
  const executionByParent = new Map(executions.map((event) => [event.parentEventId, event]));
  const outcomes = assessments.map((event) =>
    assessmentOutcome(event, executionByParent.get(event.eventId)),
  );
  const cards = assessments
    .map((event) => assessmentCard(event, executionByParent.get(event.eventId)))
    .join('');
  const overall = runOutcome(assessments, executions);
  const cspHash = createHash('sha256').update(FILTER_SCRIPT, 'utf8').digest('base64');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${cspHash}'; base-uri 'none'; form-action 'none'" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color: #172523; background: #f4f6f5; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-synthesis: none; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      button, input, select { font: inherit; }
      button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid #75b9ae; outline-offset: 2px; }
      main { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 2.5rem 0 5rem; }
      h1, h2, h3, p { margin-top: 0; }
      h1 { max-width: 18ch; margin-bottom: .65rem; font-size: clamp(2rem, 5vw, 3.5rem); letter-spacing: -.045em; line-height: 1.03; }
      h2 { margin: 2.4rem 0 1rem; font-size: 1.35rem; letter-spacing: -.015em; }
      h3 { margin-bottom: .35rem; font-size: 1.15rem; overflow-wrap: anywhere; }
      p { line-height: 1.55; }
      .hero, .filters, .event-card, .empty-state, .about { border: 1px solid #d8dfdd; background: #fff; }
      .hero { padding: clamp(1.4rem, 4vw, 2.5rem); border-radius: 1rem; box-shadow: 0 1rem 3rem rgb(29 54 49 / 6%); }
      .hero-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(250px, .8fr); gap: 2rem; align-items: start; }
      .subtitle { max-width: 50rem; color: #536461; }
      .eyebrow { margin-bottom: .4rem; color: #526966; font-size: .73rem; font-weight: 760; letter-spacing: .1em; text-transform: uppercase; }
      .release { display: inline-flex; padding: .35rem .65rem; border-radius: 999px; color: #375b56; background: #eaf2f0; font-size: .78rem; font-weight: 750; }
      .outcome { margin-top: 1.5rem; padding: 1.15rem 1.25rem; border-left: 4px solid #52746f; border-radius: .35rem .7rem .7rem .35rem; background: #f6f9f8; }
      .outcome.healed { border-color: #0d7667; background: #eef8f5; }
      .outcome.rejected { border-color: #a16616; background: #fff8ed; }
      .outcome.failed { border-color: #a53e45; background: #fff2f3; }
      .outcome strong { display: block; margin-bottom: .3rem; font-size: 1.05rem; }
      .outcome p, .trust p, .next-action p, .empty-state p { margin-bottom: 0; color: #566966; }
      .trust { display: grid; grid-template-columns: auto 1fr; gap: .8rem; padding: 1rem; border: 1px solid #d8dfdd; border-radius: .8rem; background: #fafcfc; }
      .trust > span { display: grid; width: 1.8rem; height: 1.8rem; place-items: center; border-radius: 50%; color: #fff; background: #526966; font-weight: 800; }
      .trust.integrity > span, .trust.authenticated > span { background: #0d7667; }
      .trust strong { display: block; margin-bottom: .25rem; }
      .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: .7rem; margin-top: 1.4rem; }
      .metric { padding: .9rem 1rem; border: 1px solid #dde4e2; border-radius: .7rem; background: #fafcfc; }
      .metric strong { display: block; margin-top: .25rem; font-size: 1.3rem; }
      .metric.generated strong { font-size: .92rem; overflow-wrap: anywhere; }
      .metric span { color: #60716e; font-size: .78rem; }
      .filters { padding: 1rem; border-radius: .85rem; }
      .filter-grid { display: grid; grid-template-columns: minmax(220px, 1.5fr) repeat(3, minmax(145px, .7fr)) auto; gap: .75rem; align-items: end; }
      .field label { display: block; margin-bottom: .3rem; color: #50625f; font-size: .78rem; font-weight: 720; }
      .field input, .field select { width: 100%; min-height: 2.65rem; padding: .55rem .65rem; border: 1px solid #bfcac7; border-radius: .45rem; color: #172523; background: #fff; }
      .clear { min-height: 2.65rem; padding: .55rem .8rem; border: 1px solid #aebcb8; border-radius: .45rem; color: #24443f; background: #eef4f2; cursor: pointer; font-weight: 700; }
      .filter-status { margin: .75rem 0 0; color: #60716e; font-size: .85rem; }
      .grid { display: grid; gap: 1rem; }
      .event-card { padding: clamp(1.1rem, 3vw, 1.55rem); border-radius: .9rem; border-top: 4px solid #80918e; }
      .event-card.tone-healed { border-top-color: #0d7667; }
      .event-card.tone-rejected, .event-card.tone-protected { border-top-color: #a16616; }
      .event-card.tone-failed { border-top-color: #a53e45; }
      .event-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
      .event-summary { margin-bottom: 0; color: #5c6d6a; }
      .status, .pill, .winner, .rank { display: inline-flex; align-items: center; border-radius: 999px; font-size: .73rem; font-weight: 760; }
      .status { padding: .4rem .65rem; text-transform: uppercase; white-space: nowrap; }
      .status.healed { color: #075f52; background: #e1f4ef; }
      .status.rejected, .status.protected { color: #75470b; background: #fff0d5; }
      .status.failed { color: #842d34; background: #ffe4e6; }
      .status.observed { color: #405653; background: #eaf0ef; }
      .timeline { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin: 1.4rem 0; padding: 0; list-style: none; }
      .timeline li { position: relative; display: grid; grid-template-columns: auto 1fr; gap: .65rem; padding-right: 1rem; }
      .timeline li:not(:last-child)::after { position: absolute; top: .85rem; right: .2rem; left: 2.15rem; height: 1px; background: #d4ddda; content: ''; }
      .timeline li > span { z-index: 1; display: grid; width: 1.75rem; height: 1.75rem; place-items: center; border: 1px solid #aebbb8; border-radius: 50%; background: #fff; font-size: .75rem; font-weight: 800; }
      .timeline strong { font-size: .85rem; }
      .timeline p { margin: .25rem 0 0; color: #627370; font-size: .82rem; }
      .details { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .85rem; margin: 1.2rem 0; padding: 1rem; border-radius: .7rem; background: #f7f9f8; }
      .details div { min-width: 0; }
      dt { margin-bottom: .25rem; color: #657673; font-size: .7rem; font-weight: 760; letter-spacing: .06em; text-transform: uppercase; }
      dd { margin: 0; overflow-wrap: anywhere; line-height: 1.45; }
      .threshold { display: block; color: #657673; font-size: .78rem; }
      code { padding: .12rem .3rem; border-radius: .3rem; color: #24443f; background: #eaf0ee; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .84em; overflow-wrap: anywhere; }
      details { border-top: 1px solid #e2e8e6; padding-top: .8rem; }
      details + details { margin-top: .8rem; }
      summary { cursor: pointer; color: #344d49; font-weight: 730; }
      .candidate-list { display: grid; gap: .75rem; margin: .9rem 0 0; padding: 0; list-style: none; }
      .candidate { padding: .9rem; border: 1px solid #dce4e1; border-radius: .65rem; background: #fafcfc; }
      .candidate-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
      .candidate-heading > div { display: flex; flex-wrap: wrap; gap: .45rem; align-items: center; }
      .rank, .winner, .pill { padding: .2rem .45rem; color: #405653; background: #e9efed; }
      .winner { color: #075f52; background: #ddf2ec; }
      meter { width: min(190px, 35vw); accent-color: #0d7667; }
      .candidate-identity, .candidate-eligibility { margin: .55rem 0 0; color: #60716e; font-size: .83rem; }
      .table-scroll { overflow-x: auto; }
      table { width: 100%; margin-top: .7rem; border-collapse: collapse; font-size: .8rem; }
      th, td { padding: .45rem; border-bottom: 1px solid #e0e7e5; text-align: left; }
      th { color: #526461; }
      .evidence-list { margin-bottom: 0; padding-left: 1.2rem; }
      .evidence-list li { margin: .45rem 0; }
      .evidence-list .pill { margin-right: .4rem; }
      .next-action { margin-top: 1rem; padding: .9rem 1rem; border-left: 3px solid #6f918b; background: #f4f8f7; }
      .next-action strong { display: block; margin-bottom: .2rem; }
      .empty-state { display: grid; grid-template-columns: auto 1fr; gap: .8rem; padding: 1.25rem; border-radius: .8rem; }
      .empty-state > span { display: grid; width: 1.9rem; height: 1.9rem; place-items: center; border-radius: 50%; color: #fff; background: #52746f; font-weight: 800; }
      .empty-state.compact { margin-top: .8rem; background: #fafcfc; }
      .empty-state.compact > span { display: none; }
      .muted { color: #657673; font-size: .85rem; }
      [hidden] { display: none !important; }
      .about { margin-top: 2.3rem; padding: 1.2rem; border-radius: .8rem; color: #5a6c68; font-size: .88rem; }
      .about strong { color: #293f3b; }
      footer { margin-top: 1.2rem; color: #687976; font-size: .78rem; text-align: center; }
      @media (max-width: 900px) { .hero-grid { grid-template-columns: 1fr; } .filter-grid { grid-template-columns: repeat(2, 1fr); } .filter-grid .field:first-child { grid-column: 1 / -1; } .details { grid-template-columns: repeat(2, 1fr); } .timeline { grid-template-columns: 1fr; gap: .8rem; } .timeline li:not(:last-child)::after { top: 1.75rem; bottom: -.8rem; left: .85rem; width: 1px; height: auto; } }
      @media (max-width: 620px) { main { width: min(100% - 1rem, 1180px); padding-top: .5rem; } .hero { border-radius: .75rem; } .filter-grid, .details { grid-template-columns: 1fr; } .filter-grid .field:first-child { grid-column: auto; } .event-heading, .candidate-heading { align-items: flex-start; flex-direction: column; } meter { width: 100%; } .status { white-space: normal; } }
      @media print { body { background: #fff; } .filters, .clear { display: none; } main { width: 100%; padding: 0; } .hero, .event-card { box-shadow: none; break-inside: avoid; } }
    </style>
  </head>
  <body>
    <main>
      <header class="hero">
        <div class="hero-grid">
          <div>
            <p class="eyebrow">Deterministic locator evidence</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="subtitle">A local report of what Healwright assessed, rejected, or executed. It never changes tests or locator registries.</p>
            <span class="release">v1.0.0 evaluation release</span>
            <div class="outcome ${overall.tone}">
              <strong>${escapeHtml(overall.label)}</strong>
              <p>${escapeHtml(overall.detail)}</p>
            </div>
          </div>
          ${trustPanel(trust)}
        </div>
        <div class="metrics">
          <div class="metric generated"><span>Generated</span><strong>${escapeHtml(summary.generatedAt)}</strong></div>
          <div class="metric"><span>Assessments</span><strong>${String(summary.events.assessments)}</strong></div>
          <div class="metric"><span>Successful heals</span><strong>${String(summary.executions.succeeded)}</strong></div>
          <div class="metric"><span>Rejected</span><strong>${String(summary.decisions.rejected)}</strong></div>
          <div class="metric"><span>Execution failures</span><strong>${String(summary.executions.failed)}</strong></div>
        </div>
      </header>
      <section aria-labelledby="events-heading">
        <h2 id="events-heading">Decision timeline</h2>
        ${
          assessments.length === 0
            ? emptyState(
                'No locator drift assessment was recorded. This does not replace the ordinary Playwright report.',
                'No Healwright action is required.',
              )
            : `<form class="filters" data-report-filters>
              <div class="filter-grid">
                <div class="field"><label for="search">Search target or evidence</label><input id="search" name="search" type="search" autocomplete="off" placeholder="checkout.applyDiscount" /></div>
                <div class="field"><label for="action">Action</label><select id="action" name="action"><option value="">All actions</option>${selectOptions(assessments.map((event) => event.action))}</select></div>
                <div class="field"><label for="outcome">Outcome</label><select id="outcome" name="outcome"><option value="">All outcomes</option>${selectOptions(outcomes)}</select></div>
                <div class="field"><label for="reason">Decision reason</label><select id="reason" name="reason"><option value="">All reasons</option>${selectOptions(assessments.map((event) => event.assessment.reason))}</select></div>
                <button class="clear" type="button" data-clear-filters>Clear</button>
              </div>
              <p class="filter-status" role="status" aria-live="polite"><span data-visible-count>${String(assessments.length)}</span> of ${String(assessments.length)} decisions shown</p>
              <noscript><p class="filter-status">Filtering requires JavaScript; all validated evidence remains visible below.</p></noscript>
            </form>
            <div class="grid" style="margin-top: 1rem">${cards}</div>
            <div class="empty-state" data-filter-empty hidden><span aria-hidden="true">i</span><div><strong>No matching decisions</strong><p>Clear or broaden the local filters. The evidence has not been changed.</p></div></div>`
        }
      </section>
      <aside class="about">
        <strong>About this report:</strong> Healwright evidence explains locator-recovery behavior only. Test intent, assertions, business correctness, authentication, data, APIs, and network behavior remain owned by Playwright tests and product reviewers. Validated evidence is not the same as authenticated evidence, and a healed pass still requires review.
      </aside>
      <footer>Generated locally by Healwright · no remote scripts, telemetry, or automatic source changes</footer>
    </main>
    <script>${FILTER_SCRIPT}</script>
  </body>
</html>
`;
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

async function resolveEvidenceTrust(
  options: GenerateReportViewerOptions,
): Promise<ReportEvidenceTrust> {
  if (options.manifestPath === undefined) {
    if (
      options.key !== undefined ||
      options.expectedKeyId !== undefined ||
      options.requireAuthenticated === true
    ) {
      throw new AuditEvidenceError('report authentication options require manifestPath');
    }
    return options.evidenceTrust ?? { level: 'validated' };
  }
  if (options.evidenceTrust !== undefined) {
    throw new AuditEvidenceError('evidenceTrust cannot override a verified manifest');
  }
  const manifestPath = resolve(options.manifestPath);
  const verified = await verifyEvidenceManifest({
    manifestPath,
    ...(options.requireAuthenticated === undefined
      ? {}
      : { requireAuthenticated: options.requireAuthenticated }),
    ...(options.key === undefined ? {} : { key: options.key }),
    ...(options.expectedKeyId === undefined ? {} : { expectedKeyId: options.expectedKeyId }),
  });
  const manifestDirectory = dirname(manifestPath);
  if (
    resolve(options.historyPath) !== resolve(manifestDirectory, verified.manifest.files[0].path) ||
    resolve(options.summaryPath) !== resolve(manifestDirectory, verified.manifest.files[1].path)
  ) {
    throw new AuditEvidenceError('report inputs do not match the verified evidence manifest');
  }
  return verified.authenticated
    ? {
        level: 'authenticated',
        keyId: verified.manifest.authentication?.keyId ?? 'unknown',
      }
    : { level: 'integrity' };
}

export async function generateReportViewer(
  options: GenerateReportViewerOptions,
): Promise<GeneratedReportViewer> {
  const [historyContents, summaryContents, evidenceTrust] = await Promise.all([
    readFile(options.historyPath, 'utf8'),
    readFile(options.summaryPath, 'utf8'),
    resolveEvidenceTrust(options),
  ]);
  const events = parseAuditHistory(historyContents);
  const summary = parseSummary(summaryContents, events);
  const outputDirectory = resolve(options.outputDirectory);
  const indexPath = join(outputDirectory, 'index.html');

  try {
    const outputMetadata = await lstat(outputDirectory);
    if (outputMetadata.isSymbolicLink() || !outputMetadata.isDirectory()) {
      throw new Error(
        `Report output must be a directory and cannot be a symbolic link: ${outputDirectory}`,
      );
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  if (options.force !== true) {
    try {
      await access(indexPath);
      throw new Error(
        `Refusing to overwrite existing report "${indexPath}"; pass --force to replace it`,
      );
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  } else {
    try {
      if ((await lstat(indexPath)).isSymbolicLink()) {
        throw new Error(`Refusing to overwrite symbolic link "${indexPath}"`);
      }
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(indexPath, renderReportViewer(events, summary, { ...options, evidenceTrust }), {
    encoding: 'utf8',
    flag: options.force === true ? 'w' : 'wx',
  });
  return {
    indexPath,
    eventCount: events.length,
    successfulHealingCount: summary.executions.succeeded,
    evidenceTrust,
  };
}
