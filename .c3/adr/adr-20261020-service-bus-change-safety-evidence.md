---
id: adr-20261020-service-bus-change-safety-evidence
c3-seal: 3f27ad5226d86c715ffc045d677df73131518401c956f0a7a4e1b4d2bb38d7c3
title: service-bus-change-safety-evidence
type: adr
goal: Ground the service-bus component's module-budget verification in the test that enforces it, src/ops/architecture/budget.test.ts, instead of the script name bun run check:arch, so the Change Safety row resolves as evidence under c3x check.
status: done
date: "2026-10-20"
---

## Goal

Ground the service-bus component's module-budget verification in the test that enforces it, src/ops/architecture/budget.test.ts, instead of the script name bun run check:arch, so the Change Safety row resolves as evidence under c3x check.

## Context

c3-246 was created with a Change Safety row whose Required Verification names the package script bun run check:arch. c3x check reports that cell as ungrounded evidence because a script name is not a file the eval binding can follow. The architecture budget is enforced by src/ops/architecture/budget.test.ts, which is what the script runs, so the row can name that test directly.

## Decision

Replace the Required Verification cell of the module-budget row with bun test --conditions production src/ops/architecture/budget.test.ts, the same form every other Change Safety row in the server container uses. No code changes.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-246 | component | One Change Safety row names the enforcing test file instead of the script | c3-246#n14929@v1:sha256:1de5b60a8a0f15ed2e6fb5973d1fe271525804138dc63bfd64f03f4fbb6bfee5 | Wording only; the verification is unchanged in substance |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Leave the warning | c3x check would report it on every run and hide a real warning behind a known one |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The named test stops covering the module budget | The test file is the budget's only enforcement and is colocated with budget.ts | bun test --conditions production src/ops/architecture/budget.test.ts |

## Verification

| Check | Result |
| --- | --- |
| c3x check | ok with no warning on c3-246 |
