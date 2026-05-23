---
id: adr-20260523-lint-side-effects-pure-layers
c3-seal: 8da2d4a431374aa0d4bc61bf9847e51c64c8483a4df119ab39556d6f92e978ff
title: lint-side-effects-pure-layers
type: adr
goal: Ban direct side-effect imports/globals (`fs`, `chokidar`, db clients, `child_process`, `node:http`/`https`, `Bun.*` globals) in `src/shared/**` and `src/client/**` via ESLint. Force every side-effect call to live in `src/server/**` (adapter layer) or behind an injected port. Apply rule as `error` from the first PR; relocate the only two pre-existing violations into `src/server/**` so the rule lands with zero suppressions.
status: proposed
date: "2026-05-23"
---

## Goal

Ban direct side-effect imports/globals (`fs`, `chokidar`, db clients, `child_process`, `node:http`/`https`, `Bun.*` globals) in `src/shared/**` and `src/client/**` via ESLint. Force every side-effect call to live in `src/server/**` (adapter layer) or behind an injected port. Apply rule as `error` from the first PR; relocate the only two pre-existing violations into `src/server/**` so the rule lands with zero suppressions.

## Context

Today the Shared container's Responsibilities (`c3-3`) state it only owns types, WS protocol, tool hydration, and port/branding constants. Yet `src/shared/projectFileRelocation.ts` and its colocated test call `node:fs` `copyFileSync`/`mkdirSync`/`existsSync`/`node:fs/promises`. Only consumer is `src/server/codex-app-server.ts` — file is misplaced. No mechanical guard exists to keep new code from doing the same in `src/shared/**` or `src/client/**`. Repo-wide audit found 0 such imports in `src/client`, 2 in `src/shared`, and ~185 in `src/server`. Server layer is intentionally out-of-scope for v1 — adding the rule there now would mean ~185 eslint-disable comments with zero refactor value. v1 locks the pure layers; future ADRs will tighten the server layer one component at a time.

## Decision

Add one new ESLint flat-config override block scoped to `src/shared/**/*.{ts,tsx}` and `src/client/**/*.{ts,tsx}`. Block uses two rules:

