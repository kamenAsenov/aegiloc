import { access, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { HealwrightAuditEvent, HealingAuditEvent } from './audit.js';
import { createAuditEvidenceSummary, type AuditEvidenceSummary } from './evidence.js';
import { AuditEvidenceError } from './errors.js';
import { parseAuditHistory } from './proposals.js';
import type { PrimaryLocatorDefinition } from './types.js';

export interface RenderReportViewerOptions {
  readonly title?: string;
}

export interface GenerateReportViewerOptions extends RenderReportViewerOptions {
  readonly historyPath: string;
  readonly summaryPath: string;
  readonly outputDirectory: string;
  readonly force?: boolean;
}

export interface GeneratedReportViewer {
  readonly indexPath: string;
  readonly eventCount: number;
  readonly successfulHealingCount: number;
}

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

function candidateText(event: HealingAuditEvent): string {
  const candidate = event.rankedCandidates[0];
  if (candidate === undefined) return 'No compatible candidate collected';
  if (candidate.role !== undefined && candidate.accessibleName !== undefined) {
    return `role=${candidate.role}, name=${JSON.stringify(candidate.accessibleName)}`;
  }
  return candidate.id;
}

function scoreText(event: HealingAuditEvent): string {
  const score = event.rankedCandidates[0]?.score;
  return score === undefined ? 'Not available' : `${(score * 100).toFixed(1)}%`;
}

function screenshotReferences(event: HealwrightAuditEvent): string {
  if (event.eventType !== 'locator-heal-execution' || event.screenshots.length === 0) {
    return '<span class="muted">No screenshot reference</span>';
  }
  return event.screenshots
    .map(
      (screenshot) =>
        `<li><span class="pill">${escapeHtml(screenshot.phase)}</span> <code>${escapeHtml(screenshot.path)}</code></li>`,
    )
    .join('');
}

function assessmentCard(event: HealingAuditEvent): string {
  const tone = event.modeDecision === 'eligible' ? 'success' : 'warning';
  const candidates = event.rankedCandidates.slice(0, 5);
  const ranked =
    candidates.length === 0
      ? '<p class="empty">No action-compatible candidates were collected.</p>'
      : `<ol class="ranked">${candidates
          .map(
            (candidate) => `<li>
              <div><strong>${escapeHtml(candidate.accessibleName ?? candidate.id)}</strong></div>
              <div class="candidate-meta"><code>${escapeHtml(candidate.id)}</code> · ${(candidate.score * 100).toFixed(1)}% · ${escapeHtml(candidate.eligibility?.eligible === false ? candidate.eligibility.reasons.join(', ') : 'semantically compatible')}</div>
            </li>`,
          )
          .join('')}</ol>`;

  return `<article class="assessment">
    <div class="assessment-heading">
      <div>
        <p class="eyebrow">${escapeHtml(event.action)} · ${escapeHtml(event.mode)}</p>
        <h3>${escapeHtml(event.targetKey)}</h3>
      </div>
      <span class="status ${tone}">${escapeHtml(event.modeDecision)}</span>
    </div>
    <dl class="details">
      <div><dt>Original selector</dt><dd><code>${escapeHtml(locatorText(event.primaryLocator))}</code></dd></div>
      <div><dt>Top candidate</dt><dd>${escapeHtml(candidateText(event))}</dd></div>
      <div><dt>Decision reason</dt><dd>${escapeHtml(event.assessment.reason)}</dd></div>
      <div><dt>Confidence</dt><dd>${scoreText(event)} · margin ${(event.assessment.margin * 100).toFixed(1)}%</dd></div>
    </dl>
    <details><summary>Ranked candidates (${String(event.rankedCandidates.length)})</summary>${ranked}</details>
  </article>`;
}

function executionCard(event: HealwrightAuditEvent): string {
  if (event.eventType !== 'locator-heal-execution') return '';
  return `<article class="execution">
    <div>
      <p class="eyebrow">${escapeHtml(event.action)} · ${escapeHtml(event.reason)}</p>
      <h3>${escapeHtml(event.targetKey)}</h3>
      <p><code>${escapeHtml(event.candidateId)}</code></p>
    </div>
    <ul class="evidence">${screenshotReferences(event)}</ul>
  </article>`;
}

function emptyState(message: string): string {
  return `<div class="empty-state"><strong>Nothing to show</strong><p>${escapeHtml(message)}</p></div>`;
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
  const assessments = events.filter(
    (event): event is HealingAuditEvent => event.eventType === 'locator-drift-assessed',
  );
  const successful = events.filter(
    (event) => event.eventType === 'locator-heal-execution' && event.status === 'succeeded',
  );
  const unsuccessfulExecutions = events.filter(
    (event) => event.eventType === 'locator-heal-execution' && event.status !== 'succeeded',
  );
  const rejectedOrProtected = assessments.filter(
    (event) =>
      event.modeDecision === 'rejected' ||
      event.modeDecision === 'strict-ci-failure' ||
      event.executionPolicy?.automaticExecutionAllowed === false,
  );
  const scored = assessments.flatMap((event) => {
    const score = event.rankedCandidates[0]?.score;
    return score === undefined ? [] : [score];
  });
  const averageConfidence =
    scored.length === 0
      ? 'No scored candidates'
      : `${((scored.reduce((total, score) => total + score, 0) / scored.length) * 100).toFixed(1)}% average`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color: #1c2925; background: #f3f6f4; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-synthesis: none; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      main { width: min(1120px, calc(100% - 2rem)); margin: 0 auto; padding: 3rem 0 5rem; }
      header { padding: 2rem; border: 1px solid #d8e0db; border-radius: 1rem; background: #fff; box-shadow: 0 1rem 3rem rgb(34 54 46 / 7%); }
      h1, h2, h3, p { margin-top: 0; }
      h1 { margin-bottom: .6rem; font-size: clamp(2rem, 5vw, 3.25rem); letter-spacing: -.04em; }
      h2 { margin: 2.5rem 0 1rem; font-size: 1.35rem; }
      h3 { margin-bottom: .35rem; font-size: 1rem; }
      .subtitle { max-width: 48rem; color: #52645c; line-height: 1.6; }
      .eyebrow { margin-bottom: .35rem; color: #61756c; font-size: .72rem; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
      .preview { display: inline-flex; margin-top: .5rem; padding: .35rem .6rem; border-radius: 999px; color: #4d5e56; background: #edf2ef; font-size: .78rem; font-weight: 700; }
      .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: .75rem; margin-top: 1.5rem; }
      .metric { padding: 1rem; border: 1px solid #dce4df; border-radius: .75rem; background: #fafcfb; }
      .metric strong { display: block; margin-top: .3rem; font-size: 1.45rem; }
      .metric span { color: #66786f; font-size: .8rem; }
      .grid { display: grid; gap: .9rem; }
      .assessment, .execution, .empty-state { padding: 1.25rem; border: 1px solid #d8e0db; border-radius: .85rem; background: #fff; }
      .assessment-heading, .execution { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
      .status, .pill { display: inline-flex; align-items: center; border-radius: 999px; font-size: .76rem; font-weight: 750; }
      .status { padding: .38rem .65rem; text-transform: uppercase; }
      .status.success { color: #126342; background: #e5f4ec; }
      .status.warning { color: #805111; background: #fff1d6; }
      .pill { padding: .2rem .45rem; color: #4d5e56; background: #edf2ef; }
      .details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .8rem; margin: 1rem 0; }
      .details div { min-width: 0; }
      dt { margin-bottom: .25rem; color: #66786f; font-size: .75rem; font-weight: 700; text-transform: uppercase; }
      dd { margin: 0; overflow-wrap: anywhere; line-height: 1.45; }
      code { padding: .12rem .3rem; border-radius: .3rem; color: #32483f; background: #edf2ef; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .84em; overflow-wrap: anywhere; }
      details { border-top: 1px solid #e5ebe7; padding-top: .85rem; }
      summary { cursor: pointer; color: #42564d; font-weight: 700; }
      .ranked { margin-bottom: 0; padding-left: 1.4rem; }
      .ranked li { padding: .6rem .2rem; }
      .candidate-meta, .muted { color: #6a7b73; font-size: .86rem; }
      .evidence { margin: 0; padding-left: 1.1rem; }
      .evidence li { margin-bottom: .45rem; }
      .empty, .empty-state p { margin-bottom: 0; color: #6a7b73; }
      footer { margin-top: 2.5rem; color: #6a7b73; font-size: .82rem; line-height: 1.6; }
      @media (max-width: 680px) { main { padding-top: 1rem; } header { padding: 1.25rem; } .details { grid-template-columns: 1fr; } .assessment-heading, .execution { display: block; } .status { margin-top: .5rem; } .evidence { margin-top: 1rem; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <p class="eyebrow">Deterministic locator evidence</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="subtitle">A local, static view of reviewed Healwright audit evidence. It reports what the framework assessed and executed; it does not change tests or locator registries.</p>
        <span class="preview">v0.7.0 Technical Preview · not production-ready</span>
        <div class="metrics">
          <div class="metric"><span>Generated</span><strong>${escapeHtml(summary.generatedAt)}</strong></div>
          <div class="metric"><span>Total assessments</span><strong>${String(summary.events.assessments)}</strong></div>
          <div class="metric"><span>Safe heals</span><strong>${String(summary.executions.succeeded)}</strong></div>
          <div class="metric"><span>Rejected assessments</span><strong>${String(summary.decisions.rejected)}</strong></div>
          <div class="metric"><span>Protected or blocked</span><strong>${String(rejectedOrProtected.length + unsuccessfulExecutions.length)}</strong></div>
          <div class="metric"><span>Candidate confidence</span><strong>${escapeHtml(averageConfidence)}</strong></div>
        </div>
      </header>

      <section aria-labelledby="assessments-heading">
        <h2 id="assessments-heading">Assessments</h2>
        <div class="grid">${assessments.length === 0 ? emptyState('No locator drift assessments were recorded for this run.') : assessments.map(assessmentCard).join('')}</div>
      </section>

      <section aria-labelledby="successful-heading">
        <h2 id="successful-heading">Successful heals</h2>
        <div class="grid">${successful.length === 0 ? emptyState('No replacement locator was executed.') : successful.map(executionCard).join('')}</div>
      </section>

      <section aria-labelledby="rejected-heading">
        <h2 id="rejected-heading">Rejected and protected</h2>
        <div class="grid">${rejectedOrProtected.length + unsuccessfulExecutions.length === 0 ? emptyState('No assessment or execution was rejected, blocked, or protected by policy.') : `${rejectedOrProtected.map(assessmentCard).join('')}${unsuccessfulExecutions.map(executionCard).join('')}`}</div>
      </section>

      <footer>
        <strong>Safety boundary:</strong> this report is evidence, not approval. A human still owns test intent, product correctness, and any registry change. Healwright deliberately fails closed when evidence is weak, contradictory, or ambiguous.
      </footer>
    </main>
  </body>
</html>
`;
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

export async function generateReportViewer(
  options: GenerateReportViewerOptions,
): Promise<GeneratedReportViewer> {
  const [historyContents, summaryContents] = await Promise.all([
    readFile(options.historyPath, 'utf8'),
    readFile(options.summaryPath, 'utf8'),
  ]);
  const events = parseAuditHistory(historyContents);
  const summary = parseSummary(summaryContents, events);
  const outputDirectory = resolve(options.outputDirectory);
  const indexPath = join(outputDirectory, 'index.html');

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
  await writeFile(indexPath, renderReportViewer(events, summary, options), {
    encoding: 'utf8',
    flag: options.force === true ? 'w' : 'wx',
  });
  return {
    indexPath,
    eventCount: events.length,
    successfulHealingCount: summary.executions.succeeded,
  };
}
