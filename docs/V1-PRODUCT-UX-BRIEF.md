# v1 product and UX brief

## Product promise

Healwright is a deterministic, safety-first locator-drift layer for Playwright Test. Its local
product surface should help a reviewer answer three questions quickly: what happened, why was the
decision safe or rejected, and what human action is appropriate next.

The interface is evidence tooling, not a control plane. It never changes tests or registries and it
never turns an assertion, application, authentication, data, API, or network failure into a pass.

## First-user journey

### Discover

Within 20 seconds, the README explains the narrow locator-drift problem, the false-positive safety
priority, and the three possible paths: ordinary Playwright, a visible guarded heal, or a meaningful
rejection.

### Try

One documented repository command runs the deterministic realistic demo, verifies its evidence,
generates the local report, and prints an absolute path. Browser opening occurs only with an explicit
`--open` flag.

### Understand

The report leads with the run state and evidence trust level. A timeline connects primary failure,
candidate assessment, and execution or rejection. Candidate details explain confidence, required
margin, semantic eligibility, and individual scoring signals without hiding exact values.

### Adopt carefully

Short guides show a normal Playwright consumer, Page Object/fixture wiring, `automatic` versus
`proposal-only`, and the boundary between evidence and reviewed registry maintenance.

### Operate

Filters locate a target, action, outcome, or reason. Every outcome has a direct next step. CI
guidance covers evidence artifacts, retention, integrity/authentication, and sensitive text.

## Visual and interaction direction

- neutral light canvas, slate text, restrained teal accent, and system fonts;
- information hierarchy through spacing and borders rather than decoration;
- no remote assets, telemetry, fake charts, gradients, stock imagery, or dense dashboard chrome;
- semantic headings, labels, buttons, tables, disclosure controls, visible focus, and responsive
  layouts;
- plain-language conclusions first, exact technical evidence behind disclosure controls;
- all user-controlled evidence escaped before it reaches HTML, attributes, or script data.

## Acceptance criteria

1. The overview distinguishes no drift evidence, healed-with-review, rejected/protected, execution
   failure, evidence validated, integrity verified, and authenticated evidence.
2. “Validated” never implies authenticated; unsigned manifests are labeled integrity-only.
3. Each assessment shows primary locator, candidate decision, confidence threshold, actual margin,
   required margin, semantic rejection reasons, and linked execution outcome when present.
4. Ranked candidates expose accessible identity, tag, exact score, eligibility, and every weighted
   scoring signal.
5. Search and filters cover target, action, outcome, and decision reason; clearing filters is
   keyboard accessible and the visible result count updates.
6. Every state provides an outcome-specific next action without authorizing automatic source edits.
7. Empty and malformed inputs fail clearly. Existing reports are not overwritten without `--force`.
8. The report remains one self-contained offline HTML file with a restrictive CSP and no unsafe
   evidence injection.
9. The guided demo is deterministic, uses only local fixtures and public package APIs, and prints the
   report path even when opening is unavailable.
10. Automated tests cover rendering, filtering hooks, accessibility basics, trust messaging,
    escaping, overwrite behavior, demo errors, and conservative runtime regression boundaries.
