---
target: c3-210
scope: insert
base: c3-210#n7899@v1:sha256:043fe76df76d185f4d22d8f641b4ad061fc34c323e28a5afb78df5e7a779c5f5
---
| emitAutoContinueEvent(event) | IN | Appends the auto-continue event, then reconciles the chat's loop-tracking watch via syncLoopTracking. It is the single append path for loop_armed / loop_disarmed, so arm, stop_loop, user takeover, chat delete and the repeated-failure disarm all reconcile through one hook; the reconcile is total and idempotent and the coordinator gains no IO of its own (the registry owns it) | c3-227 | src/server/agent-coordinator.ts, src/server/loop-tracking-sync.ts |
