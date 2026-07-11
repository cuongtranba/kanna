# ESLint strict-rules burn-down

## Goal
`bun run lint` (--max-warnings=0) **and** `bun run typecheck` both exit 0 in the
worktree, with the strict rule set enabled in `eslint.config.js`.

## Working directory (IMPORTANT)
All work happens in the git worktree:
`/Users/cuongtran/Desktop/repo/kanna/.claude/worktrees/eslint-strict-core`
(branch `chore/eslint-strict-core`). The Kanna session cwd is the MAIN repo, so
every command must `cd` into the worktree first. Do NOT edit files in the main
repo checkout.

## Verify oracle (run from worktree)
```
cd .claude/worktrees/eslint-strict-core && bun run lint && bun run typecheck
```
Discover remaining violations per rule:
```
cd .claude/worktrees/eslint-strict-core && \
node node_modules/eslint/bin/eslint.js src/ --format json 2>/dev/null | \
node -e 'let s="";process.stdin.on("d",d=>s+=d);process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const t={};for(const f of a)for(const m of f.messages){if(!m.ruleId)continue;t[m.ruleId]=(t[m.ruleId]||0)+1}for(const[r,c]of Object.entries(t).sort((x,y)=>y[1]-x[1]))console.log(String(c).padStart(5),r)})'
```

## Baseline (commit 4f2f20f) — 3134 problems, 14 rules
| count | rule | strategy |
|---|---|---|
| 2595 | no-restricted-syntax | ban `as` casts + `unknown` keyword (see below) |
| 154 | no-console | replace with `log.*` from `src/shared/log.ts` |
| 142 | @typescript-eslint/no-explicit-any | give real types |
| 127 | no-nested-ternary | early-return / extracted helper |
| 31 | dot-notation | `eslint --fix` |
| 25 | prefer-template | `eslint --fix` |
| 20 | prefer-arrow-callback | `eslint --fix` |
| 11 | no-implicit-coercion | `eslint --fix` |
| 9 | prefer-const | mostly `eslint --fix` |
| 7 | no-useless-return | `eslint --fix` |
| 6 | no-useless-escape | mostly `eslint --fix` |
| 4 | object-shorthand | `eslint --fix` |
| 2 | no-case-declarations | wrap `case` body in `{ }` |
| 1 | no-param-reassign | copy param to local |

## Recommended chunk order (do smallest/safest first)
1. **Autofix pass** — `cd <worktree> && node node_modules/eslint/bin/eslint.js src/ --fix`.
   Clears dot-notation, prefer-template, prefer-arrow-callback,
   no-implicit-coercion, object-shorthand, no-useless-return, and most
   prefer-const / no-useless-escape. Then hand-fix the small remainder
   (no-case-declarations 2, no-param-reassign 1, any leftover escape/const).
2. **no-explicit-any (142, 11 files)** — replace `any` with concrete types /
   generics. Small file set; do per-file.
3. **no-console (154)** — `import { log } from "<relative>/shared/log.ts"`;
   map `console.log`→`log.info`, `warn`→`log.warn`, `error`→`log.error`,
   `debug`→`log.debug`. Tests already exempt.
4. **no-nested-ternary (127)** — client-heavy (JSX). Extract helpers or
   early-returns; keep output identical.
5. **ban `as` + `unknown` (2595)** — the big one, do LAST, in file-sized chunks.

## `as` / `unknown` removal strategy (no validator lib installed)
- `as const` is ALLOWED (selector exempts it) — never touch it.
- Bare `catch (e)` is fine (no `unknown` keyword). Only explicit `: unknown`
  annotations and `as unknown` casts are flagged.
- Replace `x as T`: prefer `satisfies T`, a type guard `function isT(v): v is T`,
  or proper generics. For error handling, import `toError`/`errorMessage` from
  `src/shared/errors.ts` (the sanctioned `unknown` chokepoint) instead of
  writing `catch (e: unknown)` / `e as Error`.
- For external JSON/protocol boundaries where a cast is truly irreducible,
  funnel through a typed guard helper — never leave a raw `as`.
- If a whole file's `as` churn proves unsafe, note it under "Failed approaches"
  and move on; do NOT weaken types just to silence the rule.

## Hard constraints
- Every chunk MUST keep `bun run typecheck` green (verify includes it) and run
  scoped tests on touched files: `cd <worktree> && bun test --conditions production <file>.test.ts`.
- No `eslint-disable` comments. No `any` to dodge the `as` ban.
- Do not edit the main repo checkout; only the worktree.
- Commit after each chunk with a clear message.

## Progress (latest first)
- 2026-07-11 Chunk 1 DONE (commit d0fa616). Autofix pass + hand-fixes cleared
  all 10 chunk-1 rules to 0: dot-notation, prefer-template,
  prefer-arrow-callback, no-implicit-coercion, object-shorthand,
  no-useless-return, no-useless-escape, prefer-const, no-case-declarations,
  no-param-reassign. Hand-fixes: tools.ts read_file case braces (2);
  event-store.ts appendSubagentEvent param→local (1); terminal-manager.test.ts
  redundant `\"` in python template (6); driver.test.ts merged split `emitLine`
  decl (1); eslint.config.js prefer-const `ignoreReadBeforeAssign:true` for the
  AgentCoordinator↔ScheduleManager forward-ref init pattern (4). typecheck
  green; scoped tests pass (tools, event-store, driver, terminal-manager).
  Remaining: 2595 no-restricted-syntax, 154 no-console, 142 no-explicit-any,
  127 no-nested-ternary, 1 no-fallthrough.
- 2026-07-11 baseline committed (4f2f20f); strict config + log.ts/errors.ts
  chokepoints in place; 3134 violations remain.

## Failed approaches
- (none yet)

## Next chunk
Chunk 2: eliminate @typescript-eslint/no-explicit-any (142 violations in ~11
files). Give each `any` a real type or use a generic. NO casts to `any`, NO
eslint-disable. Verify, commit, update this file.

## Final gate (when lint+typecheck are 0)
- `cd <worktree> && bun run test` (`--conditions production`) fully green.
- Update `CLAUDE.md` "# Lint" to document the strict tiers, the log.ts/errors.ts
  chokepoints, the test/no-console exemption, `as const` exemption, and the
  `no-control-regex` OFF rationale.
- `/c3 sweep` to sync `.c3/` if edits crossed component boundaries.
- Open PR → `cuongtranba/kanna` (NEVER `jakemor/kanna`), base `main`,
  head `chore/eslint-strict-core`.
