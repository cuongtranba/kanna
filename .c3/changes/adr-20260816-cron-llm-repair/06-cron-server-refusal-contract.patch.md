---
target: c3-233
scope: insert
base: c3-233#n10779@v1:sha256:046255ffbbe6f125045110dc819e4b465802ccae36407d8e7b0d4b423b4fd2b2
---
| Refusal + model escalation | OUT | refuseCronCommand is the one path a /cron line is refused on: it appends the cron_command_error card carrying the typed line AND offers the error to createCronRepair, which enqueues a repair prompt and drains the queue only when the parser had no suggestion, for arm-shaped parts, once per line per chat, standing aside for a queued user message. A schedule that parses but never fires escalates too, on a reconstructed canonical line. KANNA_CRON_REPAIR=disabled turns it off | c3-226 | src/server/cron/commands.ts, src/server/cron/repair.ts |
