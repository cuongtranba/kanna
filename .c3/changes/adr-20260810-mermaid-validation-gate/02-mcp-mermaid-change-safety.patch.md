---
target: c3-226
scope: insert
base: c3-226#n9116@v1:sha256:03f6b8b1034438193d1c5e7b4449999e05536a28a90122b19b66143c6f3a1c7d
---
| Mermaid validation silently disabled — the DOM shim stops satisfying mermaid | A mermaid upgrade changes what DOMPurify or `initialize` touch, or the shim is "simplified"; every parse then throws and every diagram reads as valid | Under `bun test` the happy-dom preload masks a broken shim entirely, so the adapter suite drives a SUBPROCESS with no happy-dom and asserts both verdicts plus zero leaked globals | bun test --conditions production src/server/mermaid-parse.adapter.test.ts |
