---
title: Chat & Transcript
description: Rendering, diffs, terminal, uploads, slash commands, plan mode, subagents, background tasks, auto-continue, compaction.
---

import Screenshot from '../../../components/Screenshot.astro'

## Rich transcript rendering

Tool calls render hydrated with collapsible groups. File diffs render inline. Plan-mode dialogs and interactive prompts get first-class UI with full result display.

<Screenshot
  light="/screenshots/light/transcript-tool-call.png"
  dark="/screenshots/dark/transcript-tool-call.png"
  alt="Expanded tool call group"
/>

## Inline diff viewer

File diffs and commit diffs render directly in the transcript — no need to switch contexts.

<Screenshot
  light="/screenshots/light/transcript-diff.png"
  dark="/screenshots/dark/transcript-diff.png"
  alt="Inline diff viewer"
/>

## Embedded terminal

Per-project xterm terminal in a resizable side panel. macOS and Linux only.

<Screenshot
  light="/screenshots/light/terminal-panel.png"
  dark="/screenshots/dark/terminal-panel.png"
  alt="Embedded xterm terminal panel"
/>

## Slash commands & @-mentions

The composer offers in-place pickers for slash commands, file mentions, and subagent mentions.

<Screenshot
  light="/screenshots/light/composer-mention.png"
  dark="/screenshots/dark/composer-mention.png"
  alt="@-mention picker open in composer"
/>

## Plan mode

The agent proposes a plan, and Kanna shows a structured approval dialog before any tool runs. Routes through Kanna's durable approval protocol — see [Security & Sandboxing](/features/security-sandboxing/).

<Screenshot
  light="/screenshots/light/plan-mode.png"
  dark="/screenshots/dark/plan-mode.png"
  alt="Plan-mode approval dialog"
/>

## Subagent orchestration

`@agent/<name>` is a hint to the main agent. The main agent decides whether to delegate via `mcp__kanna__delegate_subagent`. Runs are tracked live.

<Screenshot
  light="/screenshots/light/subagent-run.png"
  dark="/screenshots/dark/subagent-run.png"
  alt="Live subagent activity label"
/>

See [Subagent Delegation](/guides/user/subagents/) for the full pattern.

## Background tasks

Long-running tasks are tracked out-of-band with a status indicator. Pending tool requests survive server restart and replay on reconnect (when `KANNA_MCP_TOOL_CALLBACKS=1`).

## Auto-continue

Optionally continue a turn automatically when the agent stops short. Toggleable per-chat.

## Proactive compaction

A context-window meter shows usage near the threshold. Kanna runs automatic transcript compaction before limits are hit.

<Screenshot
  light="/screenshots/light/compaction-meter.png"
  dark="/screenshots/dark/compaction-meter.png"
  alt="Context-window meter near threshold"
/>

## File & image uploads

Drag and drop files or images into the composer to attach them to the next turn.
