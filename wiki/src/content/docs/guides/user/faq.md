---
title: FAQ
description: Quick answers.
---

## Is Kanna free?

The Kanna software itself is free and open source. Underlying provider costs (Claude, Codex) depend on your account.

## Does Kanna upload my code anywhere?

No. The agent runs locally — `claude` or `codex` CLI subprocesses on your machine. Only the prompts and tool outputs you explicitly send go to the model.

## Does PTY mode actually save money vs the SDK?

If you have a Claude Pro/Max subscription, yes. PTY mode billing rolls into the subscription. SDK mode bills at API rates per-token.

## Can I use both Claude and Codex in the same chat?

Yes — switch providers mid-chat from the composer. Previous turns remain unchanged; the new turn uses the picked provider.

## Where is my data stored?

`$KANNA_HOME` (defaults to `~/.kanna/`). All chats, projects, OAuth tokens, and settings live there.

## Can I run Kanna headless?

Kanna is a web UI. The server runs headless; a browser is required for interaction. For automation, use the Claude/Codex CLIs directly.

## Windows support?

PTY mode is macOS/Linux only. SDK mode works on Windows via WSL but is not officially supported.
