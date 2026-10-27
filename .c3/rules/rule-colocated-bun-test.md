---
id: rule-colocated-bun-test
c3-seal: a4eca2b8bab51bfe1aa8c83dada61b96ff73e6ef8e3e493e6c7916395abd630a
title: colocated-bun-test
type: rule
goal: Every Kanna test must sit next to the file under test, share its basename, import from "vite-plus/test", and run on the single runner, Vitest through `vp test` under the Bun runtime. No `__tests__/` directories, no separate test packages, no second runner. Live-API tests use `.live.test.ts` and are gated by environment.
---

# colocated-bun-test

## Goal

Every Kanna test must sit next to the file under test, share its basename, import from "vite-plus/test", and run on the single runner, Vitest through `vp test` under the Bun runtime. No `__tests__/` directories, no separate test packages, no second runner. Live-API tests use `.live.test.ts` and are gated by environment.

## Rule

All test files must live in the same directory as the file under test and be named `<module>.test.ts` or `<module>.test.tsx`; they import their test API from "vite-plus/test" and run through `bun run test` (`bun --bun vp test run`). Live integration tests must be named `<module>.live.test.ts` and guarded with `describe.skipIf`, so CI can opt out. The rule id keeps its historical `bun-test` spelling because many component facts cite it.

## Golden Example

```ts
// src/server/auth.test.ts
import { afterEach, describe, expect, test } from "vite-plus/test"   // REQUIRED: vite-plus/test imports
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { persistProjectUpload } from "./uploads"               // REQUIRED: relative import — test sits beside impl
import { startKannaServer } from "./server"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function startPasswordServer(options: {                   // OPTIONAL: local helper hoisted above describe
  trustProxy?: boolean
  port?: number
  dataDir?: string
} = {}) {
  // ...
}

describe("auth", () => {                                        // REQUIRED: describe block scoping
  test("rejects request without cookie", async () => {          // REQUIRED: test() not it()
    // ...
  })
})
```

File: `src/server/auth.test.ts` lives next to `src/server/auth.ts`.

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| tests/auth.test.ts (separate root) | src/server/auth.test.ts (next to impl) | Breaks the bun run test src/server/auth.test.ts fast-iteration filter; reviewers cannot jump from impl to test |
| auth.spec.ts | auth.test.ts | The vite.config.ts include glob requires .test.ts(x) — .spec.ts is silently skipped |
| import { describe, test } from "bun:test" | import { describe, test } from "vite-plus/test" | bun:test is no longer the runner and Vitest does not load it |
| import from "vitest" or "jest" in any test | vite-plus/test only | vite-plus pins the Vitest build and a direct import can resolve a second copy; two runners cause framework churn |
| auth.test.ts calls a live HTTP API unconditionally | rename to auth.live.test.ts and gate it with describe.skipIf | Live tests must be gated by .live.test.ts so CI runners skip them |
| vi.mock or vi.doMock in a new test | inject the dependency as a parameter with the production default | src/ops/testing/module-mock-guard.test.ts fails any module mock outside its shrinking legacy list |

## Scope

**Applies to:**

- Every `.ts` or `.tsx` file under `src/` that ships behavior — must have a colocated `.test.ts(x)` unless explicitly excluded
- Server, client, and shared packages alike

**Does NOT apply to:**

- Pure declaration files (`*.d.ts`)
- Generated code under `dist/` and assets under `public/`
- Files listed under `_exclude` in `.c3/code-map.yaml`
- Playwright specs under `e2e/` (`*.pw.ts`), which run on their own runner on demand

## Override

To deviate:

1. Add the path to `_exclude` in `.c3/code-map.yaml` with a comment naming the reason
2. Document in an ADR `Compliance Rules` row with action `override`
3. Cite rule-colocated-bun-test and the exact path skipped
