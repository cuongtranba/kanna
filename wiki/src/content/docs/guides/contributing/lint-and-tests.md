---
title: Lint & Tests
description: CI gates and the lint cap ratchet.
---

## Lint

`bun run lint` runs ESLint on `src/` with `--max-warnings=0`. CI runs it before tests; merges are blocked on lint errors AND on any warning count above the cap.

The cap is a **ratchet**: when warnings drop, lower the cap in the same PR so they cannot creep back up.

Plugin `react-hooks` (set 7+) enforces React 19 rules:

- Errors: `rules-of-hooks`, `purity`, `globals`
- Warnings: `set-state-in-effect`, `refs`, `immutability`, `preserve-manual-memoization`, `exhaustive-deps`

## Tests

`bun test` MUST pass locally before any push or PR. CI (`.github/workflows/test.yml`) runs `bun test` on every push to `main` and every PR; merges blocked on failure.

Run a single suite:

```bash
bun test src/server/<file>.test.ts
```

## Test subprocess discipline

When a test spawns `git` or other subprocesses:

- Set `stdin: "ignore"`
- Set `GIT_TERMINAL_PROMPT=0`
- Give an explicit timeout: `test(name, fn, 30_000)` — Bun's 5s default is too tight for CI

A hung credential prompt or interactive subprocess can otherwise exhaust the test timeout.

## Render-loop regression checks

When introducing a new `use*Store` selector or any React hook that derives collections, the selector MUST return a stable reference. Inline `?? []` or `?? {}` produces fresh refs each call and triggers React error #185.

Pattern:

```ts
const EMPTY: Subagent[] = []
useStore((state) => state.list ?? EMPTY)
// or
useStore(useShallow((state) => state.list ?? []))
```

Tests can mount a component with effects and assert no loop warnings via `renderForLoopCheck` in `src/client/lib/testing/`.
