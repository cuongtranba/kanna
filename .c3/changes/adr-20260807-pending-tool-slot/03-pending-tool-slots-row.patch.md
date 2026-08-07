---
target: c3-210
scope: insert
base: c3-210#n8091@v1:sha256:4357f6d650059aba4f1624273b4114b7fad8925535deed9952140c789d48e5f8
---
| PendingToolSlots | OUT | Per-chat single home for parked AskUserQuestion / ExitPlanMode canUseTool continuations, independent of ActiveTurn (adr-20260807-pending-tool-slot). Transitions: park (dedup — occupied slot discarded first), take/takeAny (caller settles after its transcript append), discard (settle with discardedToolResult → buildCanUseTool denies). Read by respondTool, getPendingTool, getActiveStatuses (waiting_for_user overlay), getWaitStartedAtByChatId (parkedAt overlay), and the isChatBusy derivation consumed by sendCommand + maybeStartNextQueuedMessage; isClaudeSessionIdle and enforceClaudeSessionBudget never close a session whose chat holds a parked slot. ActiveTurn carries NO pendingTool field and ghost turns must not be reintroduced | c3-207 | src/server/pending-tool-slot.ts, src/server/claude-session-state-queries.ts |
