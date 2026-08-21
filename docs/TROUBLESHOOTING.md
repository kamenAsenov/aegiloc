# Troubleshooting decision tree

Start from what you observed. Do not lower thresholds merely to turn a failure green.

```text
Can `healwright doctor` complete?
├─ No → Fix the reported Node/build/Playwright prerequisite, then rerun doctor.
└─ Yes
   ├─ Did the primary action succeed normally?
   │  └─ Yes → No healing evidence is expected. Use the ordinary Playwright report.
   └─ No
      ├─ Was the primary locator proven missing?
      │  ├─ No → Preserve the Playwright failure; investigate actionability, strictness,
      │  │       navigation, authentication, data, network, or product behavior.
      │  └─ Yes
      │     ├─ Was healing rejected/protected?
      │     │  └─ Yes → Inspect semantic gates, confidence, margin, execution risk, and candidates.
      │     │           Keep the failure meaningful; do not weaken the policy blindly.
      │     └─ Did guarded execution succeed?
      │        ├─ Yes → Review PASSED_WITH_HEALING evidence and proposal history.
      │        └─ No → Inspect the fresh-pass disagreement/action failure and Playwright trace.
```

## Setup or demo fails

- **Unsupported Node:** use Node 22 or 24; Node 20 is end-of-life and outside v1 support.
- **Browser executable missing:** run `pnpm exec playwright install chromium`.
- **Demo output exists:** review it, then run `pnpm demo`; direct CLI use requires
  `node dist/cli.js demo --force`.
- **Browser did not open:** the demo still prints an absolute report path. Open it manually with
  `open`, `xdg-open`, or `start`, or rerun with explicit `--open`.
- **Port 4173 is occupied:** stop the existing process; the deterministic fixture uses a fixed port.

## Evidence or report is rejected

- **Summary mismatch:** regenerate evidence from the complete Playwright run; focused suites may
  replace local output.
- **Manifest digest/length mismatch:** restore the original sibling history and summary or create a
  new manifest after validating the intended files. Never edit evidence to match a manifest.
- **Authentication required:** supply the correct owner-only key file and expected key ID. An
  unsigned manifest cannot satisfy `--require-authenticated`.
- **Report inputs do not match manifest:** pass the exact history and summary siblings described by
  that manifest. The viewer rejects lookalike copies intentionally.
- **Report already exists:** review it, then pass `--force`; symbolic-link destinations remain
  protected.

## A heal was rejected

Read the decision reason before the score. Common safe outcomes are no compatible candidates, a
semantic contradiction, confidence below threshold, or insufficient runner-up margin. Fix a stale
primary locator or fingerprint through normal review when the UI change is legitimate. If two live
elements are genuinely indistinguishable, improve the application's accessible identity instead of
teaching the framework to guess.

## Governance fails

Inspect `health-summary.json` and `health-summary.md`, then compare the exact target/action/run counts
with [`governance/policy.json`](../governance/policy.json). Waivers are exact-scope, reasoned, and
expiring; they affect budgets only and cannot weaken runtime safety.

If the problem remains, capture the command, exit code, sanitized error, Node/Playwright versions,
and the smallest non-sensitive registry/evidence sample before opening an issue. Never attach keys,
credentials, private screenshots, or unreviewed production evidence.
