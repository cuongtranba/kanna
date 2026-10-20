---
title: Service bus (NATS)
description: Mirror every durable event Kanna records into a NATS JetStream stream, with a server Kanna manages for you or one you run, and read it with the nats CLI.
---

Kanna publishes every durable fact it records — chats created, messages sent,
tasks changed — on an in-process **service bus**. The **Service bus** settings
page can mirror that stream into **NATS JetStream**, so other programs can read
it with the `nats` CLI or any NATS client.

The mirror is a copy. Kanna's own history is still kept in its usual log files,
and Kanna works the same with the mirror off. If the NATS server is slow, down
or full, Kanna keeps going: it holds a small backlog, retries each message once
and then drops it, and counts what it dropped.

## Turn it on

Open **Settings → Service bus** and switch **Mirror to NATS** to **Enabled**.

### Embedded (the default)

Kanna manages a `nats-server` for you.

1. On first start Kanna downloads `nats-server` **v2.15.1** (about 7 MB) from
   the official `nats-io/nats-server` GitHub release.
2. It checks the download against the release's `SHA256SUMS` file and refuses it
   if the hash does not match.
3. It starts the server on `127.0.0.1` only, on a free port, with a private
   token it generates for you, and restarts it if it exits.

The embedded server supports **macOS and Linux** in this release. On Windows,
use external mode. If you are offline the first time, the page shows the error
and a **Retry** button.

### External

Choose **External**, enter the server URL (for example
`nats://nats.internal:4222`) and, if the server needs one, its token. The server
must have JetStream enabled.

## The stream

Kanna creates the stream on every connect, or updates it if you changed the
settings. Open the **Stream** group to set:

| Setting | Meaning |
| --- | --- |
| Stream name and subject prefix | The stream holds `<prefix>.>`. The default is `KANNA` and `kanna`. |
| Extra subjects | More subjects the stream also captures. |
| Retention, storage, replicas | Changing these needs the stream recreated. Kanna never deletes a stream, so the page tells you which field to fix and leaves the stream as it is. |
| Max age, max bytes, max messages | Limits. Lowering one drops older messages. |
| Duplicate window | Kanna sends each message with a deterministic id, so a retry inside this window is stored once. |

The **Consumers** group creates durable pull consumers. Kanna marks the ones it
creates and only ever deletes those; consumers you add yourself are left alone.
The **Embedded server** group sets the memory and file limits, the port and the
log level, and **Reset store** wipes the embedded server's messages.

## Read it

```bash
nats --server nats://127.0.0.1:<port> --token <token> stream info KANNA
nats --server nats://127.0.0.1:<port> --token <token> sub 'kanna.>'
nats --server nats://127.0.0.1:<port> --token <token> consumer next KANNA <consumer>
```

The page shows the live port. Each message is one JSON envelope with the
subject, the source, a timestamp and the event payload. Assistant text and tool
output are not published, and neither are session tokens.

## Security

- The embedded server listens on loopback only and requires the token.
- The token lives in `settings.json`, which is written with the default file
  mode (0644), like the other secrets stored there. Anyone who can read your
  Kanna data directory can read it. The server's own config file is created at
  mode 0600.
- The settings page shows only the last four characters of the token and never
  reads the full value back.
- Setting `KANNA_NATS_RELEASE_BASE` points the installer at another mirror of
  the release files; it still checks every download against that mirror's
  `SHA256SUMS`.
