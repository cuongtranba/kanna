---
target: c3-247
scope: block
base: c3-247#n14464@v1:sha256:ee84151b34fc820af1b1074a6c4262b91e52e94e41b6183ed8dfd986d55f02ef
---
| inbox topic and commands | OUT | InboxSnapshot with threads, items, unreadCount and total; commands markRead, markAllRead, markUnread, archive, unarchive, muteSender, page, reply, instruct, retrySend, approveProposal, rejectProposal, cancelProposal, setThreadAutonomy and resumeAgent | reply answers direct with an outboundId when the source has a reply target and agent with a chatId otherwise; reply and instruct enqueue a prompt into the thread chat under inbox-reply-threadId-n and inbox-instruct-threadId-ts; instruct takes the instruction text and an optional current draft and asks the agent for a draft, never a send, and refuses an archived thread; markUnread marks threads or activity items unread again; archive takes threadId or threadIds so older callers keep working; unarchive restores a thread to the state and unread flag it had before it was archived; muteSender mutes or unmutes the thread sender on its source; text is capped at 8000 characters | src/server/ws-router-inbox.ts |
