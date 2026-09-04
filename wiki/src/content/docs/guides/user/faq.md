---
title: FAQ
description: Quick answers.
---

## Is Kanna free?

The Kanna software itself is free and open source. Underlying provider costs
(Claude, Codex, OpenRouter) depend on your account.

## Does Kanna upload my code anywhere?

No. The agent runs locally — `claude` or `codex` CLI subprocesses on your
machine. Only the prompts and tool outputs you explicitly send go to the model.

Telemetry (turn timings, memory, run counts — never prompt or code content) is
the one thing that leaves by default, and it is a single switch under
**Settings → General → Telemetry Tracing**.

## Which Claude plan does Kanna bill against?

Whichever plan the OAuth token you registered belongs to. Kanna passes your
token through to the Claude Agent SDK; add one in
[Settings → Providers](/getting-started/oauth-pool-setup/).

## Can I use both Claude and Codex in the same chat?

Yes — switch providers mid-chat from the composer. Previous turns remain
unchanged; the new turn uses the picked provider.

## Where is my data stored?

`~/.kanna` — chats, transcripts, settings, and your OAuth tokens. The path is
not configurable; it follows `HOME`, so relocating it means running Kanna with a
different `HOME`. See [Self-host basics](/guides/ops/self-host/#persistence).

## How do I set the port or a password?

They are CLI flags, not env vars: `kanna --port 8080 --password <secret>`.
`KANNA_PORT` and `KANNA_PASSWORD` do not exist and never have.

## Can I run Kanna headless?

The server runs headless, but Kanna is a web UI — a browser is required to
interact with it. For automation, drive the Claude/Codex CLIs directly, or use
[cron jobs](/features/cron-jobs/) and [loops](/features/loops/) inside Kanna.

## Windows support?

Not supported. macOS and Linux only; WSL works in practice but is not tested.

## Can several agents work at once without colliding?

Yes, if each has its own checkout. Starting work from a
[board card](/features/boards/) creates a branch and a git worktree per card,
which is what makes three concurrent agents safe. Several chats in the *same*
directory will happily overwrite each other's edits.
