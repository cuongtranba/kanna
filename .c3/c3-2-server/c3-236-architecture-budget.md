---
id: c3-236
c3-seal: 8a6738cbb9af961f05dae65d0f37b6e309412490f51ebcca0a21b540f1a48647
title: architecture-budget
type: component
category: feature
parent: c3-2
goal: Hold every structural-defect population in the codebase at or below a recorded pin, so a pull request that makes a filed architecture issue worse fails CI instead of merging unobserved.
uses:
    - ref-side-effect-adapter
    - ref-strong-typing
    - rule-colocated-bun-test
---

## Goal

Hold every structural-defect population in the codebase at or below a recorded pin, so a pull request that makes a filed architecture issue worse fails CI instead of merging unobserved.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | None. The budget runs only under bun test and never ships in the server binary. |
| Consumers | CI (Architecture budget step) and developers via bun run check:arch |
| Boundary | Reads repository source as text. Imports no application module, so it cannot drift with the code it measures. |

## Purpose

Owns the machine-checkable record of how much structural debt the repository currently carries, expressed as a per-module line ceiling plus an exact ratchet over counted defect populations. It exists because the c3-0 complexity program closed seven workstreams as COMPLETED while modules over 700 lines grew from 18 to 23 and production lines rose from roughly 121,700 to 125,779, and no gate could observe either movement. Non-goals: it judges no single line of code, replaces no lint rule, and expresses no style preference. A pin is a defect count owned by a GitHub issue, never a formatting opinion.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-colocated-bun-test | rule | Test placement and naming for budget.test.ts and budget-scan.adapter.test.ts | Binding | The gate is a colocated bun test, so CI runs it with no extra wiring. |
| ref-side-effect-adapter | ref | Separation of the pure manifest from the filesystem scan | Advisory | src/ops is outside the enforced seal; the split is kept anyway so the checker stays unit-testable. |
| ref-strong-typing | ref | BudgetBreach as a discriminated union over the six breach kinds | Binding | formatBreach switches exhaustively, so a new breach kind cannot ship without a message. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| MODULE_ALLOWANCES | IN | Per-file ceiling for every module above MODULE_LINE_THRESHOLD. A module may shrink freely, may never exceed its pin, and must be delisted once it falls under the threshold. | Production TypeScript under src only. Tests, fixtures, test-helpers and testing directories are excluded. | src/ops/architecture/budget.ts |
| PATTERN_BUDGETS | IN | Exact ratchet per counted population. Growth and shrinkage both fail, so a pin can never sit above the real count. | Each entry names the issue it regresses and a rationale explaining why the count is a defect. | src/ops/architecture/budget.ts |
| checkModuleBudget and checkPatternBudget | OUT | Pure functions returning every BudgetBreach rather than stopping at the first, so one run reports the whole regression. | No IO. Measurements are supplied by the caller. | src/ops/architecture/budget.test.ts |
| measureModules and measurePatterns | OUT | Module lines match wc -l as a newline count; pattern counts match grep -c as matching lines, so any pin is checkable by hand. | The only filesystem reader in the component. | src/ops/architecture/budget-scan.adapter.ts |
| filesScanned | OUT | A budget whose include paths reach zero files reports pattern_unmeasured, never a shrink. | Prevents a renamed target from reading as a vanished population and being pinned at zero. | src/ops/architecture/budget.test.ts |
| ESLINT_LIMIT_PINS | IN | Each pin must equal the ceiling eslint.config.js configures for that rule. Raising it is limit_raised; lowering the ceiling without lowering the pin is limit_slack; a pin whose rule eslint no longer configures is limit_unconfigured rather than a vacuous pass. | ESLint owns the per-function measurement a regex cannot make; the budget owns only the direction. | src/ops/architecture/budget.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| CI Architecture budget step | c3-236 Contract | Step name and placement may change; the command may not be dropped or made non-blocking. | .github/workflows/test.yml |
| CLAUDE.md Architecture Budget section | c3-236 Contract | Wording is free; the ceiling-versus-ratchet distinction and the filesScanned rule must both survive. | CLAUDE.md |
| Pattern rationale text | c3-236 Contract | Wording is free; it must state why the count is a defect rather than what the regex matches. | src/ops/architecture/budget.ts |

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | The repository root is resolved from the test file location, so the gate works from any worktree. | N.A - no governing entity |
| Input | Every production TypeScript and TSX file under src, read as text. | N.A - no governing entity |
| State | None. The manifest is the only persisted state and it lives in version control. | N.A - no governing entity |
| Shared dependency | node fs and path, reached only through the adapter. | ref-side-effect-adapter |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | A pull request cannot silently enlarge a tracked defect population. | N.A - no governing entity |
| Primary path | Scan the tree, compare against the manifest, report zero breaches, exit clean. | N.A - no governing entity |
| Alternate path | A deliberate refactor shrinks a population; the gate fails and asks for the pin to be lowered in the same pull request, locking the gain in. | N.A - no governing entity |
| Failure behavior | Every breach is printed with its path or id, both counts, the driving issue number and the rationale, so the message alone explains what regressed. | N.A - no governing entity |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| A pin is raised to make a red build green, retiring the check instead of the defect | Any edit that increases a value in MODULE_ALLOWANCES or PATTERN_BUDGETS | The manifest is version-controlled, so the increase is a reviewable diff carrying the issue number it regresses | src/ops/architecture/budget.ts |
| A renamed target silently makes a gate inert | A file listed in a PATTERN_BUDGETS include is moved or renamed | filesScanned reaches zero and the run reports pattern_unmeasured rather than a shrink | bun test --conditions production src/ops/architecture/budget.test.ts |
| The scan stops reaching source and the gate passes vacuously | A change to the exclusion list or the directory walk | A guard test asserts the scan finds more than 400 modules and includes a known file | bun test src/ops/architecture/budget.test.ts |
