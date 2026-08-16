---
target: c3-226
scope: insert
base: c3-226#n10338@v1:sha256:5e7cc03db404779df42a2219eb3b563171827631642b8b39c308fdce93fb89b5
---
| validate_cron + arm_cron tools | OUT | validate_cron takes a complete /cron line and returns the schedule in words plus its next three fire times, or isError with the failing part; arm_cron schedules one. Both answer from c3-233 previewCronCommand so they cannot disagree. validate_cron gates on a chat alone; arm_cron additionally needs the injected armCron capability, supplied for main chats only (delegationContext.depth === 0) like setup_loop — a subagent chat must not leave recurring work behind | c3-233 | src/server/kanna-mcp.ts, src/server/kanna-mcp.test.ts |
