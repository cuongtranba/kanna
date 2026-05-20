---
title: Common Workflows
description: Patterns for daily Kanna use.
---

## Working in a worktree

When making non-trivial changes, run the chat in an isolated worktree:

1. Right-click the chat → **Run in worktree**
2. Kanna creates a worktree at `.claude/worktrees/<chat-id>/` from the current branch
3. The agent's `cwd` is the worktree, leaving your main tree untouched
4. Merge or discard via the worktree controls

## Plan-then-execute

For risky changes, use plan mode:

1. Type your prompt and toggle **Plan mode** in the composer
2. The agent proposes a plan, then asks for approval
3. Review and approve / edit / cancel before any tool runs

## Provider switching mid-chat

If Claude rate-limits or you want a second opinion, switch to Codex from the composer's provider button. Previous turns stay unchanged; the new turn runs against the picked provider.

## Bulk import from Claude CLI history

Settings → **Import sessions** lets you pull existing `~/.claude/projects/` sessions into Kanna with full transcript. Sessions resume seamlessly via the Claude Agent SDK.

## Drag-and-drop files into composer

Drop files (text or images) into the composer to attach them to the next turn. The agent receives them as `read_file` results or image content.
