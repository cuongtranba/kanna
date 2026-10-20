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
| **Subscribe** | Keeps a connection open and asks the server to tell it when the resources you name change. Each change is read once. |
| **Poll** | Calls a tool you name every few seconds. Kanna remembers a cursor, so each message is delivered once. |

Subscribe needs a server that supports resource subscriptions. Servers that speak
the 2026-07-28 revision are asked to listen; older servers are subscribed
resource by resource. If the server accepts none of your URIs, the source shows
an error saying so.

## Add a source

1. Choose **Add source**, name it and pick the server.
2. For **Subscribe**, list the resource URIs, one per line.
3. For **Poll**, fill in:
   - **List tool**, and its **Arguments** as a JSON object.
   - **Cursor argument**, the argument Kanna fills with the cursor from the last
     poll, and **Cursor path**, where the next cursor sits in the result.
   - **Items path**, where the array of messages sits in the result, and
     optionally an **Item key path**, a field that is unique per message. Without
     one, Kanna hashes the whole message.
   - **Interval**, between 5 and 3600 seconds.
4. Set the **Thread key path** so messages from one conversation share one Inbox
   thread, and the **Sender path** for the name shown on it. Paths use the same
   `a.b.0.c` notation as webhook templates.
5. Choose what happens to each message, the same three actions as a webhook:
   **Notify**, **Run in chat** or **New chat**. Write the instruction template,
   and the **Reply hint** that tells the agent how to send a reply through the
   server's tools when you answer from the Inbox.

The first poll of a source with no cursor delivers whatever the tool returns. If
the tool returns a long history and the action is **New chat**, you get a chat
for every conversation in it.

### The Zalo preset

**Zalo preset** fills the form for a Zalo MCP server that offers
`zalo_get_messages`: it polls every 15 seconds with a `since` cursor, groups
messages by `threadId`, shows `senderName`, and starts a new chat per
conversation. Pick the server and the project, then save.

## Reading the status

Each row shows one of these:

| State | Meaning |
| --- | --- |
| **Listening** or **Polling** | The source is connected and working. |
| **Connecting** | Kanna is opening the connection. |
| **Retrying** | The last attempt failed. Kanna tries again with a growing delay, up to a minute for subscriptions and five times the interval for polls. The error is shown under the name. |
| **Error** | The source cannot work as configured, for example the server is missing or disabled. |
| **Disabled** | You turned it off. |

Disabling or deleting a source stops its connection. Editing it, or editing its
server, reconnects it.

## What is kept

Kanna keeps the cursor and the keys of the 256 most recent messages per source
in `mcp-source-cursors.json` in its data directory, so a restart does not deliver
old messages again. Deleting a source forgets them. A message that fails to
deliver, for example because the target project no longer exists, is retried on
the next poll.

## Reply from the Inbox

Replying to a thread sends your text through the same server: the handler chat is
told to use the server's tools, following your reply hint. For Zalo that is
`zalo_send_message` with the thread's `threadId`. Kanna never sends anything to
the sender by itself.
