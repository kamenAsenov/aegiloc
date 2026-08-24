# When not to use Aegiloc

Do not use automatic healing when a wrong interaction could be worse than an obvious test failure.

Keep an action outside Aegiloc or mark its target `proposal-only` when it:

- submits payment, transfers money, deletes data, changes permissions, or triggers another
  irreversible operation;
- authenticates a user, handles credentials, or crosses an authorization boundary;
- validates an assertion, expected result, business rule, API response, test-data contract, or
  network dependency;
- targets a page with many intentionally identical controls and insufficient semantic context;
- depends on unsupported widgets, OCR, visual similarity, canvas content, or browser behavior not
  qualified by this repository;
- runs in a regulated or safety-critical workflow without an independent risk review;
- would allow a healed pass to hide a genuine product regression.

Do not adopt the technical preview if the team cannot review target fingerprints, retain evidence
safely, investigate `PASSED_WITH_HEALING`, and keep ordinary Playwright failures visible.

Good uses are narrow, reversible locator-drift experiments on reviewed controls where ambiguity
must fail closed. Aegiloc is not a replacement for accessible product markup, resilient primary
locators, page-object maintenance, or human test ownership.
