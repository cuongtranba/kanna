---
target: c3-211
scope: block
base: c3-211#n12665@v1:sha256:7b0bcb546171ab2fdd955e3018e1c3a8939187199a7dc36826ed5d2a01a11c8c
---
| Pure transcript translation | OUT | translateItemToToolCalls, translateItemToToolResults, buildResultEntry, codexSystemInitEntry, normalizeCodexTokenUsage, todoToolCall and withEntryIdentity are exported for c3-214's codex session import, and parseUnifiedDiff and isUnifiedDiff were made public for the same reason. Live and imported codex cards therefore derive toolKind and toolName from one place. The module stays pure, so the dependency drags no process spawning into the import path | c3-214 | src/server/codex-transcript-translator.ts |
