---
target: rule-colocated-bun-test
scope: block
base: rule-colocated-bun-test#n15266@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f
---

Every Kanna test must sit next to the file under test, share its basename, import from "vite-plus/test", and run on the single runner, Vitest through `vp test` under the Bun runtime. No `__tests__/` directories, no separate test packages, no second runner. Live-API tests use `.live.test.ts` and are gated by environment.
