---
id: ref-colocated-bun-test
c3-version: 4
c3-seal: a93427f2d1a84239ac9794e25c48c912934ff2d7bddcd847c7c1c948eb19d4de
title: Colocated Test (Vitest under Bun)
type: ref
goal: Tests sit next to the file under test, named *.test.ts(x), and run on Vitest through vp test inside the Bun runtime — no separate test directory, no second runner.
---

# colocated-bun-test

## Goal

Tests sit next to the file under test, named *.test.ts(x), and run on Vitest through vp test inside the Bun runtime — no separate test directory, no second runner.

## Choice

Vitest 5 through Vite+ (`vp test`), executed by Bun (`bun --bun vp test run`), as the single test runner. Test file naming: <module>.test.ts or <module>.test.tsx. Live integration tests end in .live.test.ts and are gated by env.

## Why

Keeps tests visible and close to behavior. Vitest shares vite.config.ts with the client build and isolates each file in its own worker, and running it under Bun keeps `bun:sqlite`, `Bun.serve`, `Bun.Terminal` and `Bun.spawn` available to server tests. The ref id keeps its historical `bun-test` spelling because many component facts cite it.

## How

| Guideline | Example |
| --- | --- |
| Test lives next to impl | src/server/auth.ts + auth.test.ts |
| Test API comes from vite-plus/test | import { describe, expect, test } from "vite-plus/test" |
| Live APIs gated by .live.test.ts and describe.skipIf | title-generation.live.test.ts |
| Use bun run test <path> to scope runs | bun run test src/server/agent.test.ts |

## Not This

| Alternative | Rejected Because |
| --- | --- |
| bun test with bun:test | Single-process runner: module mocks and leaked React roots affected unrelated files, and it cannot share the Vite config |
| Vitest under Node | Server code uses bun:sqlite, Bun.serve, Bun.Terminal and Bun.spawn, which Node does not provide |

## Scope

**Applies to:**

- Every colocated test file under src/, scripts/ and wiki/scripts/

**Does NOT apply to:**

- Playwright specs under e2e/, which run on demand through bun run test:e2e

## Override

To override this ref:

1. Document justification in an ADR under "Pattern Overrides"
2. Cite this ref and explain why the override is necessary
3. Specify the scope of the override (which components deviate)

## Cited By

- c3-{N}{NN} ({component name})
