---
target: c3-114
scope: insert
base: c3-114#n6429@v1:sha256:438db4637742ec0b6e942e743c6911f45195c12242969a0fb8de13fa37032048
---
| Stale lazy chunk | A renderer lazy-imports a bundle (mermaid, shiki) and the tab outlives the deploy that deleted that hashed chunk | Diagram or highlight fails with "Failed to fetch dynamically imported module"; caching the rejected promise breaks every later instance in the tab | bun test --conditions production src/client/lib/lazyModule.test.ts src/client/components/messages/MermaidDiagram.test.tsx |
