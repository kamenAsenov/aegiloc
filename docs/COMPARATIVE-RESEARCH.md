# Comparative research

This review informed Aegiloc v1.1. It records product patterns and public behavior, not copied
implementation. No third-party source code or branding was imported. The review was refreshed on
2026-08-24; external projects can change independently.

## Sources reviewed

| Project or guidance                                                                                  | Useful pattern                                                                                                                                                | Aegiloc decision                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Playwright locators](https://playwright.dev/docs/locators)                                          | Prefer user-facing role, label, placeholder, text, title, alt text, and explicit test-id contracts; locators also compose through frames and narrower scopes. | v1.1 adds placeholder/title/alt-text primaries, custom test-id attributes, exact context scoping, and user-facing locator suggestions.                     |
| [Healenium](https://github.com/healenium/healenium)                                                  | Persisted reference identity, confidence-based recovery, detailed reports, screenshots, and a feedback loop.                                                  | Keep evidence and reviewer feedback, but require no proxy, database, Docker, ML model, or automatic source rewrite.                                        |
| [recheck-web](https://github.com/retest/recheck-web)                                                 | Historical element identity, confidence gates, change reports, and human acceptance of intended changes.                                                      | Add successful-primary fingerprint observations and consensus proposals, but avoid full-page Golden Masters and visual authorization.                      |
| [playwright-self-healing-framework](https://github.com/ShantanuVr/playwright-self-healing-framework) | Strict TypeScript, deterministic signal breakdowns, replaceable boundaries, local fixture coverage, and JSON reporting.                                       | Preserve strict deterministic architecture while enforcing missing-only classification, semantic eligibility, margin, revalidation, and protected actions. |
| [autoheal](https://github.com/headout/autoheal)                                                      | Framework-aware locator recovery spanning semantic locator styles.                                                                                            | Generate ranked public-Playwright locator alternatives; do not intercept every call or hide recovery behind zero-code mutation.                            |
| [playwright-smart-locators](https://github.com/AxeForging/playwright-smart-locators)                 | Reviewable suggestion files and explicit privacy choices for DOM analysis.                                                                                    | Keep suggestions review-only and local, with no LLM or DOM upload required.                                                                                |
| [heal-playwright-tracer](https://github.com/heal-dev/heal-playwright-tracer)                         | Rich action-boundary evidence helps explain what the runner targeted.                                                                                         | Enrich candidate evidence, screenshots, timelines, and historical target health without patching Playwright internals.                                     |
| [ReproBreak](https://github.com/rub-sq/ReproBreak)                                                   | Reproducible real-world locator breaks are a better benchmark than synthetic happy paths alone.                                                               | Keep the deterministic mutation suite and plan an external corpus qualification track rather than claiming broad field accuracy.                           |

## v1.1 capabilities selected from the review

### Context-aware candidate discovery

A candidate must come from the reviewed page context. Targets can declare an exact pathname, one
unique frame owner, and one unique container. Context mismatch fails before candidate discovery;
evidence from another route, frame, or repeated component cannot leak into scoring.

### Playwright-native locator recommendations

The winning live element is rechecked against ordered locator alternatives: test ID, exact
role/name, label, placeholder, title, alt text, exact text, and a bounded stable CSS fallback. Every
alternative records match count and whether it resolves back to the assessed candidate. A proposal
requires a unique verified suggestion.

### Two independent review loops

- Locator proposals use repeated high-confidence drift evidence and may be sourced from successful
  guarded execution or `proposal-only` observation.
- Fingerprint proposals use only successful primary actions from independent runs. They never infer
  intent from a failed or healed action.

Both produce review-required JSON Patch previews with a `test` operation before `replace`. No
runtime or CLI command applies them.

### Historical target health

The evidence summary reports run count, healing rate, ambiguity and low-confidence rates, protected
attempts, score/margin ranges, drift age, chronic-drift status, and recent outcomes. This makes
repeated recovery visible as maintenance debt instead of turning it into silent green.

### Typed integration surface

`createAegilocTest` supplies the healer, Playwright attachments, screenshots, visible result marker,
and provenance through a typed fixture. Direct `createHealer` construction remains supported for
custom frameworks and Page Objects.

## Deliberately not adopted

- No automatic edits, commits, pull requests, or registry mutation.
- No healing of assertions, navigation outcomes, API failures, authentication, or business logic.
- No first-match fallback, XPath generation, unbounded DOM traversal, or geometry-led selection.
- No mandatory model, proxy, backend, database, hosted report, cloud account, or telemetry.
- No private Playwright hooks, monkey patches, CDP dependence, or locator-source introspection.
- No visual or historical snapshot treated as authorization to execute a business action.

These are trust-boundary decisions, not claims that other projects are incorrectly designed. Their
goals and operating environments differ from Aegiloc's conservative evaluation scope.

## Future validation work

The next evidence milestone is empirical rather than feature-driven: replay a reviewed external
locator-break corpus, publish false-positive and abstention metrics, and run longer sharded soak
tests. Until then, v1.1 remains an evaluation release rather than a production-effectiveness claim.
