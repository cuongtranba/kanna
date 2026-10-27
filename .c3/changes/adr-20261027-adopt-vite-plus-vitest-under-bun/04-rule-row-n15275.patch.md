---
target: rule-colocated-bun-test
scope: block
base: rule-colocated-bun-test#n15275@v1:sha256:86059646c780332d55e870129e8bdc72b002ffcb133c85b3672eafed35b268b0
---

| tests/auth.test.ts (separate root) | src/server/auth.test.ts (next to impl) | Breaks the bun run test src/server/auth.test.ts fast-iteration filter; reviewers cannot jump from impl to test |
