---
title: Beacons
description: Pair another machine you own, so the agent can read, search, run and move files there inside limits you set.
---

A chat's own tools act on the machine that runs Kanna. When you reach Kanna
through a tunnel from a laptop or a phone, the files you care about often live
on a different computer, and before beacons you had to upload each one by hand.

A **beacon** closes that gap. It is a small companion program you install on a
machine **you own**. It dials out to your Kanna server, so it opens no inbound
port and works from behind NAT. Once you pair it, the agent can work on that
machine's files, and optionally run commands there, through a fixed set of
tools and only inside the scope you grant.

A beacon is **not remote control**. It does nothing until you pair it, it can
touch nothing you have not granted, every action is recorded, and you can
revoke it at any time.

Setup, step by step, is in the [Beacons user guide](/guides/user/beacons/).
This page explains what a beacon gives the agent and how it is kept safe.

## What the agent can do

A paired beacon gives the main agent ten tools. Each one names the beacon it
acts on, so one chat can work across several machines.

| Tool | What it does |
| --- | --- |
| `beacon_list` | Lists your paired machines with their label, short name, `@beacon/` handle, OS, and whether each is online and enabled. Reads metadata only. |
| `beacon_read` | Reads a window of a text file, so a large file can be paged through. |
| `beacon_stat` | Returns a path's size, kind and modification time without reading it. |
| `beacon_glob` | Lists the paths that match a glob pattern. |
| `beacon_grep` | Searches file contents under a folder and returns the matching lines. |
| `beacon_fetch` | Reads a whole file, binary included, in checksummed chunks. |
| `beacon_exec` | Runs one command with arguments, with no shell, and returns its exit code and output. |
| `beacon_script` | Runs a multi-line script. The approval prompt shows its full body. |
| `beacon_pull` | Copies one file from the beacon into the chat's project, streamed straight to disk. |
| `beacon_push` | Copies one project file onto the beacon, into a folder you allowed writes to. |

`beacon_pull` and `beacon_push` move the bytes over HTTP in 8 MiB pieces and
verify a SHA-256 on both ends, so the file never passes through the model and a
failed transfer never leaves a half-written file.

### Naming a machine in a message

Type `@beacon/` in the composer to pick a machine, for example
`@beacon/office-mac run uname`. The agent then knows which machine you mean and
skips the `beacon_list` lookup. The handle is the machine's **short name** (see
[Naming a machine](/guides/user/beacons/#naming-a-machine)); a machine with no
short name gets a handle made from its hostname. The mention only tells the agent
which machine you mean: it grants nothing, and every call is still weighed
against that machine's scope. Providers that have no Kanna tools, such as Codex,
receive your text unchanged.

The tools are offered to the **main chat only**. A subagent does not get them,
so delegating work never widens who can reach your machines.

## How it stays safe

Every beacon call passes two independent checks, one on each side of the
connection.

1. **Kanna decides before anything is sent.** Each call is weighed against that
   machine's scope and gets one of three verdicts: *allow* (inside what you
   pre-approved), *ask* (allowed, but not pre-approved, so an approval prompt
   appears in the chat), or *deny* (outside the scope, refused without asking).
   A disabled or offline beacon is refused outright.
2. **The beacon checks again on the machine.** It resolves every path to its
   real location, so a symbolic link cannot reach past your folders, and it
   refuses to run anything at all while running commands is turned off.

Scope is **default-deny**. A freshly paired machine can read nothing and run
nothing until you widen it:

| Setting | Default |
| --- | --- |
| Folders the agent may read | None |
| Folders the agent may write to | None |
| Allow running commands | Off |
| Commands that run without asking | None |
| Run without asking each time | Off |

Calls are also bounded per machine: 30 seconds per call, 1 MB of output, and
two calls at a time. The guide explains each setting and the one-time consent
behind turning off approval prompts:
[Grant scope](/guides/user/beacons/#grant-scope).

The rest of the trust model:

- **A Kanna password is required.** Without one, pairing is refused and every
  beacon connection is rejected, because whoever can sign into Kanna can use
  your beacons.
- **No shared secret.** Pairing uses a one-time code that expires after five
  minutes and stores a private key on the machine. From then on the beacon
  proves who it is by signing a challenge from the server.
- **A beacon cannot widen its own scope.** Kanna stores the grant. A change
  made on the machine, in the app, is checked by Kanna before it applies, and
  only Kanna can add write folders or always-allowed commands.
- **Updates come only from the official release.** Kanna tells a beacon to
  update, but never sends it a download address or a file. The beacon fetches
  Kanna's version from the GitHub release and checks it against the release's
  `SHA256SUMS` before replacing itself.
- **Every action leaves a record.** Each call shows in the chat transcript,
  and the Kanna Beacon app keeps a local record of what Kanna read and ran on
  that computer.

## Three ways to run one

| Build | For |
| --- | --- |
| **Kanna Beacon app** | macOS and Windows 10 or later: a small window plus a tray icon, with no terminal needed. |
| **`kanna-beacon` CLI** | Linux, servers and scripts: one binary for macOS, Linux or Windows, with `pair`, `run` and `version`. |
| **Windows 7 beacon** | Windows 7 and 8.1: a tray and a command-line build of the same protocol. |

All three share one identity per machine (`~/.kanna-beacon`), so pair with only
one of them. Each beacon keeps itself on the same version as your Kanna.

## Where to go next

- [Beacons user guide](/guides/user/beacons/): install, pair, grant scope, move
  files, update, revoke, and troubleshoot.
- [Security](/features/security-sandboxing/): how approvals work across all of
  Kanna's tools.
- [Env vars](/reference/env-vars/): the `KANNA_BEACON_*` variables a beacon
  reads on its own machine.
