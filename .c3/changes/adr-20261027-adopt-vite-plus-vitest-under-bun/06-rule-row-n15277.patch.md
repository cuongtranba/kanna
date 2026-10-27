---
target: rule-colocated-bun-test
scope: block
base: rule-colocated-bun-test#n15277@v1:sha256:2d672542a61caa3957f46281861f555a6bc14c0b68d042cba4497576f86d8f30
---

| import { describe, test } from "bun:test" | import { describe, test } from "vite-plus/test" | bun:test is no longer the runner and Vitest does not load it |
