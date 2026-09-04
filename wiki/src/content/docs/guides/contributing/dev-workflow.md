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

## Run the dev server

```bash
bun run dev
```

This starts **two** processes: the Vite client on `:5174` and the server on
`:5175` (always the client port + 1). Open the **client** port —
[`localhost:5174`](http://localhost:5174) — for HMR. `--port` changes the client
port and the server follows.

`bun run dev` also sets `KANNA_RUNTIME_PROFILE=dev`, so it reads and writes
`~/.kanna-dev` instead of `~/.kanna`. Your real chats are never at risk from a
dev run.

Two other shapes worth knowing:

```bash
bun run start        # single process on :3210, production shape
bun run install:dev  # build, then install this tree globally as the `kanna` CLI
```

## Work in a git worktree

Long-running changes belong in a worktree, so they are isolated from the main
checkout and from every other in-flight change:

```bash
git worktree add -b feat/<topic> .worktrees/<topic> origin/main
cd .worktrees/<topic>
```

This repo routinely has a dozen or more live worktrees; that is why the
architecture budget uses ceilings rather than exact line pins.

## Fast test iteration

```bash
bun run test src/server/<file>.test.ts
```

Never bare `bun test` — see [Lint & Tests](/guides/contributing/lint-and-tests/).

## Before you push

```bash
bun run check   # typecheck → lint → build:client → check:bundle
bun run test
```

Those two are the minimum. The full gate list is in
[Lint & Tests](/guides/contributing/lint-and-tests/).

## C3 docs

Before changing component boundaries, run `/c3 query <topic>`. After, run
`/c3 change` to keep `.c3/` in sync — code-doc drift blocks a merge. See
[Architecture](/guides/contributing/architecture/).
