---
target: rule-colocated-bun-test
scope: block
base: rule-colocated-bun-test#n15268@v1:sha256:6c733a6bc908ab2c89a563a0429d06eb34d56731aaa4a18067213c18dbdf6c8f
---

All test files must live in the same directory as the file under test and be named `<module>.test.ts` or `<module>.test.tsx`; they import their test API from "vite-plus/test" and run through `bun run test` (`bun --bun vp test run`). Live integration tests must be named `<module>.live.test.ts` and guarded with `describe.skipIf`, so CI can opt out. The rule id keeps its historical `bun-test` spelling because many component facts cite it.
