# Product positioning

## Honest description

Healwright is an experimental but serious deterministic self-healing layer for Playwright Test. The
v0.6.0 Technical Preview is a pre-1.0 open-source portfolio project focused on safe locator-drift
recovery, inspectable evidence, human-reviewed proposals, local CLI onboarding, a static evidence
viewer, and CI governance.

It is not presented as proof of production adoption, commercial traction, enterprise use, or a
replacement for sound test design.

## Intended users

- SDETs and test architects evaluating conservative locator-recovery patterns;
- Playwright teams that want deterministic, reviewable behavior rather than opaque automation;
- QA leads exploring evidence, policy, and false-positive risk around self-healing;
- TypeScript engineers interested in strict framework and package design;
- hiring managers reviewing practical automation architecture and engineering judgment.

## Value proposition

Healwright demonstrates that locator recovery can be bounded by explicit contracts:

- semantic targets and policies are reviewed as JSON;
- ordinary Playwright behavior stays on the primary path;
- missing-locator proof is distinct from actionability and application failure;
- scoring is fixed, deterministic, and inspectable;
- guarded execution requires confidence, separation, semantic identity, and fresh agreement;
- evidence, proposals, and governance make exceptional passes visible and reviewable.
- a deterministic local demo and zero-dependency report viewer make those boundaries practical to
  evaluate without a hosted service.

## Non-goals

Healwright is not:

- a general-purpose AI testing agent;
- a visual-diff, OCR, or computer-vision system;
- an assertion, business-logic, authentication, API, or test-data healer;
- an automatic test or registry rewriter;
- a hosted platform, database, live dashboard, or long-term artifact store;
- a claim that selectors no longer need engineering ownership;
- a mature v1 compatibility contract.

## Compared with naive self-healing

| Concern           | Naive approach                           | Healwright approach                                   |
| ----------------- | ---------------------------------------- | ----------------------------------------------------- |
| Trigger           | Any locator/action failure               | Proven missing primary locator only                   |
| Selection         | First plausible or opaque recommendation | Deterministic ranking plus mandatory semantic gates   |
| Ambiguity         | May choose the nearest candidate         | Requires confidence and a safe runner-up margin       |
| Runtime changes   | May rewrite selectors automatically      | Produces review-required proposals only               |
| High-risk actions | Treats all clicks similarly              | Per-target `automatic` or `proposal-only` risk        |
| Visibility        | Passing retry may look ordinary          | `PASSED_WITH_HEALING`, JSON evidence, and screenshots |
| CI control        | Often only pass/fail                     | Budgets, baselines, exact waivers, and health output  |

This comparison describes design patterns rather than attacking specific tools. Other products may
make different valid tradeoffs.

## Product maturity

The repository is ready to show and evaluate as a technical preview. It has extensive automated
coverage, a runnable demo, and conservative boundaries, but is still Chromium-first, unpublished,
and pre-1.0. The roadmap deliberately places cross-browser qualification, authenticated evidence,
supply-chain work, benchmarks, and API stabilization before v1.0.
