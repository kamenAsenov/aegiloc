# Supply-chain controls

Healwright v1.0 keeps source and CI controls independent from npm publication.

## Local checks

```bash
pnpm package:check
pnpm package:reproducible
pnpm supply-chain:sbom
pnpm supply-chain:sbom:check
```

- `package:check` compiles a consumer, verifies exports/artifacts, exercises CLIs, and inspects a
  dry-run pack manifest.
- `package:reproducible` creates two isolated tarballs, compares their bytes and SHA-256 digests,
  then deletes both temporary copies.
- `supply-chain:sbom` creates a deterministic CycloneDX 1.6 inventory from the frozen pnpm lockfile.
- `supply-chain:sbom:check` regenerates the expected document in memory and rejects stale output.

The SBOM omits timestamps. Its required CycloneDX `serialNumber` is a deterministic UUID derived from
the frozen lockfile SHA-256 rather than randomness, so the same package and lockfile produce the same
bytes and GitHub can recognize the document for attestation. It inventories locked development and
test tooling as well as the peer dependency; it is not a vulnerability verdict.

## GitHub Actions

Pull requests run GitHub dependency review. The supply-chain job builds an unpublished tarball and
SBOM, verifies package reproducibility, and uploads both for 14 days. A push to `main` additionally
uses `actions/attest` to create GitHub/Sigstore build-provenance and SBOM attestations for that
workflow artifact. All third-party Actions are pinned to immutable commit revisions with comments
recording the reviewed major version. Dependabot proposes Action updates for full review.

Attestation is not publication: CI does not push npm packages, tags, or GitHub Releases. Artifacts
remain evaluation inputs until a maintainer separately authorizes a release.

## Verification boundary

Reproducible bytes make independently built tarballs comparable. GitHub attestations bind the CI
artifact to a workflow identity. Neither proves that Healwright is free of vulnerabilities or that
the package should be deployed. Review dependencies, source, workflow permissions, and release
intent independently.
