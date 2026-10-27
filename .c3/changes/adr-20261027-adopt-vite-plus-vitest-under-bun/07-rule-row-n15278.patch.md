---
target: rule-colocated-bun-test
scope: block
base: rule-colocated-bun-test#n15278@v1:sha256:eea886f54878fe1efc55464af57b1d59afc66d73229017178050462210e776e8
---

| import from "vitest" or "jest" in any test | vite-plus/test only | vite-plus pins the Vitest build and a direct import can resolve a second copy; two runners cause framework churn |
