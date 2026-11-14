---
title: Messaging between chats
description: Let an agent in one chat message an agent in another chat, in any project — what it can send, how it arrives, how to turn it off, and the limits that stop two chats looping.
---

Agents in different chats can talk to each other. A backend chat can tell a
client chat that a schema changed, or ask a research chat for an answer, without
you copying the text across. It works between Claude and Codex chats, in any
project on the same Kanna server.

## How it works

Every agent in a chat's main conversation gets three tools:

| Tool | What it does |
| --- | --- |
| `list_peer_chats` | Lists the other chats it can message: id, title, project, provider, status (`idle`, `working` or `waiting_for_user`) and whether the chat accepts messages. |
| `send_chat_message` | Sends a message to one chat by id. Optionally asks to be told when that chat next goes idle (`notify_when_idle`), answers a message (`reply_to`), or addresses one running subagent of that chat (`run_id`). |
| `wait_for_chat_message` | Waits, during the agent's own turn, for the next message from another chat (optionally from one chat only) and returns it. It gives up after 120 seconds by default, 600 at most. |

Messages are **accepted automatically**. There is no approval card.

- If the target chat is **idle**, the message starts a turn there at once.
- If it is **busy**, the message is handed to the running turn: the agent reads
  it at its next step, after the tool it is running finishes, and can change
  course straight away. A Claude chat that is writing its final answer reads it
  as soon as that answer ends; a Codex chat reads it within the same turn.
- If the chat is waiting on you (a question or a permission prompt), or a turn
  has already taken five messages from other chats, the message waits in the
  queue and runs when the current turn ends.

`send_chat_message` reports which happened: `delivered`, `injected` (handed to
the running turn) or `queued`. The message stays in the chat's queue until the
agent has actually read it, so a restart or a Stop never loses it. Pressing
**Stop** never lets a pending message run afterwards; it stays queued.

The message shows in the target's transcript with a **from chat · title** label.
Click it to open the chat that sent it. The agent reading it is told that the
text came from another agent, not from you, and that it cannot approve tools or
change settings. A message is always plain text: it never runs as `/clear`, a
slash command or a skill in the target chat.

Replies come back the same way, as a message into the sender's chat. Each
message carries a `message_id`; an answer passes it as `reply_to`, so the sender
can tell which question it answers.

## Subagents

A Claude [subagent](/guides/user/subagents/) can use these tools too. Its
messages are labelled with the chat it runs in and its own run and name, and a
reply that names its `run_id` goes straight into that subagent while it is still
running. If the subagent has already finished, or runs as a keep-alive session,
the reply goes to its chat instead. Codex subagents cannot message other chats.

## Notify when idle

`notify_when_idle` is a one-shot request: when the target chat finishes and has
nothing queued, the sender gets a short "this chat is now idle" message. It
fires once and expires after 12 hours. Subscriptions live in memory, so they are
**lost when Kanna restarts**.

## Turning it off

- **For every chat:** open **Settings → General** and set **Messages from other
  chats** to **Refuse**. The default is **Accept**.
- **For one chat:** open the chat's menu in the sidebar and choose **Stop
  accepting chat messages** (or **Accept messages from other chats**). The
  per-chat choice overrides the global one.

A chat that refuses still appears in `list_peer_chats`, marked as not accepting,
so the sender can see why a send failed.

## Limits

These stop one chat from flooding or looping with another. A send that breaks one
is refused with a reason the agent can read.

- A message is at most 100,000 characters.
- An identical message to the same chat within 60 seconds is dropped.
- One chat can send at most 6 messages a minute and 60 an hour to the same target.
- One turn takes at most 5 messages from other chats while it runs; later ones wait for the turn to end.
- A chat holds at most 20 queued messages from other chats.
- Archived and deleted chats cannot be messaged, and a chat cannot message itself.
- The main agent of a chat and its Claude subagents can send. Codex subagents
  cannot, and neither can an [Inbox](/guides/user/inbox/) triage turn.

## Codex chats

Codex receives the tools when its thread is created, so a Codex chat that
started before you updated Kanna keeps working without them. Start a new Codex
chat to use messaging from Codex. Claude chats get the tools when their session next starts, so a chat that is already open picks them up after it goes idle and restarts or after you /clear it.

## Related

- Outside clients message chats through [remote MCP](/guides/user/remote-mcp/#where-a-message-came-from);
  chat-to-chat messaging is the same idea for agents Kanna runs itself.
