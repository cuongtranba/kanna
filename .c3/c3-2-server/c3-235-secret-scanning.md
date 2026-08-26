---
id: c3-235
c3-seal: 3a7cf20ba688b0a3758f1198106731d76931c57d274ac3ccb269465fb7c5bb76
title: secret-scanning
type: component
category: feature
parent: c3-2
goal: Block a credential from reaching the repository, at the commit and again at the merge, using one pinned scanner and one shared configuration so the local and CI verdicts cannot disagree.
uses:
    - ref-local-first-data
---

## Goal

Block a credential from reaching the repository, at the commit and again at the merge, using one pinned scanner and one shared configuration so the local and CI verdicts cannot disagree.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | None. The scanner runs in CI and in the pre-commit hook, never inside the Kanna process. |
| Consumers | The gitleaks CI workflow and the pre-commit hook wired by bun run setup:hooks |
| Boundary | Owns detection and exemption policy only. Credential rotation and history rewrite are operator actions, not automation. |

## Purpose

Owns secret detection for the repository: the pinned gitleaks version, the single .gitleaks.toml that both entry points read, the allowlist that keeps a local directory scan usable, and the rule for exempting a synthetic test credential. It exists so a scan run by a developer and a scan run by CI reach the same verdict from the same configuration. Non-goals: it does not rotate credentials, does not rewrite history, and does not decide whether a finding is exploitable. Those are operator judgements recorded in the wiki runbook.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | Scanning the working tree and staged changes on the developer machine before anything leaves it | Advisory | The pre-commit hook is the local half of the same gate CI enforces. |
| adr-20260821-perf-alert-github-tickets | adr | The convention that a repository-health gate is enforced by a workflow rather than by review | Advisory | Named for precedent only; secret scanning predates and does not depend on it. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| .gitleaks.toml | IN | The single configuration both the hook and the workflow read, including the paths allowlist and every exemption | Deleting the paths allowlist takes a local directory scan from 11 findings to 112, because gitleaks dir does not honour gitignore and no flag on v8.30.1 enables it | .gitleaks.toml |
| .github/workflows/gitleaks.yml | OUT | Runs on every push to main and every pull request; any finding blocks the merge | Uses image zricethezav/gitleaks:v8.30.1, pinned exactly and deliberately not floated | .github/workflows/gitleaks.yml |
| .githooks/pre-commit | OUT | Runs the same scan locally over staged changes | The staged-scan command is gitleaks git --staged. The command gitleaks protect does not exist in v8.x, so a tutorial-driven change to it would break the hook silently | .githooks/pre-commit |
| Exemption mechanism | IN | A synthetic fixture credential gets one narrow regexes entry anchored to the literal value, added in the same pull request that introduces the fixture | Never a paths entry over src or over test files. Short dummy values use stopwords instead | .gitleaks.toml |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| .github/workflows/gitleaks.yml | c3-235 Contract | Runner image tag may change only when the pin is deliberately revised | .github/workflows/gitleaks.yml |
| .githooks/pre-commit | c3-235 Contract | Shell style is free; the scan command and its exit handling are not | .githooks/pre-commit |
| CLAUDE.md Secret Scanning section | c3-235 Contract | Wording is free; the two v8 command facts and the allowlist rationale must survive | CLAUDE.md |

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | The hook is installed by bun run setup:hooks, which points core.hooksPath at .githooks | N.A - no governing entity |
| Input | Staged changes locally; the full checkout in CI | N.A - no governing entity |
| State | None beyond the committed configuration. The scanner keeps no baseline file | N.A - no governing entity |
| Shared dependency | gitleaks pinned at v8.30.1, obtained locally from the developer path and in CI from the pinned image | N.A - no governing entity |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | A credential is stopped before it reaches a branch, and failing that before it reaches main | N.A - no governing entity |
| Primary path | The hook scans staged changes, finds nothing, and the commit proceeds | N.A - no governing entity |
| Alternate path | A new fixture carries a synthetic credential, so the same pull request adds one anchored regexes entry for that literal value | N.A - no governing entity |
| Failure behavior | A real leak is answered by rotating the credential first and only then removing it from the tree, because a rotated credential in history is inert | N.A - no governing entity |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| The hook is rewritten to use gitleaks protect, which v8.x does not provide, and silently stops scanning | Following an older gitleaks tutorial | The hook reports no findings on a file that CI then rejects | bun test --conditions production src/server/gitleaks-hook.test.ts |
| The paths allowlist is deleted as apparent noise | Cleaning up .gitleaks.toml | A local directory scan jumps from 11 findings to 112 | bun test --conditions production src/server/gitleaks-hook.test.ts |
| An exemption is written broadly over a directory and hides a future real leak | Adding a fixture that trips the scanner | Review of the .gitleaks.toml diff shows a paths entry rather than an anchored regexes entry | bun test --conditions production src/server/gitleaks-hook.test.ts |
| The pinned version is floated during a routine dependency sweep | Automated or habitual version bumps | The image tag or local version no longer reads v8.30.1 | .gitleaks.toml |
