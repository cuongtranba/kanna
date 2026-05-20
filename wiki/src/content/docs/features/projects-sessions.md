---
title: Projects & Sessions
description: Sidebar, project ordering, discovery, bulk import, worktrees, resumption, auto-titles.
---

import Screenshot from '../../../components/Screenshot.astro'

## Project-first sidebar

Chats are grouped under projects with live status indicators (idle, running, waiting, failed).

<Screenshot
  light="/screenshots/light/sidebar-projects.png"
  dark="/screenshots/dark/sidebar-projects.png"
  alt="Sidebar with project groups and status indicators"
/>

## Drag-and-drop ordering

Reorder project groups in the sidebar — order persists across restarts.

## Local discovery

Kanna auto-discovers projects from both Claude (`~/.claude/projects/`) and Codex local history. New projects appear in the sidebar without manual import.

## Bulk import Claude Code sessions

One-click import of existing `~/.claude/projects/` sessions with full transcript. Seamless resume via the Claude Agent SDK.

<Screenshot
  light="/screenshots/light/bulk-import.png"
  dark="/screenshots/dark/bulk-import.png"
  alt="Claude session bulk import modal"
/>

## Git worktree isolation

Run a chat in an isolated worktree without disturbing your working tree. Right-click a chat → **Run in worktree** → Kanna creates a worktree at `.claude/worktrees/<chat-id>/` and runs the chat from there.

## Session resumption

Resume agent sessions with full context preservation. Pick up where you left off — the agent re-loads the JSONL transcript and continues.

## Auto-generated titles

Chat titles generated in the background via Claude Haiku 4.5 after the first turn completes.

## Star projects

Star projects to pin them to the top of the sidebar. See [User Guide → Project Management](/guides/user/workflows/).
