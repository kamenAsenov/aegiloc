# Compatibility policy

Healwright v1.0.0 establishes a stable public contract for evaluation and carefully scoped pilot
use. Stability describes compatibility, not proof of production adoption.

## Supported environment

| Surface          | v1 contract                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| Node.js          | `>=22 <25`; package contracts run on Node 22 and 24 in CI               |
| Playwright Test  | `>=1.50.0 <2`; v1.0 is qualified with frozen development version 1.62.1 |
| Module format    | ESM                                                                     |
| Primary browser  | Chromium full suite                                                     |
| Focused browsers | Firefox and WebKit core safety qualification                            |

Node 20 is excluded because it reached end of life before this release. Odd or current Node majors
outside the range are not part of the v1 support promise. Playwright versions inside the peer range
must retain the public APIs used by Healwright; a newly discovered incompatibility is handled as a
bug and may narrow the range in a documented patch when required for safety.

## Public API promise

The supported programmatic surface is the package root (`healwright`) and reporter subpath
(`healwright/reporter`) recorded in [`api/public-api.json`](../api/public-api.json). JSON Schema
subpaths declared in `package.json` are also public.

Within v1:

- removing or incompatibly changing a public export requires a new major version;
- adding an optional export or backwards-compatible capability is a minor change;
- compatible corrections and safety hardening are patch changes;
- TypeScript declarations are part of the contract, including generic target-key inference;
- files under `src/`, `dist/`, `scripts/`, examples, and unexported package paths are not import
  contracts;
- prose, exact CLI sentence wording, CSS class names, and generated report layout may improve without
  a major version when behavior and accessible meaning remain compatible.

The CLI command names and documented flags are stable for v1. Exit `0` means success and exit `1`
means invalid input or failed operation. Governance retains its separately documented `0`, `1`, and
`2` exit meanings.

## Schema compatibility

Every persisted format has an explicit internal version. Existing schema versions remain readable
unless a documented security issue makes rejection necessary. Incompatible format changes require a
new schema version plus migration guidance; the existing version is not silently reinterpreted.

The proposal bundle is currently schema version 2. Target registry, evidence summary, evidence
manifest, governance policy, and health summary are version 1. The checked-in API inventory records
these versions and their stable package subpaths.

## Reviewing API changes

After a deliberate public change:

```bash
pnpm api:snapshot
git diff -- api/public-api.json
pnpm api:snapshot:check
pnpm package:check
```

The snapshot generator reads built runtime modules, declaration files, package support ranges, and
exported schemas. CI fails when source and inventory diverge. A snapshot update is evidence of review,
not permission to make a breaking change.

## Deprecation and security

Where practical, a public API is deprecated for at least one minor release before removal in the
next major. A safety or security defect may require immediate fail-closed behavior; release notes
will explain the compatibility impact and safer migration.

No v1 compatibility promise expands healing scope. Assertions, business logic, authentication, API
failures, test data, and genuine regressions remain outside the product contract.
