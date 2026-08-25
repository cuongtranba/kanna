---
target: c3-214
scope: block
base: c3-214#n12663@v1:sha256:b8ebd18f19e115c30d308caa54b6c931f3dd67a48fbdac24ef6326972d055621
---
| Input — codex tool rendering | codex-session-mapper imports buildResultEntry, codexSystemInitEntry, normalizeCodexTokenUsage, todoToolCall, translateItemToToolCalls, translateItemToToolResults and withEntryIdentity from the live codex translator. The dependency is deliberate: an imported tool card is produced by the same functions that render the live one, so toolKind and toolName cannot drift between the two paths | c3-211 |
