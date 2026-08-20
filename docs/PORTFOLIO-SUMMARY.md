# Portfolio summary

Healwright is an experimental TypeScript framework for conservative Playwright locator recovery. It
proves genuine locator drift, ranks compatible replacements deterministically, executes only under
guarded policy, and preserves evidence for human and CI review.

## Technical highlights

- strict TypeScript ESM package with declarations, explicit exports, and external-consumer checks;
- public Playwright API integration for locators, accessibility snapshots, reporters, and artifacts;
- deterministic weighted scoring with Unicode-safe normalization and seeded property tests;
- runtime/JSON Schema parity for registries, proposals, evidence, policy, and health outputs;
- canonical JSONL evidence, screenshots, review-only proposals, and tamper/stale-state detection;
- optional authenticated evidence manifests with truncation, replacement, and order detection;
- post-run governance with budgets, baselines, retry handling, and exact expiring waivers;
- a compiled onboarding CLI, escaped static report viewer, and realistic safe-versus-ambiguous demo.
- Firefox/WebKit core qualification, candidate performance budgets, deterministic SBOMs, and
  reproducible package/provenance controls.

## QA and SDET value

The project separates locator drift from actionability and application failures, exercises positive
and adversarial UI mutations, and makes exceptional passes visible as `PASSED_WITH_HEALING`. It
demonstrates framework design, risk-based test architecture, failure classification, artifact
engineering, CI quality gates, and technical product communication.

## Safety and governance

False-positive healing is treated as worse than failure. Mandatory semantic gates, confidence and
margin thresholds, immediate revalidation, proposal-only targets, human-reviewed locator changes,
and budget-only waivers keep recovery bounded and inspectable.

## Honest limitations

Healwright is a v0.7.0 Technical Preview: unpublished and pre-1.0. It has no demonstrated production
adoption, optional HMAC is not public-key non-repudiation, and it intentionally does not auto-apply
locator changes.

## Suggested LinkedIn Featured description

> Healwright is an experimental TypeScript framework for safer Playwright self-healing: deterministic locator recovery, guarded execution, evidence trails, proposal review, and CI governance without silent source rewrites.

The description is 221 characters, within LinkedIn's 280-character target.
