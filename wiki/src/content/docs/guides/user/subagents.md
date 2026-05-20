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
