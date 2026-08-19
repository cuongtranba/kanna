---
target: c3-119
scope: insert
base: c3-119#n9156@v1:sha256:cb8c5234093da881c59c3c232bbc7326f3ad586e63b46a1deb0f54aa3f33a19c
---
| Card work signal | OUT | cardWorkSignal owns an ordered precedence table over ChatActivity — failed, awaiting answer, workflow, loop, agents, running, background tasks, cron, unread, chat count — first match wins; a loop outranks a bare agent count because it names the shape of the work; the elapsed ticker follows the ROW, so the failure and cron rows carry none; the cron row is muted, never amber | c3-301 | src/client/lib/boards/cardWorkSignal.ts |
