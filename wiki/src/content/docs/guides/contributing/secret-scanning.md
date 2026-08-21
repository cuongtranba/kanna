---
title: Secret Scanning
description: How gitleaks works, local setup, and the leak-response runbook.
---

Kanna scans every commit for secrets using [gitleaks](https://github.com/gitleaks/gitleaks) v8.30.1. The scan runs in CI on every push to `main` and every PR; it also runs locally as a pre-commit hook so findings are caught before they leave your machine.

## Local setup

Install gitleaks (macOS):

```bash
brew install gitleaks
```

Or pull the pinned Docker image:

```bash
docker pull zricethezav/gitleaks:v8.30.1
```

Wire the pre-commit hook:

```bash
bun run setup:hooks
```

This copies `.githooks/pre-commit` into your local `.git/hooks/`. Without Docker or a native binary the hook exits 0 with a warning — CI still enforces the scan.

## Run a scan by hand

```bash
bun run scan:secrets
```

This runs `gitleaks dir --no-banner --redact`, which scans all files in the working tree. Equivalent manual invocation:

```bash
gitleaks dir --no-banner --redact
```

Or with Docker:

```bash
docker run --rm -v $PWD:/repo -w /repo zricethezav/gitleaks:v8.30.1 dir --no-banner --redact
```

To scan git history (all commits, not just staged files):

```bash
gitleaks git --no-banner --redact
```

## Reading a finding

A finding prints the rule that fired (`generic-api-key`, `aws-access-token`, …), the file and line, and a redacted excerpt. Every line is a distinct finding — one leaked key on one line is one finding.

## Two non-obvious v8.x facts

**`gitleaks protect` does not exist in v8.x.** Older tutorials use it; it was removed. The staged-scan command is `gitleaks git --staged`.

**`gitleaks dir` does not respect `.gitignore`.** There is no flag to enable that. `.gitleaks.toml` carries a `paths` allowlist that keeps local scans from drowning in noise.

## Adding a test fixture with a synthetic credential

Add one narrow `regexes` entry to `.gitleaks.toml` anchored to the literal fixture value in the same PR. A `paths` entry over `src/**` or `*.test.ts` is not acceptable — it silently suppresses all future leaks in those paths.

Short dummy values (anything under ~16 chars that gitleaks extracts as the secret) can go in `stopwords` instead, which matches against the extracted secret value rather than the whole source line.

## Bypassing deliberately

```bash
git commit --no-verify
```

This skips the local hook. CI is **not** bypassable — a finding in a PR blocks merge regardless of how the commit was made.

Use `--no-verify` only when you are certain the finding is a false positive and you have already added the allowlist entry to `.gitleaks.toml`.

## Version policy

gitleaks upstream is effectively feature-complete and ships security patches only. The exact pin (`v8.30.1`) is intentional — do not float it. The intended successor is [Betterleaks](https://github.com/betterleaks/betterleaks); switching is a deliberate future decision.

## Leak-response runbook

### 1. Rotate the credential. First. Before opening any PR.

Assume the credential is compromised from the moment it was pushed. Public repositories are continuously scraped; GitHub's own push-protection telemetry shows credentials being exercised within minutes of a push. Everything below is cleanup — this step stops the bleeding.

### 2. Remove it from the working tree

Open a normal PR that deletes or replaces the credential in the source. Land it through the standard review process.

### 3. Decide on history

A rotated credential in history is **inert**. `git filter-repo` and BFG rewrite every SHA — breaking every open PR, every worktree, and every local clone. For this repo (1 300+ commits, multiple active worktrees) that cost is real.

Rewrite history only when the credential **cannot** be rotated (e.g. a hard-coded internal key with no revocation path). Otherwise: document the finding and move on.

### 4. Suppress the finding so CI goes green

For a history finding, add the commit-pinned fingerprint to `.gitleaksignore`:

```bash
gitleaks git --no-banner --report-format json --report-path /tmp/findings.json
```

Then copy the `Fingerprint` value from the JSON and add it to `.gitleaksignore`. Fingerprints for history findings are stable (commit SHA + rule + line); fingerprints for `dir` findings are line-bound and rot on the next edit.

### 5. Record it

Add one line to this page's finding log (below): what leaked, when it was pushed, when it was rotated.

---

## Finding log

| Date | What | Rotated |
| --- | --- | --- |
