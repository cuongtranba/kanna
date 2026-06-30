---
title: Subagents
description: When and how to delegate to subagents.
---

## What is a subagent

A subagent is a named, prompt-shaped specialist (`description`, `systemPrompt`) that the main agent can delegate to via `mcp__kanna__delegate_subagent`. Kanna ships first-class CRUD, mentions, parallel runs, and live progress.

## When the main agent delegates

`@agent/<name>` in chat input is a **hint**, not server-side routing. The main model decides whether to delegate. It calls the MCP tool with `{ subagent_id, prompt }` and the tool blocks until the run completes.

## Subagent UI

- **Sidebar panel:** lists all configured subagents with their description
- **Live activity label:** shows what each running subagent is currently doing (MCP progress notifications)
- **Parallel runs:** multiple subagent runs can be in-flight in the same turn

## Creating a subagent

1. Settings → **Subagents** → **Add**
2. Fill in `name`, `description` (this is what the main agent reads to decide when to delegate), and `systemPrompt`
3. Save

## Cycle detection

`LOOP_DETECTED` is returned when a subagent tries to delegate to itself or to an ancestor in the chain. `DEPTH_EXCEEDED` when `depth > maxChainDepth` (default 1).

## Delegation modes

The main agent picks how to run a subagent through `delegate_subagent`:

- **Blocking (default):** `delegate_subagent({ subagent_id, prompt })` runs one turn and blocks until the subagent's final reply comes back, which the main agent then synthesizes into its own turn.
- **Keep-alive (multi-turn):** `delegate_subagent({ ..., keep_alive: true })` leaves the subagent's session warm after the first reply. The reply includes a `run_id`. The main agent drives further turns into the **same** warm session with `send_subagent_message({ run_id, prompt })`, and tears it down with `close_subagent({ run_id })`. No re-spawn, no re-trust, warm cache. Claude only (Codex rejects `keep_alive`).
- **Background:** `delegate_subagent({ ..., run_in_background: true })` launches without blocking the main turn — it returns immediately with `{ status: "async_launched", run_id }`, and the subagent's final reply is delivered back into the chat as a fresh turn when it finishes. Works for any provider. Mutually exclusive with `keep_alive`.

## Bounds

- `KANNA_SUBAGENT_MAX_LIVE` (default 5) — max concurrent keep-alive processes per chat. Over cap, `keep_alive` delegation fails `CAP_EXCEEDED`.
- `KANNA_SUBAGENT_IDLE_TIMEOUT_MS` (default 300000) — an idle keep-alive session auto-closes after this window; the timer resets on each turn.
- Concurrent **active** turns are bounded by the shared permit pool; cancelling the chat or run cascade-closes every live session.
