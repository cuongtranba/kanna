---
target: rule-colocated-bun-test
scope: block
base: rule-colocated-bun-test#n15270@v1:sha256:5e0cc41f2e5bf22b5de258fecef1d7fe0391be2a968087e3eb7bfdc3161e350d
---

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
