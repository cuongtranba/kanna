---
target: c3-301
scope: block
base: c3-301#n11315@v1:sha256:95468d2c3d8399101f3673d1f0b77138b3dcbac0ef62173d39f470788cf0430d
---
| ChatActivity / EMPTY_CHAT_ACTIVITY | OUT | Compact live-state for a sidebar chat row (agents, workflow, loop, backgroundTasks, cron, awaitingAnswer, lastRunFailure); lastRunFailure carries the newest subagent run's failure and its SubagentErrorCode, since agents counts only what is running and a dead background agent otherwise left no trace; EMPTY_CHAT_ACTIVITY is the zero value; replaces hasAutomation on SidebarChatRow | c3-208 | src/shared/types.ts |
