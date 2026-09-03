---
title: Stacks
description: Bind several projects into one chat — what each provider can reach, where instructions come from, and how a stack chat is created.
---

A **stack** binds several registered projects together so one chat can work
across all of them. It is the answer to "this change touches the API and the
web client, and I do not want two chats juggling it".

## What a stack is

A stack is a named set of projects. Creating one needs at least two, and it
never owns any files itself — the projects keep their own checkouts, and the
stack only records that they belong together.

Starting a chat from a stack row asks which worktree to use for each member
project, then binds them to the chat. Each binding has a **role**:

| Role | Meaning |
| --- | --- |
| `primary` | The chat's working directory. Exactly one per chat. |
| `additional` | A peer root the chat can also read and write. Any number. |

The bindings live on the **chat**, not on the stack, so two chats started from
the same stack can point at different worktrees.

## What each provider can reach

All three providers get the same `## Stack projects` block in their system
prompt, naming every bound project's title, role and path. What differs is how
the filesystem access is granted:

| Provider | Reach |
| --- | --- |
| Claude (SDK) | Every bound root, via the SDK's `additionalDirectories`. |
| Claude (PTY) | Every bound root, via one `--add-dir` per root. |
| OpenRouter | Same as Claude SDK — it runs the SDK path. |
| Codex | The session declares one working directory (the primary), but runs with full filesystem access, so peer roots are reachable **by absolute path**. |

### Member projects' `CLAUDE.md` is loaded

Claude Code does not read a `--add-dir` root's memory files by default, which
meant a stack chat could write project B while knowing none of B's conventions.
Kanna sets `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` on any spawn that
has additional roots, which loads each root's `CLAUDE.md`, `.claude/CLAUDE.md`,
`.claude/rules/*.md` and `CLAUDE.local.md`.

This costs context on every turn of a wide stack, so it is deliberately gated
on there actually being additional roots — a single-project chat is unchanged.
Set `KANNA_STACK_MEMORY=disabled` to turn it off.

## Where instructions come from

A turn's system prompt carries up to four layers, broadest first:

1. **Workspace instructions** — one global setting, edited in Settings →
   Global Instructions. Applies everywhere.
2. **Stack instructions** — how this stack's projects relate. Edited in the
   stack's create/edit panel. *(e.g. "api is upstream of web; regenerate the
   client after a schema change")*
3. **Project instructions** — one block per bound project, each headed with
   that project's title. Edited from the project's sidebar menu →
   **Edit instructions**. *(e.g. "never edit `generated/` by hand")*
4. **Stack projects** — the title / role / path listing above.

A project's instructions apply to any chat that can write it, which includes a
**solo** chat in that project, not only stack chats. Subagents inherit all of
it too, except when a subagent is path-restricted — one that cannot reach every
root is not told every root's rules.

Each block is capped at the same length as the global setting, and a blank
value clears it.

## Autonomous loops in a stack chat

A loop armed from a chat runs in **that chat's** working directory. On a chat
started from a board card that is the card's worktree, not the project's
registered checkout — so `PROGRESS.md` appears beside the branch it describes
and the verify command runs against the tree the agent is editing. Pass
`workdir` to `setup_loop` only to point a loop at a *different* tree; it must
still be the project's checkout or a worktree of it.

## Known limitations

- The `/` command and skill picker is scoped to the primary project, so skills
  committed in an additional project do not appear in a stack chat.
- A loop is still scoped to one repository, so a single loop cannot drive a
  goal spanning several member projects.
