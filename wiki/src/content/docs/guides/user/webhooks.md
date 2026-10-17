---
title: Inbound webhooks
description: Let CI, GitHub, monitoring or a curl command tell Kanna that something happened — create a hook, pick what it does, sign the request, and understand who can reach it.
---

An **inbound webhook** is a url that an outside system can POST to. Kanna checks
the caller's secret, then reacts in one of three ways. Open **Webhooks** in the
sidebar to create and manage them.

## Modes

| Mode | What a delivery does |
| --- | --- |
| **Notify** | Leaves a card in the chat you chose. No turn starts. |
| **Run in chat** (`inline`) | Leaves a card and queues a prompt in the chat you chose. It runs when that chat is idle, so a busy chat simply queues it. |
| **New chat** (`spawn`) | Creates a new chat in the project you chose, leaves a card, and runs the prompt there. |

Every delivery leaves a **Webhook** card in the chat it lands in, so you can see
what arrived and when. The card is private: it is never included in a share link.

## Create a hook

1. Open **Webhooks** and choose **New webhook**.
2. Give it a name, pick a mode, and pick the chat or project it acts on. The
   picker is searchable: type part of a project name or its folder path, or part
   of a chat title.
3. For **Run in chat** and **New chat**, optionally pick a **Model**. Leave it on
   **Default model** to use the chat's own model, or the provider default for a
   new chat.
4. Write the **instruction template**. `{{path.to.field}}` inserts a value from
   the JSON body, for example `{{repository.full_name}}` or `{{runs.0.status}}`.
   A missing field renders empty and an object or list renders as compact JSON.
5. Choose **Create**. Kanna shows the secret **once**, with ready-made commands.
   Copy it now. If you lose it, rotate the secret to get a new one.

For `inline` and `spawn`, the prompt is your template followed by the JSON body
in a fenced block, cut off at 16,000 characters. The block is introduced as
external data that the agent must treat as data and not as instructions.

A model chosen on the hook applies only to the turn that hook starts. In **Run in
chat** mode it does not change the model you picked for that chat, so your next
message runs on your own choice again. Only models offered in **Settings →
Models** and **Custom endpoints** can be chosen; Kanna refuses a model it does
not offer rather than silently running a different one.

## Edit a hook

Choose the pencil button on a hook to change its name, mode, target, model or
template. The url and the secret stay the same.

:::caution
A `{{placeholder}}` puts the caller's text **into your instruction**, outside that
fenced block. If the field can be written by someone you do not trust, such as a
pull request title, an issue body, or a commit message, that person can steer the
agent. Use placeholders only for fields the sender controls, like a build number
or a status, and let the agent read untrusted text from the fenced body instead.
:::

## Send a delivery

The url is `<your Kanna URL>/hooks/<id>`. Send a `POST` with either credential.

**Bearer secret**

```bash
curl -X POST 'http://localhost:3210/hooks/<id>' \
  -H 'Authorization: Bearer <secret>' \
  -H 'Content-Type: application/json' \
  -d '{"status":"failed"}'
```

**HMAC signature** (the same scheme GitHub uses)

```bash
BODY='{"status":"failed"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac '<secret>' | sed 's/^.* //')
curl -X POST 'http://localhost:3210/hooks/<id>' \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -H 'Content-Type: application/json' \
  -d "$BODY"
```

The signature is the HMAC-SHA256 of the **raw request body**, so sign exactly the
bytes you send.

### GitHub

In the repository, open **Settings → Webhooks → Add webhook**. Set the payload
url to the hook url, the content type to `application/json`, and the secret to
the hook's secret. GitHub signs every delivery with `X-Hub-Signature-256`.

## Responses

| Status | Meaning |
| --- | --- |
| `202` | Delivered. The body has the `deliveryId` and the `chatId` it landed in. |
| `200` | The same delivery id was already delivered. Nothing happened. |
| `401` | The secret or the signature is wrong. |
| `404` | No such hook, the hook is disabled, or webhooks are turned off. All three look the same. |
| `405` | The method is not `POST`. |
| `409` | The chat or project the hook points at no longer exists. |
| `413` | The body is larger than 256 KiB. |
| `429` | More than 20 deliveries in a minute for this hook. Honour `Retry-After`. |

A repeated delivery is recognised by its `X-GitHub-Delivery`, `Idempotency-Key`
or `X-Request-Id` header, in that order, so a retry is safe.

## Who can reach a hook

A hook url is reachable **wherever Kanna is reachable**. By default Kanna listens
on `localhost` only, so only programs on your machine can call it. Starting Kanna
with `--remote`, `--share`, or a tunnel puts the url on the internet, and then the
secret is the only thing between a stranger and your agent. Keep these in mind:

- Treat the secret like a password and rotate it if it leaks.
- Prefer **Notify** for hooks that anyone could trigger, because it starts no
  turn.
- Disable or delete a hook you no longer use. Deleted hooks answer `404`.

Hooks work without `--password`, because the hook secret is the credential and
not your session. Set `KANNA_WEBHOOKS=disabled` to turn the whole feature off.

## Where secrets are stored

Secrets live in `webhooks.json` in the Kanna data directory, readable only by
your user. They are never sent back to the browser after creation, only the last
four characters, and they never appear in logs or transcripts.
