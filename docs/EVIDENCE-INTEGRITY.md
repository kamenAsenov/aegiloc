# Evidence integrity and optional authentication

Healwright v0.7 can bind canonical `history.jsonl` and `summary.json` to a strict manifest. This
detects missing, truncated, reordered, replaced, or mismatched evidence before downstream review.
Authentication is optional: local evaluation still requires no key or external service.

## Create and verify an integrity manifest

```bash
pnpm build
node dist/cli.js attest \
  --history test-results/healwright/history.jsonl \
  --summary test-results/healwright/summary.json \
  --out test-results/healwright/manifest.json
node dist/cli.js verify --manifest test-results/healwright/manifest.json
```

The three files must be siblings. The manifest records fixed-order SHA-256 digests and exact UTF-8
byte lengths. It uses the evidence summary timestamp, so identical evidence produces identical
unsigned manifest content.

An unsigned manifest provides integrity only when the manifest itself arrives through a trusted
channel. An attacker who can replace both evidence and manifest can create a new internally
consistent bundle.

## Add optional HMAC authentication

Generate at least 32 random bytes and restrict the file to its owner:

```bash
umask 077
openssl rand 32 > .healwright-evidence.key
chmod 600 .healwright-evidence.key
```

Do not commit that file. Create and verify an authenticated manifest:

```bash
node dist/cli.js attest \
  --history test-results/healwright/history.jsonl \
  --summary test-results/healwright/summary.json \
  --out test-results/healwright/manifest.json \
  --key-file .healwright-evidence.key \
  --key-id ci-2026-q3

node dist/cli.js verify \
  --manifest test-results/healwright/manifest.json \
  --key-file .healwright-evidence.key \
  --key-id ci-2026-q3 \
  --require-authenticated
```

The CLI refuses symbolic-link key files, group/world-readable POSIX key files, keys shorter than 32
bytes, malformed key identifiers, and overwrite unless `--force` is explicit. Key contents are not
written to output or logged.

## Rotation

- Assign a non-secret key ID that identifies the generation, not the key contents.
- Generate the successor independently; never derive it by editing the previous key.
- Keep the prior verification key only through the longest evidence-retention window.
- Update writers first, then verifiers; accept both reviewed key IDs during the overlap externally.
- Revoke immediately after suspected disclosure and treat evidence signed after the earliest
  possible exposure as untrusted until regenerated.
- Record rotation dates and owners in the team's secret manager, not in the repository.

Healwright accepts one verification key per invocation. Multi-key lookup and secret-manager
integration belong in the calling CI workflow so the core remains provider-neutral.

## Retention

The repository CI retains evidence and supply-chain artifacts for 14 days and Playwright reports for
7 days. Consumers should choose the shortest period that supports investigation, cap access to test
owners, and delete manifests, viewers, screenshots, and source evidence together. A retained HMAC
key must outlive the evidence it verifies, but should not remain after that evidence expires.

## Cryptographic boundary

HMAC-SHA-256 proves that a holder of the shared key created the manifest and that its authenticated
fields were not modified. It does not identify which holder acted, provide public verification, or
provide non-repudiation. GitHub build attestations cover package/SBOM provenance separately; they do
not authenticate application test evidence.
