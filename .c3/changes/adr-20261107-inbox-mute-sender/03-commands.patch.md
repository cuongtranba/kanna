---
target: c3-247
scope: block
base: c3-247#n14448@v1:sha256:0d99dcec500b15892c8d8ce29872206245dff25a8dcb4b3ad45069f9bff9bfb0
---
| inbox topic and commands | OUT | InboxSnapshot with threads, items, unreadCount and total; commands markRead, markAllRead, archive, muteSender, page, reply, instruct, retrySend, approveProposal, rejectProposal, cancelProposal, setThreadAutonomy and resumeAgent | reply answers direct with an outboundId when the source has a reply target and agent with a chatId otherwise; reply and instruct enqueue a prompt into the thread chat under inbox-reply-threadId-n and inbox-instruct-threadId-ts; instruct takes the instruction text and an optional current draft and asks the agent for a draft, never a send, and refuses an archived thread; muteSender mutes or unmutes the thread sender on its source; text is capped at 8000 characters | src/server/ws-router-inbox.ts |
