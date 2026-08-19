---
target: c3-301
scope: block
base: c3-301#n11146@v1:sha256:95468d2c3d8399101f3673d1f0b77138b3dcbac0ef62173d39f470788cf0430d
---
| ChatActivity / EMPTY_CHAT_ACTIVITY | OUT | Compact live-state for a sidebar chat row (agents, workflow, loop, backgroundTasks, cron, awaitingAnswer, lastFailure); lastFailure carries the reason the chat's last run failed, null when nothing failed OR the failure recorded no reason, so a surface degrades to a bare failure label rather than a dangling separator; EMPTY_CHAT_ACTIVITY is the zero value | c3-208 | src/shared/types.ts |