1. `no-restricted-imports` with `patterns` covering: `fs`/`fs/*`/`node:fs`/`node:fs/*`/`chokidar` (filesystem); `bun:sqlite`/`better-sqlite3`/`pg` (db); `child_process`/`node:child_process`/`http`/`node:http`/`https`/`node:https` (process + raw network).
2. `no-restricted-globals` banning the `Bun` identifier (covers `Bun.spawn`, `Bun.$`, `Bun.file`).
Browser-native `fetch` is intentionally allowed — it is the canonical HTTP API on both runtimes and the 9 existing client call sites are legitimate. Move `projectFileRelocation.ts` + test into `src/server/` and fix the single import in `codex-app-server.ts`. Rule severity is `error`; no `eslint-disable` comments are introduced anywhere in this PR.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-3 | container | Pure-layer Responsibilities are now mechanically enforced for src/shared/**; a misplaced IO module is being removed from this container | Container Responsibilities already say "no IO" — no edit needed; verify no component cites projectFileRelocation |
| c3-2 | container | Receives projectFileRelocation.ts from Shared; gains lint exemption (no rule applied here in v1) | Confirm file lands inside Server scope; no component membership added since the file was already uncharted in the codemap |
| c3-1 | container | Pure-layer rule extends to src/client/**; 0 current violations | Verify no client component imports newly-banned modules |
| eslint.config.js | N.A - eslint config is repo-root tooling, not a c3 component | Enforcement surface for the decision | None — config files are excluded from c3 ownership by convention |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | Shares the same philosophy of pushing impurity to boundaries; the new lint rule extends boundary policing from types to side effects | review — no edit to ref; cite it in commit message as adjacent policy |
| N.A - no existing ref about side-effect isolation | Repo has no port-and-adapter ref yet; v1 ships only the lint surface, so a new ref is premature | create-ref deferred to v2 (per-component server refactor) |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Same boundary-enforcement family as the new lint rule; both run in bun run lint and fail CI on violation | comply — no edit; new rule slots beside it in eslint.config.js |
| N.A - no existing rule about side-effect ports | Rule for v1 lives in eslint.config.js itself, not as a c3 rule entity; no golden-example markdown is required because the enforcement is fully declarative ESLint config | create-rule deferred — revisit if v2 introduces a custom AST plugin |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| File move | git mv src/shared/projectFileRelocation.ts src/server/projectFileRelocation.ts and same for the colocated .test.ts | git status -s shows two R entries |
| Import fix | src/server/codex-app-server.ts:16 updated from ../shared/projectFileRelocation to ./projectFileRelocation | bun test src/server/codex-app-server passes (40 tests) |
| Lint config | New override block appended to eslint.config.js (~40 LOC) with no-restricted-imports patterns and no-restricted-globals for Bun | bun run lint exits 0 on repo head; synthetic probe _lint_probe.ts triggers 3 expected errors |
| Test verification | bun test src/server/projectFileRelocation.test.ts 6/6 pass after move | Test output recorded above |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no c3 entity body changes | This ADR adds an enforcement surface (ESLint) without changing component bodies, refs, or rules. projectFileRelocation was uncharted in the codemap on both sides of the move, so no c3x lookup ownership row shifts. | c3x lookup src/shared/projectFileRelocation* returns empty components: both before and after the move |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run lint | Fails CI when src/shared/** or src/client/** imports any banned module or references the Bun global | bunx eslint src/shared/_lint_probe.ts returns 3 errors with the expected messages; full bun run lint exits 0 on this branch |
| .github/workflows/test.yml | Already runs bun run lint before tests; merges block on lint failure per existing CLAUDE.md --max-warnings=0 policy | No workflow change required |
| ESLint override block in eslint.config.js | Single source of truth; new banned module = one line in patterns | Diff localized to eslint.config.js and the moved files |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Apply rule to src/server/** with eslint-disable on all ~185 existing sites | Pure suppression noise, zero architectural value, blocks PR review with mechanical churn, makes future migration harder because every disable becomes precedent |
| warn-only ratchet across the whole repo | Repo CLAUDE.md sets --max-warnings=0; warnings would either immediately fail CI (same as error) or need a per-rule cap raise that the ratchet pattern doesn't naturally model; cleaner to start at error on the layers that are already clean |
| Custom AST plugin (eslint-plugin-kanna-purity) catching call sites, not just imports | ~200 LOC + tests for an enforcement that no-restricted-imports + no-restricted-globals already cover on the pure layers; revisit in v2 when extending to server layer where call-site granularity (e.g. "fs only inside specific files") starts mattering |
| C3-only ref/rule with /c3 audit enforcement | Not lint-time; misses regressions until a manual audit; user explicitly asked for lint as primary enforcement |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Future contributor adds an fs import in src/shared/** to "just get something working" | Rule is error, fails CI before merge; rule message names the exact required remediation (move to src/server/** or inject a port) | bun run lint in CI |
| Browser-native fetch ban added later by accident, breaking 9 client call sites | Rule deliberately omits fetch from no-restricted-globals; ADR documents the carve-out so a later editor knows it is intentional | Comment-free config diff is small enough that a reviewer notices any fetch addition |
| New banned module surfaces (e.g. mongodb, redis) not covered by v1 list | Adding a module is a one-line addition to the patterns array; no schema change required | Future PR adds the module to the array + an entry to this ADR's successor |
| File move silently breaks a runtime import not caught by tests | The only consumer (codex-app-server.ts) is heavily tested (40 tests pass); tsc import resolution would fail at build time on a broken relative path | bun test src/server/codex-app-server + repo-wide bun test |

## Verification

| Check | Result |
| --- | --- |
| bun run lint | exit 0 |
| bun test src/server/projectFileRelocation.test.ts | 6 pass / 0 fail |
| bun test src/server/codex-app-server.test.ts | 40 pass / 0 fail |
| Synthetic probe: write src/shared/_lint_probe.ts with import "node:fs", import "chokidar", Bun.spawn(...) and run bunx eslint on it | 3 errors with expected messages (recorded in this session) |
| c3x check after ADR creation | exit 0 |
