# Migrating to Aegiloc v1.1

v1.1 introduces the Aegiloc identity and adds backwards-compatible framework capabilities. The
package was not published under the former name, so this is a repository/package identity reset
rather than an npm migration.

## Rename imports and commands

Replace the former repository and package identifier with `aegiloc`:

```ts
import { createAegilocTest, createHealer } from 'aegiloc';
import AegilocReporter from 'aegiloc/reporter';
```

The binary is `aegiloc`, environment variables use the `AEGILOC_` prefix, and default evidence now
lives under `test-results/aegiloc`. Historical release notes retain the former project name so the
repository history remains understandable.

## Existing v1 registries

Existing version-1 target registries remain valid. No new field is required. v1.1 adds optional:

- primary locators: `placeholder`, `title`, and `altText`;
- actions: `uncheck`, `hover`, and `focus`;
- `defaults.testIdAttribute` for a reviewed HTML attribute name;
- `context.pathname`, `context.frame`, and `context.container`.

Context values are exact and fail closed. Add them only where route, frame, or repeated-component
scope is part of the target's reviewed identity.

```json
{
  "context": {
    "pathname": "/checkout",
    "frame": { "type": "title", "value": "Secure payment", "exact": true },
    "container": { "type": "role", "role": "region", "name": "Payment", "exact": true }
  }
}
```

## Prefer the typed fixture for new suites

Direct `createHealer` construction is still supported. New Playwright suites can reduce wiring with
`createAegilocTest`, which supplies audit attachments, screenshots, result annotations, and run
provenance.

```ts
const test = createAegilocTest({
  registry,
  runId: (testInfo) => process.env.GITHUB_RUN_ID ?? testInfo.testId,
  mode: 'observe',
});
```

Start in `observe`; move only reviewed reversible targets to `guarded`.

## Locator and fingerprint proposals

Locator proposal bundles are schema version 3 because they now include source, verified locator
alternatives, and a guarded JSON Patch preview. Regenerate older proposal artifacts; never treat a
proposal as durable authorization.

Fingerprint capture is disabled unless explicitly enabled:

```ts
createHealer({
  page,
  registry,
  fingerprintObservation: { enabled: true },
});
```

After at least three independent successful primary observations:

```bash
pnpm fingerprint:propose
```

Review the JSON and Markdown outputs. The command does not modify source or the registry.

## Verify the migration

```bash
pnpm typecheck
pnpm lint
pnpm example:verify
pnpm release:check
```

Do not lower confidence or margin thresholds to make an upgraded suite pass. A new rejection is a
review signal, not permission to weaken the safety model.
