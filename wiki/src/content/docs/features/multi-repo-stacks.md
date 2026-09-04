---
title: Multi-repo stacks
description: Group projects into a stack so one chat can read and edit across several repositories at once.
---

A **stack** is a group of two or more projects. Its point is a chat that spans
them: change an API in one repository and its consumer in another, in the same
turn, without the agent losing track of which tree it is in.

Stacks appear in the sidebar alongside projects, with their member chats nested
underneath.

## Create a stack

You need at least two projects — a stack of one is just a project. From the
sidebar, create a stack, name it, and pick its members. Order is the order you
add them, and that is the order they appear.

## Start a stack chat

Starting a chat on a stack asks one question per member repository: **which
worktree**. Pick the main checkout, or a worktree you cut for this piece of
work. One member is the **primary** — the chat's working directory — and the
rest are **additional** roots.

The agent is told about every bound path explicitly, as separate project roots
it may read and edit. It is not left to infer that a sibling directory is in
scope.

## Boards for a stack

A stack gets its own boards at `/boards/stack/<stack>`, for work that spans the
member repositories rather than sitting in one of them. They behave exactly like
[project boards](/features/boards/).

## Provider support

| Provider | Multi-root |
| --- | --- |
| Claude | Yes — every bound worktree is passed as an additional directory |
| Codex | Partial — Codex takes a single working directory, so peer worktrees are reached through an explicit root grant rather than being handed over at session start |

If you are working across several repositories in one turn, Claude is the
smoother path.

## Choosing worktrees deliberately

Binding the *main checkout* of three repositories means an agent can edit all
three at once, which is exactly what you asked for and worth being sure about.
Cutting a worktree per repository first — from a
[board card](/features/boards/), or by hand — keeps a multi-repo change on its
own branches and reviewable per repository.

A bound path that has since been deleted is shown as missing rather than
silently dropped, so a stale binding is visible instead of quietly narrowing the
chat's reach.
