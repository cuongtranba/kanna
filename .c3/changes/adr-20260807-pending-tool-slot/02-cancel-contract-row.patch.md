---
target: c3-210
scope: block
base: c3-210#n8079@v1:sha256:28436f40be2f16c5aa4e95fc0d38461943adf28181241bbcabd86a14ed811f96
---
| Cancel callback | IN | Propagates cancel to provider. FIRST settles any parked PendingToolSlots request turn-independently (takeAny → append discarded tool_result → resolve), so one Stop frees a question parked mid-turn or mid-self-wake. Then falls back through the states that render busy without an ActiveTurn: a startingTurns entry (provider session still booting) is marked cancelRequested + dropped and the interrupted/turn_cancelled pair written immediately, then the booting turn tears itself down silently on resolve; else a selfWakeActive session is interrupted directly. Never starts a queued message — Stop parks the queue. See adr-20260804-cancel-during-turn-boot, adr-20260807-pending-tool-slot | c3-211 | src/server/claude-cancel-handler.ts, src/server/claude-turn-starter.ts |
