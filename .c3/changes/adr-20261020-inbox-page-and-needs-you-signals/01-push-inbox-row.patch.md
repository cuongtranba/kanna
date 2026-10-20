---
target: c3-244
scope: insert
base: c3-244#n13851@v1:sha256:1d55cd5181eb79a92fa1a9a729744ddd112a78eaab62e732090151bb98d062ca
---
| Inbox kind | OUT | notifyInbox sends kind inbox for a thread that entered needs_you, with the thread id, the sender as the title and the source as the project title, at normal urgency, deduped on inbox:threadId:lastMessageAt | Never skipped for a focused chat, because a thread belongs to no open chat; skipped when the source handler disabled push | src/server/push/push-manager.ts |
