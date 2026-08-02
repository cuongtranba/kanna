---
target: c3-210
scope: insert
base: c3-210#n7082@v1:sha256:8051e7f3d3af5ab66a7c2590d4cc9d8181424c370878605c398c95143a07e9f6
---
| Alternate — background self-wake | Task-notification wake turns stream with no ActiveTurn; ClaudeSessionState.selfWakeActive overlays status "running" via getActiveStatuses, getBackgroundTasksByChatId feeds ChatRuntime.backgroundTasks, and cancel interrupts the warm session (adr-20260802-background-selfwake-status-ui) | c3-207 |
