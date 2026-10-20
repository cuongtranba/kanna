---
title: Inbox
description: One place for the messages that reach Kanna from outside — webhooks and MCP sources — read first by an agent, answered by you, with every other event browsable as activity.
---

The **Inbox** is where messages from outside Kanna land: a webhook delivery, or a
message from an [MCP source](/guides/user/mcp-sources/) such as a Zalo
conversation. Open **Inbox** in the sidebar. The badge beside it counts what
needs you.

## How a message arrives

1. The message becomes a **thread**. Messages from the same source and the same
   conversation (a Zalo `threadId`, or whatever the source's thread key names)
   stack into one thread, so a chatty contact is one row, not twenty.
2. If the source's handler mode is **New chat** or **Run in chat**, an agent
   reads the message first in that thread's own chat. For **New chat** the chat
   is created on the first message, titled `<source> · <sender>`, and reused for
   every later message in the thread, so the agent keeps the conversation
   context.
3. The agent reports a verdict — **needs you**, **FYI** or **handled** — with a
   short summary and, when a reply makes sense, a **draft**. The agent never
   sends anything to the sender on its own.
4. Only a **needs you** thread interrupts you: a toast (unless you are already on
   the Inbox), the sidebar badge, the window title count, and a push
   notification if you have those enabled. **FYI** threads sit in the Inbox
   quietly; **handled** threads appear in Activity only.

If the agent's turn ends without a report, the thread is shown as **needs you**
with the raw message, so nothing is lost silently. A source with the **Notify**
handler mode skips the agent and goes straight to **needs you**.

## The two tabs

| Tab | Shows |
| --- | --- |
| **Inbox** | Threads that are new, need you, or are FYI, unread first, grouped by day — plus attention items: a failed turn, a question an agent is waiting on, a failed cron, subagent or loop run. |
| **Activity** | Every event the server records — chats, turns, queue, tasks, cron, loops, subagents, webhooks, MCP messages — newest first, with filters by source, project, chat and *needs attention*, and **Load older** for history. |

Opening a thread marks it read. **Mark all read** clears the whole Inbox tab.

## Answering a thread

Open a thread to see its messages (**Show raw** reveals the exact payload), the
agent's read, and a reply box seeded with the draft.

- **Send** sends the text in the box to the sender. Kanna asks the thread's chat
  to send exactly that text through the source's own tools and to confirm what
  it sent. The thread moves to **Replied** and leaves the Inbox tab.
- **Instruct** sends the text as an instruction instead: the agent does what you
  asked and reports a fresh draft. The thread stays in the Inbox.
- **Discard draft** clears the box without sending anything.
- **Archive** hides the thread from the Inbox tab. A new message in that
  conversation brings it back as unread.
- **Open chat** jumps to the thread's chat to read the full transcript or talk
  to the agent directly.

Send and Instruct are unavailable on a thread whose source has no handler chat
(the **Notify** mode) or no reply hint; the thread still shows what arrived.

## Where things are stored

The Inbox keeps the last 2,000 threads and activity records in
`inbox.jsonl` under the data directory. Unread threads younger than seven days
are always kept. Inbox threads and cards are private: they are never included
in a share link.

## Related

- [Inbound webhooks](/guides/user/webhooks/) — HTTP deliveries that land here.
- [MCP sources](/guides/user/mcp-sources/) — conversations from an MCP server,
  such as Zalo, that land here.
- [Push notifications](/guides/user/push-notifications/) — get a **needs you**
  thread on your phone.
