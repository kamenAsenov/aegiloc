# CLI reference

Aegiloc v1.1 includes a dependency-free CLI for local evaluation. No Aegiloc package is published
to npm. Repository commands use `node dist/cli.js` after `pnpm build`; a reviewed package artifact
exposes the same entry point as `aegiloc` for a future separately authorized distribution.

## Guided demo

```bash
pnpm demo
pnpm cli demo --force
pnpm cli demo --force --open
```

`demo` runs only the deterministic repository fixture. It demonstrates ordinary Playwright, one
guarded heal, and an ambiguous rejection; creates and verifies the evidence manifest; generates the
local report; and prints its absolute path. `--open` is deliberate and never implied.

Existing `test-results/realistic-demo` output causes `pnpm demo` to refuse replacement. Review the
existing report, then rerun explicitly with `pnpm cli demo --force`. If the platform opener is
unavailable, the command remains successful after generation and prints a copyable path plus a
warning.

## Help and diagnostics

```bash
node dist/cli.js --help
node dist/cli.js doctor
```

Doctor checks Node.js 22/24, `@playwright/test`, the built CLI, example registries, and the optional
local `aegiloc.targets.json`. It does not install software or contact a service.

## Initialize and validate a registry

```bash
node dist/cli.js init
node dist/cli.js init --registry config/aegiloc.targets.json
node dist/cli.js validate --registry config/aegiloc.targets.json
```

`init` creates parent directories and exclusively creates the file. It never overwrites without
`--force`, and even forced output refuses a symbolic-link destination. Review the starter fingerprint
and policy; initialization does not infer application or business intent.

`validate` uses the strict runtime parser. It proves structural/policy consistency, not that a live
page matches the fingerprint.

## Create and verify an evidence manifest

```bash
node dist/cli.js attest \
  --history test-results/aegiloc/history.jsonl \
  --summary test-results/aegiloc/summary.json \
  --out test-results/aegiloc/manifest.json

node dist/cli.js verify --manifest test-results/aegiloc/manifest.json
```

`attest` validates canonical history and exact summary agreement before recording ordered sibling
file names, byte lengths, and SHA-256 digests. Output is exclusive unless `--force` is explicit.

Optional authentication requires both an external key and key ID:

```bash
node dist/cli.js attest \
  --history test-results/aegiloc/history.jsonl \
  --summary test-results/aegiloc/summary.json \
  --out test-results/aegiloc/manifest.json \
  --key-file .aegiloc-evidence.key \
  --key-id ci-2026-q3

node dist/cli.js verify \
  --manifest test-results/aegiloc/manifest.json \
  --key-file .aegiloc-evidence.key \
  --key-id ci-2026-q3 \
  --require-authenticated
```

The key must contain at least 32 bytes. On POSIX it must be an owner-only regular file rather than a
symbolic link. Keys are not printed or embedded in output.

## Generate review-only maintenance proposals

```bash
pnpm proposal:generate
pnpm proposal:verify
pnpm fingerprint:propose
```

Locator proposals require repeated agreeing drift evidence and include live uniqueness-verified
locator alternatives. Fingerprint proposals require repeated independent successful primary
actions. Both produce JSON and Markdown review artifacts; neither applies a patch, edits source, or
rewrites the registry.

## Generate and open the viewer

```bash
node dist/cli.js view \
  --history test-results/aegiloc/history.jsonl \
  --summary test-results/aegiloc/summary.json \
  --manifest test-results/aegiloc/manifest.json \
  --out test-results/aegiloc/viewer \
  --force
```

Add `--open` to deliberately launch the generated `index.html`. With a manifest, the viewer verifies
exact file identity before rendering and displays `integrity` or `authenticated` trust. Use
`--key-file`, `--key-id`, and `--require-authenticated` for authenticated evidence.

Without a manifest, the viewer still validates canonical history/summary agreement but labels the
result `validated`, not authenticated. Invalid, mismatched, or malicious evidence fails before an
HTML file is written.

## Exit and mutation contract

Ordinary CLI success returns `0`; argument, validation, filesystem, evidence, or operation failures
return `1`. The CLI does not apply proposals, edit tests, rewrite registries after explicit `init`,
publish packages, upload evidence, or start a hosted dashboard.
