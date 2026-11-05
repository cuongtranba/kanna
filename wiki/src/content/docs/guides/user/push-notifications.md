---
title: Push notifications
description: Get told on your phone when a chat finishes, fails, or needs an answer.
---

Kanna can send a web push notification when a chat changes state, so you can
start a long job and walk away instead of watching a spinner.

## What triggers one

Three transitions, and nothing else:

| Transition | Meaning |
| --- | --- |
| → **waiting for you** | The agent asked a question or wants a plan approved |
| → **failed** | The turn errored |
| running → **idle** | The turn finished |

The **done** notification is held back while the chat still has work in flight — a
background task, a running subagent or workflow, or an armed loop. It is sent once that
work finishes and the chat is idle again, so you are not told "done" while Kanna is
still working. It is also not sent after a turn you stopped yourself.

A device that is **currently looking at** that chat is skipped — you can already
see it. This is per device, so your phone still buzzes while your laptop has the
chat open. Repeats of the same transition are suppressed too, so a flapping chat
cannot spam you.

## Inbox notifications

The [Inbox](/guides/user/inbox/) sends two more notifications, one per source and
only when that source's **Send a push notification** switch is on:

| Notification | Sent when | Body |
| --- | --- | --- |
| New message that needs you | A thread enters **needs you** | The sender and the source |
| Agent wants to reply | An approval card opens on a thread | "Agent wants to reply" |

Both are never skipped because you are looking at a chat, and a thread whose agent
is paused after you replied raises no approval card, so it raises no notification.

Two opt-in switches change what they carry, both off by default:

- **Show a preview of the message in the notification** adds the latest message,
  or the proposed reply, cut to 140 characters. The text then passes through your
  browser vendor's push service and appears on your lock screen.
- **Add a Send button to the notification of an approval card** adds a **Send**
  action to the "Agent wants to reply" notification. It sends the proposed text
  with your signed-in browser session, with no password or token in the
  notification. If you are signed out, offline or the proposal is no longer
  waiting, it opens the thread instead and does not retry.

The Send button posts to `/api/inbox/proposals/approve`, which needs the same
session as the rest of the app and refuses a request that does not come from
Kanna's own origin. With no password set, anyone who can reach the server can
already use Kanna, and the endpoint follows that.

## Inside Kanna, without push

A chat waiting for you is also marked in two places that need no setup:

- **The browser tab title.** With one chat waiting it reads
  `[N] Needs input: <chat title> · Kanna`; with several, `[N] 3 chats need input · Kanna`.
  `N` counts every chat that needs attention, unread ones included.
- **The workspace tab strip.** When a chat starts waiting and has no tab, Kanna opens
  one in the background without taking focus from what you are reading. A tab you close
  while the chat is still waiting stays closed.

## Enable it

**Settings → General → Push notifications**, then **Enable on this device**. Your
browser will ask for permission. Use **Send test** to confirm delivery before
relying on it.

Enablement is **per device**: your laptop and your phone each opt in separately,
and each appears in the **Devices** list where you can remove any device but the
one you are on.

:::caution[Push requires HTTPS]
Browsers refuse push over plain HTTP, so `http://localhost:3210` cannot register
a subscription. Run `kanna --share` for a Cloudflare quick tunnel, or put Kanna
behind a domain with TLS, then enable from that URL.

This is also what makes push most useful — a tunnelled instance is one you can
actually check from your phone.
:::

## Set the contact subject

Push services require a contact address to sign notifications with — a
`mailto:` address or an `https:` URL on a routable domain (not `localhost`).
Set your own under the same section. Leave it wrong and some push services will
reject delivery outright, which looks like notifications silently not arriving.

## Mute what you do not care about

Per-project mutes are the main control: a project you have a cron job hammering
every five minutes does not need to reach your lock screen. Toggle projects in
the same settings section. Individual chats can be muted too.

## If notifications stop arriving

- **Check the device is still listed.** A browser can drop a push subscription;
  re-enable on that device.
- **Check the project is not muted.**
- **Check the contact subject is valid** — an unroutable one gets deliveries
  rejected by the push service, with nothing visible on Kanna's side.
- **Check that device is not just looking at the chat.** A device focused on a
  chat is never notified about it.
