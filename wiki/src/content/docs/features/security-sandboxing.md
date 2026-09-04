---
title: Security
description: Durable approvals, the password gate, share-link exposure, and what Kanna does not do.
---

Kanna runs agents on your machine with your credentials. This page is about what
that means and which controls are real.

## Durable approval protocol

Plan-mode approvals and `AskUserQuestion` prompts are parked as **durable**
requests rather than in-memory promises. A pending request survives a server
restart (resolved fail-closed as `session_closed` on boot) and replays to the
browser on reconnect, so a question cannot silently strand a chat.

Set `KANNA_MCP_TOOL_CALLBACKS=1` to route them, plus a set of built-in tool
shims, through that protocol. Optional `KANNA_SERVER_SECRET` stabilises request
ids across a process lifetime.

Requests time out after 600 s as an explicit deny — never as an approval.

## Password gate

`kanna --password <secret>` puts an HTTP/WS/API password gate in front of
everything. Every browser session prompts on first connect; the password is
held in `sessionStorage` and replayed on the WebSocket handshake and HTTP
headers.

Use it for any instance reachable beyond localhost. Kanna does not terminate
TLS — put it behind a reverse proxy or a Cloudflare tunnel
([Self-host basics](/guides/ops/self-host/#reverse-proxy)).

## Share links are public by token

A [read-only share link](/sharing/session-share/) is unauthenticated by design:
`/share/:token` is one of the only two paths that bypass the password gate, and
the 256-bit token in the URL is the entire credential. Treat a share URL as a
secret, and revoke it when you are done.

## Isolation between agents

Kanna does not sandbox the agent process — it runs with your user's
permissions and can read and write whatever you can. What it *does* give you is
**separation between concurrent agents**: starting work on a
[board card](/features/boards/) puts that agent in its own git worktree on its
own branch, so three agents working at once cannot touch each other's files.

If you need stronger isolation than your own user account:

- Run Kanna inside a dedicated VM or container with no host credential access.
- Keep plan mode and `AskUserQuestion` routed through the durable approval
  protocol above, so gates stay in your hands.
- Give the agent a checkout it is allowed to break, not your only copy.

## Credential storage

Claude OAuth tokens, custom MCP server credentials and OAuth state all live in
`~/.kanna/data/settings.json`, written mode `0600`. Kanna stores nothing outside
`~/.kanna`, and sends credentials nowhere except the provider they belong to.

Back that file up as a secret, or exclude it from backups entirely.

## What Kanna does NOT do

- **No code upload.** The agent runs locally as a `claude` / `codex` subprocess.
  Only the prompts and tool output you send reach a model.
- **No remote control surface** beyond a Cloudflare tunnel you approve per
  `expose_port` call, or `--share` / `--cloudflared` that you pass yourself.
- **No credential storage outside `~/.kanna`.**

Telemetry is the one thing that leaves the machine by default: OpenTelemetry
traces and metrics (turn timings, subagent runs, process memory — never prompt
or code content) go to Kanna's collector. It is a single switch under
**Settings → General → Telemetry Tracing**, and turning it off stops the export
immediately.
