---
title: Dev Workflow
description: Local setup, worktrees, fast iteration.
---

## Setup

```bash
git clone https://github.com/cuongtranba/kanna
cd kanna
bun install
```

## Run dev server

```bash
bun run dev
```

Opens at `http://localhost:3210` with HMR.

## Worktrees

Long-running changes belong in a git worktree to isolate them from the main checkout:

```bash
git worktree add -b feat/<topic> .claude/worktrees/<topic> main
cd .claude/worktrees/<topic>
```

## Fast test iteration

```bash
bun test src/server/<file>.test.ts
```

The full `bun test` is fast (~30s on M1) but a single suite is faster for tight loops.

## C3 docs

Before changing component boundaries, run `/c3 query <topic>`. After, run `/c3 change` to keep docs in sync. See [Architecture](/guides/contributing/architecture/).
