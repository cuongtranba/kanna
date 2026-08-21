---
target: c3-210
scope: insert
base: c3-210#n10099@v1:sha256:ff35cb9cfeb5ba17b050be67e507733f7917486e3f371f5671386ee8e917135a
---

| onTurnTerminal turn duration | OUT | The store's turn-terminal observer records `kanna.turn.duration_ms` (c3-234) before its cron branch, enriched from `activeTurns.get(chatId)` under the same invariant the cron attribution relies on — a turn is deleted from the map only after its terminal record persists. `ActiveTurn.startedAt` is REQUIRED and carried over from the `StartingTurn` at the single construction site, so the measurement includes spawn cost, which is the latency a user actually waits. A terminal with no ActiveTurn — a background-task self-wake — records nothing rather than a fabricated duration. See adr-20260821-perf-alert-github-tickets | c3-234 | src/server/agent-coordinator.ts, src/server/claude-turn-starter.ts, src/server/claude-session-state.ts |
