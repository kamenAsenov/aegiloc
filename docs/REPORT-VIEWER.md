# Static report viewer

The v0.7 report viewer turns canonical Healwright JSONL history and its matching summary into one
self-contained `index.html`. It is a local developer artifact, not a hosted dashboard.

## Generate a report

```bash
pnpm build
node dist/cli.js view \
  --history test-results/healwright/history.jsonl \
  --summary test-results/healwright/summary.json \
  --out test-results/healwright/viewer
```

Add `--force` only when intentionally replacing an existing generated report.

## What it shows

- generation time and assessment totals;
- successful, rejected, and protected outcomes;
- average top-candidate confidence when scores exist;
- original locator, top candidate identity, decision, reason, margin, and ranked candidates;
- successful execution identity and sanitized screenshot references;
- clear empty states when a run contains no relevant evidence.

The viewer does not present a healed pass as an ordinary pass. It repeats the technical-preview and
human-ownership boundaries in the page.

## Integrity and privacy

`view` uses the strict history parser and recomputes the canonical summary. Generation fails if the
provided summary is malformed, contains extra data, or differs from history.

For evidence-origin assurance, run `healwright verify` against the sibling manifest before opening
the viewer. Report generation validates content agreement but does not authenticate origin by
itself.

All evidence-derived strings are HTML escaped. The report contains embedded CSS, no JavaScript, no
remote assets, no telemetry, and no network requests after opening. Audit events already reject
absolute screenshot paths; the viewer renders retained artifact paths as references rather than
reading or embedding their contents.

The report can still contain target keys, accessible names, selector text, project names, commit
identifiers, and artifact paths. Treat it as potentially sensitive test evidence. Review it before
sharing and follow [security guidance](../SECURITY.md).

## Output and retention

Generated viewers belong under ignored output such as `test-results/`. They are not source files and
should not be committed by default. Delete them according to the same retention policy as the source
history and screenshots.

## Browser support

The output uses semantic HTML and responsive CSS and is intended for current desktop browsers. The
runtime's checked core behavior is qualified separately on Chromium, Firefox, and WebKit; see the
[qualification scope](CROSS-BROWSER-QUALIFICATION.md).
