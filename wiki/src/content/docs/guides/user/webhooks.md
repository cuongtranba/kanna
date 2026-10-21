---
title: Inbound webhooks
description: Let CI, GitHub, monitoring or a curl command tell Kanna that something happened — create a hook, pick what it does, sign the request, and understand who can reach it.
---

An **inbound webhook** is a url that an outside system can POST to. Kanna checks
the caller's secret, then reacts in one of three ways. Open **Webhooks** in the
sidebar to create and manage them. A **Slack** hook is a different kind that
answers `@Kanna` mentions in a Slack thread; see [Slack](#slack).

## Modes

| Mode | What a delivery does |
| --- | --- |
| **Notify** | Leaves a card in the chat you chose. No turn starts. |
| **Run in chat** (`inline`) | Leaves a card and queues a prompt in the chat you chose. It runs when that chat is idle, so a busy chat simply queues it. |
| **New chat** (`spawn`) | Creates a new chat in the project you chose, leaves a card, and runs the prompt there. |

Every delivery leaves a **Webhook** card in the chat it lands in, so you can see
what arrived and when. The card is private: it is never included in a share link.

## Handling

**Run in chat** and **New chat** hooks also choose how the agent treats your
instruction template. Every delivery opens a thread in the **Inbox** either way.

| Handling | What the agent does |
| --- | --- |
| **Triage** (default) | Reads the message, decides whether you need to act, writes a short summary and, when it fits, drafts a reply for you to send from the Inbox. It does not do the work itself and never contacts the sender. |
| **Run as task** | Treats your template as a request from you and carries it out with its tools, for example "fix the issue assigned to me, open a PR and merge it". It reports to the Inbox once, when it is done (**Handled**) or when it is blocked on something only you can decide (**Needs you**). |

Choose **Run as task** when the template is a job to do. With **Triage**, a
template such as "fix this bug" only produces a summary that asks you to start
the fix. In both modes the JSON body stays untrusted data, and the agent never
follows instructions written inside it.

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

Choose the pencil button on a hook to change its name, mode, handling, target,
model, template, filter, thread key path, sender path or reply hint. The url and the
secret stay the same. Clearing a field removes it.

## Filter deliveries

A sender often posts far more than you want to act on. A GitHub webhook
subscribed to **Issues** posts every opened, labeled, assigned, edited and closed
event, and GitHub cannot narrow that down. A **filter** on the hook does: Kanna
checks each authenticated delivery against it, and one that does not match is
answered `200` and dropped. No card, no prompt, no chat.

The filter is YAML in the shape of a GitHub Actions trigger, with an optional
[CEL](https://cel.dev) condition:

```yaml
on:
  issues:
    types: [assigned]
if: >-
  body.assignee.login == "octocat"
  && body.issue.labels.exists(l, l.name == "bug")
```

- **`on`** names the events to accept. The event is the `X-GitHub-Event` header.
  It can be one event (`on: issues`), a list (`on: [issues, pull_request]`), or a
  map where an event may list **`types`**, matched against the body's `action`.
  A delivery with no `X-GitHub-Event` header never matches an `on`.
- **`if`** is a CEL expression that must be `true`. It can read `body` (the JSON
  body), `event` (the `X-GitHub-Event` header, or empty) and `headers` (lowercase
  names; `authorization`, `cookie` and the signature headers are left out).
- Both are optional. A filter with only `if` works for any sender, for example
  `if: body.status == "failed"`.

A condition that reads a field the body does not have is an error, and an error
counts as no match, so `body.assignee.login` simply filters out events that have
no assignee. Write `has(body.assignee) && …` when you want to say so outright.
Quote an `if` that is a bare `true` or `false`, because YAML reads those as
booleans: `if: "false"`.

Kanna checks the filter when you save, and refuses a filter that is not valid
YAML, has a key other than `on` and `if`, uses YAML anchors, aliases or tags,
names an empty event list, or has a CEL syntax error or a variable other than
`body`, `event` and `headers`.

The hook row shows the last delivery, so a filtered one reads **Filtered** with
the reason, such as `action "labeled" not in types` or `if: false`.

To keep every event about one issue in one conversation, set **Thread key path**
to `issue.number`: in **New chat** mode, later deliveries for the same issue go to
the chat the first one created.

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

GitHub only lets you pick which events to send, not which actions or whose, so
add a [filter](#filter-deliveries) for the rest. GitHub's **Recent deliveries**
list then shows `200` with `"filtered": true` for each event Kanna ignored.

## Responses

| Status | Meaning |
| --- | --- |
| `202` | Delivered. The body has the `deliveryId` and the `chatId` it landed in. |
| `200` | `{"filtered": true}`: the delivery did not match the hook's filter. Nothing happened. Otherwise `{"duplicate": true}`: the same delivery id was already delivered. Nothing happened. |
| `401` | The secret or the signature is wrong. |
| `404` | No such hook, the hook is disabled, or webhooks are turned off. All three look the same. |
| `405` | The method is not `POST`. |
| `409` | The chat or project the hook points at no longer exists. |
| `413` | The body is larger than 256 KiB. |
| `429` | More than 20 deliveries in a minute for this hook. Honour `Retry-After`. |

A repeated delivery is recognised by its `X-GitHub-Delivery`, `Idempotency-Key`
or `X-Request-Id` header, in that order, so a retry is safe. The filter runs
first, so a filtered delivery does not use up its id and does not count toward
the 20-per-minute limit: after you fix a filter, GitHub's **Redeliver** goes
through.

## Slack

A **Slack** hook lets people in your workspace ask Kanna to work from a Slack
thread. Someone you have allowed mentions `@Kanna` in a thread, Kanna starts a
chat in the project you chose, and the agent's final reply is posted back into
the same thread. A follow-up mention in that thread continues the same chat.

Unlike a generic hook, a Slack hook does not go through the Inbox and the agent
does not stop to draft a reply for you to approve: a mention from an allowed
member is treated as an instruction, and the answer is posted automatically.

### What you need

- **A public HTTPS url for Kanna.** Slack sends events to the hook url, so it
  must be reachable from the internet. Use a named Cloudflare tunnel, as in
  [Cloudflare tunnel](/guides/ops/cloudflare-tunnel/). A quick tunnel gets a new
  url every time it starts, so you would have to update the Slack app each time.
  Kanna's dialog warns you when the page you are on is not a public HTTPS url.
- A Slack workspace where you can create and install an app.
- The Slack member ID of everyone who may use it.

### Set it up

1. Open **Webhooks**, choose **New webhook** and set **Kind** to **Slack**. The
   dialog shows a **Set up the Slack app** guide with an app manifest you can
   copy. Keep it open.
2. At [api.slack.com/apps](https://api.slack.com/apps) choose **Create New App**,
   then **From a manifest**, and paste the manifest. It names the app *Kanna* and
   asks for these bot scopes: `app_mentions:read`, `channels:history`,
   `groups:history`, `mpim:history`, `chat:write` and `reactions:write`. It also
   subscribes the app to the `app_mention` event.
3. **Install** the app to your workspace.
4. Copy the **Bot User OAuth Token** (it starts with `xoxb-`) from **OAuth &
   Permissions**, and the **Signing Secret** from **Basic Information**.
5. Find your member ID: open your Slack profile, choose **⋯**, then **Copy
   member ID**. It looks like `U01ABCDEF`.
6. Back in Kanna, give the hook a name, pick the **project** the chats should be
   created in, and paste the signing secret, the bot token and the allowed member
   IDs (up to 10, separated by commas or spaces). Optionally add **standing
   instructions** that go with every request, and a **model**. Choose **Create**.
7. Copy the hook's **Request URL** from the hook row or from the setup guide. In
   the Slack app, open **Event Subscriptions**, turn events on, paste the url and
   wait for Slack to show it as **Verified**. Subscribe to the bot event
   `app_mention` if it is not already listed, then save.
8. In each channel you want to use, run `/invite @Kanna`.

Kanna keeps the signing secret and the bot token and shows only their last four
characters afterwards. To change one, open the hook and type a new value; leave
the field blank to keep the saved one. There is no **Rotate secret** for a Slack
hook, because the signing secret comes from Slack.

### Use it

Mention `@Kanna` in a thread, or start a thread with a mention, and write what
you want:

> @Kanna why did the nightly build fail? Look at the log above.

- Kanna adds a 👀 reaction to your message while it works. It becomes a
  ✅ when the reply is posted and an ❌ if the turn failed, was
  cancelled, or the reply could not be posted.
- The reply is the agent's final message of the turn. A reply longer than Slack
  allows is split into up to four messages and cut off with a pointer back to
  Kanna if it is longer still.
- Each thread has its own chat, named *Slack · …* in the project you chose. A
  later mention in the same thread continues that chat and shows the agent only
  the thread messages added since the last time.
- The agent can read the thread, so you can mention it under a message you want
  it to look at. The thread text is passed as data, not as instructions.
- Only a mention from an allowed member does anything. Mentions from anyone else,
  from bots, and edits to a message are ignored, and the hook row records why.

If the agent needs your approval to run a tool, the turn waits in Kanna. Slack
does not show the question, so open the chat in Kanna and answer it there.

### Security

- **Only the allowed member IDs can start work.** Every request must also carry a
  valid Slack signature; one that does not answers `401` and does nothing.
- **Thread content is untrusted.** Anyone who can post in the thread can try to
  steer the agent through what they write, even though only you can start it.
- **The reply goes to the channel.** The agent's final message is posted as it
  is, so anything it quotes from your repository is visible to everyone in that
  channel. Use a **private channel**, with only people who may see that project,
  for anything sensitive.
- The signing secret and the bot token are stored in `webhooks.json` in the Kanna
  data directory, readable only by your user, and are never shown again. The
  link between a Slack thread and its chat is stored in `slack-threads.json` in
  the same directory with the same permissions.
- Kanna remembers recent Slack event ids in memory only, so after a restart a
  retried mention can run twice.

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
your user. For a Slack hook these are the signing secret and the bot token. They are never sent back to the browser after creation, only the last
four characters, and they never appear in logs or transcripts.
