---
target: c3-226
scope: block
base: c3-226#n13713@v1:sha256:148f6e1c63f44ce6e1aab581955daba2f2b1d0a9cfa31ccb83023f72d73f2ac5
---
| Path-deny bypass | Edit lets a beacon tool run without its permission-gate verdict, or drops restrictedAllowedPaths from the approval context | Add a deny-rule test; grep kanna-mcp-beacon.ts for a run path that skips authorize | bun test src/server/permission-gate.test.ts |
