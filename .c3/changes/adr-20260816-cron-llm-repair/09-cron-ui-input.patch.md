---
target: c3-120
scope: insert
base: c3-120#n8939@v1:sha256:541e5d526025f489942b9f823fd121b3cbe0049857a12f62b0337fdcde5d2e47
---
| Offending line display | IN | CronCommandErrorMessage renders cron_command_error.input above the message when present. `/cron` starts no turn, so no user_prompt bubble records the typed line and this card is the only surface it can appear on; entries without a single offending line render unchanged | c3-311 | src/client/components/messages/CronCommandErrorMessage.tsx, src/client/lib/parseTranscript.ts |
