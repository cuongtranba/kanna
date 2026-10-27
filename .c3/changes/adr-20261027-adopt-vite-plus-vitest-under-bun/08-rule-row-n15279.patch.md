---
target: rule-colocated-bun-test
scope: block
base: rule-colocated-bun-test#n15279@v1:sha256:abb64f7d0690191cae349b8dabb8284dfdeeac571a972e0b9b3da5e3fcc1babc
---

| auth.test.ts calls a live HTTP API unconditionally | rename to auth.live.test.ts and gate it with describe.skipIf | Live tests must be gated by .live.test.ts so CI runners skip them |
| vi.mock or vi.doMock in a new test | inject the dependency as a parameter with the production default | src/ops/testing/module-mock-guard.test.ts fails any module mock outside its shrinking legacy list |
