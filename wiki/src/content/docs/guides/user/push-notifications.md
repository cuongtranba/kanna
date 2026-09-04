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

A device that is **currently looking at** that chat is skipped — you can already
see it. This is per device, so your phone still buzzes while your laptop has the
chat open. Repeats of the same transition are suppressed too, so a flapping chat
cannot spam you.

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
