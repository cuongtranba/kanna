---
target: c3-114
scope: block
base: c3-114#n7510@v1:sha256:1682d6ba9f3115730036b00a2451ef66639afb1196fbacb7545a4b13dbe009a2
---
| Stale lazy chunk | A renderer lazy-imports a bundle (mermaid, shiki) and the tab outlives the deploy that deleted that hashed chunk | Diagram or highlight fails with "Failed to fetch dynamically imported module"; caching the rejected promise breaks every later instance in the tab | bun test --conditions production src/shared/lazyModule.test.ts src/client/components/messages/MermaidDiagram.test.tsx |
