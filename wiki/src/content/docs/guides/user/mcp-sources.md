---
title: MCP sources
description: Bring messages from an MCP server you already added, such as Zalo, into the Inbox by subscription or by polling, and answer them from the same place.
---

An **MCP source** tells Kanna to connect to one of your MCP servers itself and
turn what arrives into **Inbox** threads. Where an inbound
[webhook](/guides/user/webhooks/) waits for an outside system to call Kanna, a
source goes and fetches. Open **Settings → MCP sources** to add and manage them.

## Before you start

Add the server first under **Settings → MCP servers** and test it. A source
reuses that server, including its headers and its OAuth sign-in, so there is
nothing to authenticate twice.

Prefer an `http` or `sse` server. A `stdio` server started for a source is a
separate process from the one your chats use, with its own state. WebSocket
servers cannot be used as a source.

## How messages arrive

| Mode | What Kanna does |
| --- | --- |
| **Subscribe** | Keeps a connection open and asks the server to tell it when the resources you name change. Kanna then reads the changed resource and delivers each message in it once. |
| **Poll** | Calls a tool you name every few seconds. Kanna remembers a cursor, so each message is delivered once. |

Subscribe needs a server that supports resource subscriptions. Servers that speak
the 2026-07-28 revision are asked to listen; older servers are subscribed
resource by resource, and only if they advertise the `resources.subscribe`
capability. If the server accepts none of your URIs, the source shows an error
saying the server does not support resource subscriptions.

A notification only says that a resource changed, so Kanna reads it every time.
It also reads every resource right after it connects, which catches up on
anything that arrived while it was disconnected. Pushes that arrive while a read
is running are merged into one more read.

## Add a source

1. Choose **Add source**, name it and pick the server.
2. For **Subscribe**, list the resource URIs, one per line, and optionally:
   - **Items path**, where the array of messages sits in the resource, and an
     **Item key path**, a field that is unique per message. Messages are then
     delivered one by one and each is delivered once, even when a later read
     repeats it. Without an items path, the whole resource is one message and is
     delivered again whenever its content changes.
   - **Resync every**, between 5 and 3600 seconds. Kanna re-reads the resources
     on this timer to pick up anything a missed notification left behind.
3. For **Poll**, fill in:
   - **List tool**, and its **Arguments** as a JSON object.
   - **Cursor argument**, the argument Kanna fills with the cursor from the last
     poll, and **Cursor path**, where the next cursor sits in the result.
   - **Items path**, where the array of messages sits in the result, and
     optionally an **Item key path**, a field that is unique per message. Without
     one, Kanna hashes the whole message.
   - **Interval**, between 5 and 3600 seconds.
4. Set the **Thread key path** so messages from one conversation share one Inbox
   thread, and the **Sender path** for the name shown on it. Optionally set the
   **Text path**, the field that holds the message text: the Inbox shows it as
   the preview instead of the raw JSON of the message. The handler template, the
   prompt and **Show raw** still see the whole message. Paths use the same
   `a.b.0.c` notation as webhook templates.
5. Choose what happens to each message, the same three actions as a webhook:
   **Notify**, **Run in chat** or **New chat**. Write the instruction template,
   and the **Reply hint** that tells the agent how to send a reply through the
   server's tools when you answer from the Inbox without a reply tool.
6. Optionally fill in the **Reply tool** so Kanna can send replies itself; see
   [Reply from the Inbox](#reply-from-the-inbox).

The first poll of a source with no cursor delivers whatever the tool returns. If
the tool returns a long history and the action is **New chat**, you get a chat
for every conversation in it.

### The Zalo preset

**Zalo preset** fills the form for a Zalo MCP server that exposes the
`zalo://inbox` resource and pushes resource updates (a `zalo-mcp` build with
resource subscriptions). It subscribes to `zalo://inbox`, splits it at
`messages` with `id` as the item key, resyncs every 5 minutes, groups messages
by `threadId`, shows `senderName`, previews `text`, and starts a new chat per conversation. Its
reply tool is `zalo_send_message`, with the thread's `threadId`, a `threadType`
of 0 for `dm` and 1 for `group`, and your text. Pick the server and the project,
then save.

## Reading the status

Each row shows one of these:

| State | Meaning |
| --- | --- |
| **Listening** or **Polling** | The source is connected and working. |
| **Connecting** | Kanna is opening the connection. |
| **Retrying** | The last attempt failed. Kanna tries again with a growing delay: for subscriptions it doubles from one second up to a minute, and starts over only after a connection has held for a minute; for polls it is up to five times the interval. The error is shown under the name. |
| **Error** | The source cannot work as configured, for example the server is missing or disabled. |
| **Disabled** | You turned it off. |

Disabling or deleting a source stops its connection. Editing it, or editing its
server, reconnects it.

## What is kept

Kanna keeps the cursor and the keys of the 256 most recent messages per source
in `mcp-source-cursors.json` in its data directory, so a restart does not deliver
old messages again. Deleting a source forgets them. A message that fails to
deliver, for example because the target project no longer exists, is retried on
the next poll, or for a subscription on the next notification, reconnect or
resync.

## Reply from the Inbox

Replying to a thread sends your text through the same server.

**With a reply tool**, Kanna calls the tool itself when you press **Send**, with
no agent turn, in every action including **Notify**. Fill in the **Reply tool**
section of the source:

- **Tool name**: the server's send tool. Leave it empty to send through the
  handler chat instead.
- **Arguments**: a JSON object sent with the call. A string may contain
  `{{message.<field>}}`, a field of the latest message in the thread, and
  `{{reply.text}}`, your reply. A value that is exactly one placeholder keeps its
  type, so `"{{message.count}}"` stays a number. To turn a value into another,
  use `{"from": "message.threadType", "map": {"dm": 0, "group": 1}}`; add a
  `default` for values the map does not list. A field that is missing or empty
  fails the send before anything is sent.
- **Result id path**: optional, where the sent message's id sits in the tool
  result, so Kanna does not ingest its own message when it comes back.

The Inbox shows whether each message was sent, failed or could not be confirmed.
Kanna never sends a message twice on its own; see
[What happened to a message you sent](/guides/user/inbox/#what-happened-to-a-message-you-sent).

**Without a reply tool**, the handler chat is told to use the server's tools,
following your reply hint, and it sends the text. Kanna does not send anything
itself, and a source in **Notify** mode has no chat to do it.
