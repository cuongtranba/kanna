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
   short summary and, for a **needs you** thread where a reply makes sense, a **draft**
   or a **proposal** to send. The agent never sends anything to the sender on its
   own: when it proposes a send, Kanna decides what happens (see
   [Autonomy](#autonomy-what-the-agent-may-do)).
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
| **Inbox** | Threads that are new, need you, or are FYI, unread first, grouped by day — plus attention items: a failed turn, a tool call waiting for your approval (until it is answered), a failed cron, subagent or loop run. Tool calls your permission policy approves or denies on its own never appear here. |
| **Activity** | Every event the server records — chats, turns, queue, tasks, cron, loops, subagents, webhooks, MCP messages — newest first, with filters by source, project, chat and *needs attention*, and **Load older** for history. |

Opening a thread marks it read. **Mark all read** clears the whole Inbox tab.

## Answering a thread

Open a thread to see its messages (**Show raw** reveals the exact payload), the
agent's read, and a reply box seeded with the draft. What you sent appears in
the thread between the messages that arrived, ordered by time.

- **Send** sends the text in the box to the sender. Press **Enter** to send and
  **Shift+Enter** for a new line; Enter does nothing while an input method is
  still composing text.
  - When the thread's [MCP source](/guides/user/mcp-sources/) has a **Reply
    tool**, Kanna calls that tool itself, with no agent turn. This works in every
    action, **Notify** included, and the button reads **Send**. The thread moves
    to **Replied** and leaves the Inbox tab once the tool reports success.
  - Otherwise, when the thread has a handler chat, the button reads **Agent
    will send**: Kanna asks the chat to send exactly that text through the
    source's own tools and to confirm what it sent, and the thread moves to
    **Replied** as soon as that request is queued.
- **Ask agent** asks the thread's agent to write or rewrite a reply. The text in
  the box is the instruction, and the answer always comes back as a new draft in
  the box. The agent never sends it to the sender, and the thread stays in the
  Inbox. Three ways to ask:
  - press **⌘↵** (**Ctrl+↵** on Windows and Linux), which asks and never sends;
  - press the **Ask agent** button;
  - start the text with `/` and press **Enter**: `/shorter please` asks the agent
    for "shorter please", with the `/` removed. Without a handler chat a leading
    `/` is just text and Enter sends it.
- **Quick prompts** under the box rewrite the draft already in it with one click:
  **Shorter**, **More polite**, **Translate** and **Reply in sender's language**.
  With an empty box they ask for a fresh draft in that style.
- **Draft chips** above the box keep the last five drafts the agent wrote for the
  thread, newest first, labelled by where they came from (`v3 · ask: Shorter`,
  `v1 · triage`). Click one to load it into the box. They survive a reload, and a
  new message in the conversation keeps them.
- **Discard draft** clears the box without sending anything. It does not bring
  the same draft back; a newer draft from the agent fills the box again.
- **Archive** hides the thread from the Inbox tab. A new message in that
  conversation brings it back as unread.
- **Open chat** jumps to the thread's chat to read the full transcript or talk
  to the agent directly.

Ask agent needs a handler chat (**Run in chat** or **New chat**), so it and the
quick prompts are unavailable in **Notify** mode and on an archived thread. Send is
unavailable only when the source has neither a reply tool nor a handler chat; the
thread still shows what arrived.

## Autonomy: what the agent may do

The agent can ask to send a reply, but it never sends by itself. In the thread
it calls `propose_send` with the text, a confidence between 0 and 1 and a reason,
and **Kanna** decides, in the server, what to do with it. How far that goes is the
**autonomy level**, set per [MCP source](/guides/user/mcp-sources/#autonomy) and
overridable per thread:

| Level | What a proposal becomes |
| --- | --- |
| **Off** | A draft in the reply box, like any other draft. |
| **Suggest** (default) | A draft, labelled `proposal` in the draft chips. |
| **Approve** | An **approval card** above the reply box: **Send**, **Edit** or **Reject**. Nothing goes out until you press Send. |
| **Auto** | The reply is sent by the agent after a short delay (30 seconds by default), unless a guardrail stops it. Until then the card reads **Sending in 0:24** with **Undo**. |

Pick the level for one thread with the **Autonomy** menu in its header: **Source
default (…)**, Off, Suggest, Approve or Auto. Approve and Auto are greyed out,
with the reason beside the menu, when the source has no **Reply tool**. Auto is
also greyed out when the source's handler runs a Codex model: only Claude
handler turns can be stopped from sending on their own, so Codex is capped at
Approve.

### Guardrails for Auto

Auto sends only when every guardrail passes. Otherwise the proposal becomes an
approval card that says why, naming the first rule that failed, checked in this
order:

1. the handler is a Claude model;
2. the contact is on the source's **Auto allowlist** (the thread header offers
   **Allow auto for this contact** when Auto applies and the contact is not on
   it);
3. the agent's confidence is at least the source's threshold;
4. the thread has not reached its auto-sends per hour;
5. the source has not reached its auto-sends per day;
6. it is outside the source's quiet hours;
7. the text has no link, markdown image or link, or HTML (unless the source
   allows links) and is within the character limit.

The hourly and daily caps count the agent's recent messages that Kanna still
holds, so they can undercount after an old thread is trimmed. A new message from
the sender expires a waiting proposal, because it answered an older message.

### Taking over, Undo and restarts

- **Undo** on a counting-down card cancels the send. If the send has already
  started, Undo is refused.
- When you send a reply yourself, or approve a card, the agent is **paused** on
  that thread for 30 minutes: it can still read and report, but its proposals
  become drafts. The header shows **Agent paused · Resume**; press **Resume** to
  hand the thread back. Typing in the box does not pause anything.
- **Edit** on a card puts its text in the reply box. Send it with Enter as your
  own reply, which also rejects the card.
- If Kanna restarts while an auto-send is counting down, it is **never** sent
  afterwards: the card comes back as an approval card saying Kanna restarted
  before the auto-send.
- In a triage or ask turn the agent cannot run shell commands or call the reply
  tool's server at all; it can only report and propose. That is enforced for
  Claude turns. Codex has no such guard, which is why Auto is not offered for it.

### Who sent what

Each message you see in the thread is labelled by who sent it: **You**, **You ·
approved** (an agent proposal you approved) or **Agent · auto**. Hover an agent
or approved label to see the confidence and reason. In **Activity**, the **Sent
by agent** filter lists the threads the agent has sent on.

### What happened to a message you sent

Each message sent directly shows a status under it:

| Status | Meaning |
| --- | --- |
| **Sending…** | The tool call is in progress. |
| **Sent** | The tool reported success. |
| **Failed: reason** | Nothing was delivered: the source, server or arguments were unusable, or the tool rejected the call. **Retry** sends the same text again as a new message. |
| **Not confirmed** | The request may have reached the sender, for example the connection dropped or Kanna restarted before it finished. Kanna never resends on its own. **Retry** first warns that the message may be delivered twice and sends only after you press **Send again**. |

The thread becomes **Replied** only after a message reaches **Sent**.

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
