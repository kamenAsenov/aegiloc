# CLI reference

Healwright v0.6.0 includes a small, dependency-free CLI for local evaluation. The package is not yet
published, so commands in this repository use `node dist/cli.js` after `pnpm build`. An installed
package exposes the same entry point as `healwright`.

## Help

```bash
node dist/cli.js --help
```

Help lists every command, examples, and the non-mutation safety boundary.

## Initialize a starter registry

```bash
node dist/cli.js init
node dist/cli.js init --registry config/healwright.targets.json
```

The default output is `healwright.targets.json`. The command creates parent directories when needed
and uses exclusive file creation. It refuses to overwrite an existing file.

`--force` permits a deliberate replacement:

```bash
node dist/cli.js init --registry healwright.targets.json --force
```

Review the existing file first. `init` does not inspect an application, infer business intent, or
rewrite tests.

## Validate a registry

```bash
node dist/cli.js validate --registry healwright.targets.json
```

Validation uses the same strict runtime parser as the framework. Invalid inputs exit nonzero and
report a precise JSON path. Validation proves structural and safety-policy consistency; it does not
prove that a live application matches the fingerprint.

## Diagnose local setup

```bash
node dist/cli.js doctor
```

Doctor checks:

- Node.js 20 or newer;
- whether `@playwright/test` resolves;
- whether the compiled CLI artifact exists;
- whether the bundled basic and realistic example registries are present;
- whether the optional default `healwright.targets.json` exists in the working directory.

Required failures return a nonzero exit code. The command does not install software or contact a
cloud service.

## Generate the static viewer

```bash
node dist/cli.js view \
  --history test-results/healwright/history.jsonl \
  --summary test-results/healwright/summary.json \
  --out test-results/healwright/viewer
```

The command strictly parses JSONL history and requires the supplied summary to match a freshly
computed canonical summary structurally, including rejecting extra data. Existing `index.html`
output is not overwritten unless `--force` is present.

Exit `0` means the command completed. Argument, filesystem, registry, history, and summary errors
exit `1` with a human-readable message on stderr.

## Deliberate non-goals

The CLI does not apply healing proposals, edit registries after initialization, edit test source,
publish packages, upload evidence, or start a hosted dashboard.
