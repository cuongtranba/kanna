---
target: c3-214
scope: block
base: c3-214#n12664@v1:sha256:be01de809956f09bc2bd1a63a00560d16c65452c862c2ea05617508776b1b8b9
---
| Translation surface drift | c3-211 changes how toolKind or toolName is derived, or un-exports parseUnifiedDiff, isUnifiedDiff or withEntryIdentity | The codex mapper stops compiling, or imported codex tool cards silently render differently from the live ones | bun run check; bun test src/server/codex-session-mapper.test.ts |
