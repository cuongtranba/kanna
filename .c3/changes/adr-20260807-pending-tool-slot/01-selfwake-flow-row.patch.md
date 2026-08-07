---
target: c3-210
scope: block
base: c3-210#n8062@v1:sha256:4a386bbb6245bc556945a885bbe658aac5bd64eb9a707f4b26689725186353fe
---
| Alternate — background self-wake | Task-notification wake turns stream with no ActiveTurn; ClaudeSessionState.selfWakeActive overlays status "running" via getActiveStatuses, getBackgroundTasksByChatId feeds ChatRuntime.backgroundTasks, and cancel interrupts the warm session (adr-20260802-background-selfwake-status-ui). A canUseTool request arriving mid-wake parks in PendingToolSlots (no ghost ActiveTurn — adr-20260807-pending-tool-slot); the wake's terminal result disarms the flag, defensively discards the slot, and drains the queued-message queue | c3-207 |
