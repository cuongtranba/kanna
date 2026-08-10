---
target: c3-210
scope: insert
base: c3-210#n8290@v1:sha256:80857175556e4bc62c7f3cf079c8fb909034d813cc97f847343ebe87921bf7ba
---
| Mermaid correction loop — the model cannot fix its diagram and is asked every turn | `RunClaudeSessionDeps.mermaidGuard` is rebuilt per turn instead of per coordinator (its asked-diagram memory is what makes the ask once-only), or the once-per-diagram / queued-user-message / repairable-diagram short-circuits are dropped | mermaid-guard.test.ts asserts one ask per diagram, one message per turn, and no ask for a diagram `repairMermaidSource` saves; runner tests assert the guard runs on the success branch only and BEFORE maybeStartNextQueuedMessage | bun test --conditions production src/server/mermaid-guard.test.ts src/server/claude-session-runner.test.ts |
