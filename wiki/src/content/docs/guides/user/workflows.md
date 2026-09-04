---
title: Common Workflows
description: Patterns for daily Kanna use.
---

## Give risky work its own checkout

Kanna does not sandbox the agent, so the cheapest safety measure is a checkout
you are willing to lose. The board flow does this in one gesture:

1. Add a card to the project's [board](/features/boards/)
2. **Start work** on it

Kanna cuts a branch, creates a worktree at
`../.kanna-worktrees/<repo>/<branch>`, opens a chat rooted there, and moves the
card to the in-progress column. Your main checkout is untouched, and you can run
several cards at once without the agents colliding.

When the work is done the agent moves the card one column forward. Dragging it
to the **done** column is left to you, and that is when Kanna asks what to do
with the worktree — merge, discard, or leave it.

## Plan-then-execute

For changes you want to review before anything runs:

1. Type your prompt and toggle **Plan mode** in the composer
2. The agent proposes a plan and stops for approval
3. Approve, edit, or cancel before any tool runs

Plan approvals go through Kanna's durable protocol, so a pending plan survives a
server restart instead of stranding the chat.

## Provider switching mid-chat

If Claude rate-limits, or you want a second opinion, switch to Codex from the
composer's provider button. Previous turns stay unchanged; the new turn runs
against the picked provider.

## Hand a long job off and get it back

For work that will take a while, ask the agent to delegate it in the background.
It calls `delegate_subagent({ run_in_background: true, … })`, ends its turn, and
Kanna re-enters the chat with the result when the subagent finishes — one wake
rather than a polling loop. See [Subagents](/guides/user/subagents/).

For work that should repeat on a clock, use [cron jobs](/features/cron-jobs/).
For work that should repeat until a goal is met, use a [loop](/features/loops/).

## Import sessions you started in the CLI

The sidebar's **Import Claude sessions** brings `~/.claude/projects/` sessions
into Kanna with their transcripts. A session Claude Code is still writing to
keeps catching up as it grows.

## Work across several repositories

Group the projects into a [stack](/features/multi-repo-stacks/) and start a
stack chat. You pick one worktree per repository, and the agent is told about
every bound path, so it can read and edit across all of them in one turn.

## Drag-and-drop files into the composer

Drop files (text or images) into the composer to attach them to the next turn.
