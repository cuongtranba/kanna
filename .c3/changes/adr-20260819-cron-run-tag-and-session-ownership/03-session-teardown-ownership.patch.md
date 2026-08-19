---
target: c3-210
scope: insert
base: c3-210#n9855@v1:sha256:2298e724d97c814d1cda2148759cce0df3644198d44df10df86c67aaf35ff142
---
| Session torn down under a booting turn, stranding a turn that never ends | A teardown gate that hand-rolls a busy-subset and omits startingTurns — the ActiveTurn is registered only after the spawn resolves, and a reused warm session still carries the previous turn's lastUsedAt so it sorts first in LRU. Compounded when closeClaudeSession deletes the session-map entry before the runner's finally, which then skips recordTurnFailed, activeTurns.delete and pendingTools.discard | enforceClaudeSessionBudget, isClaudeSessionIdle and clearClaudeSessionContext all consult startingTurns; the runner settles by ownership via ActiveTurn.sessionId rather than residency, falling back to residency when the turn declares no session, and leaves a superseding session strictly alone | bun test src/server/claude-session-runner.test.ts src/server/claude-session-lifecycle.test.ts src/server/claude-session-state-queries.test.ts src/server/claude-context-commands.test.ts |
