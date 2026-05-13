---
id: rule-colocated-bun-test
c3-seal: 656866c97ce4b026e5395b9c402ca3adb5ead39d1f83d2c9aed860ee2f80d8f8
title: colocated-bun-test
type: rule
goal: Every Kanna test must sit next to the file under test, share its basename, and run under `bun test`. No `__tests__/` directories, no separate test packages, no second runner. Live-API tests use `.live.test.ts` and are gated by environment.
---

# colocated-bun-test

## Goal

Every Kanna test must sit next to the file under test, share its basename, and run under `bun test`. No `__tests__/` directories, no separate test packages, no second runner. Live-API tests use `.live.test.ts` and are gated by environment.

## Rule

All test files must live in the same directory as the file under test and be named `<module>.test.ts` or `<module>.test.tsx`; live integration tests must be named `<module>.live.test.ts` so CI can opt out.

## Golden Example

```ts
// src/server/auth.test.ts
import { afterEach, describe, expect, test } from "bun:test"   // REQUIRED: bun:test imports
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
| tests/auth.test.ts (separate root) | src/server/auth.test.ts (next to impl) | Breaks bun test src/server/auth.test.ts fast-iteration glob; reviewers cannot jump from impl to test |
| auth.spec.ts | auth.test.ts | bun test glob requires .test.ts(x) — .spec.ts is silently skipped |
| import { describe, test } from "vitest" | import { describe, test } from "bun:test" | Two runners cause framework churn; CI runs only bun test |
| import "jest" in any test | bun:test only | Same as above |
| auth.test.ts calls a live HTTP API unconditionally | rename to auth.live.test.ts | Live tests must be gated by .live.test.ts so CI runners skip them |

## Scope

**Applies to:**

- Every `.ts` or `.tsx` file under `src/` that ships behavior — must have a colocated `.test.ts(x)` unless explicitly excluded
- Server, client, and shared packages alike

**Does NOT apply to:**

- Pure declaration files (`*.d.ts`)
- Generated code under `dist/` and assets under `public/`
- Files listed under `_exclude` in `.c3/code-map.yaml`

## Override

To deviate:

1. Add the path to `_exclude` in `.c3/code-map.yaml` with a comment naming the reason
2. Document in an ADR `Compliance Rules` row with action `override`
3. Cite rule-colocated-bun-test and the exact path skipped
