---
title: Pull Requests
description: Targeting, branching, conventions.
---

## Target the fork, not upstream

This is a fork. `origin` = `cuongtranba/kanna` (mine), `upstream` = `jakemor/kanna`.

**PRs MUST target `cuongtranba/kanna`, never `jakemor/kanna`.**

`gh repo set-default cuongtranba/kanna` is set by default. Always pass:

```bash
gh pr create --repo cuongtranba/kanna ...
# or
gh pr create --base main --head <branch> ...
```

to make the target explicit.

## Branch naming

- `feat/<topic>` — new features
- `fix/<topic>` — bug fixes
- `docs/<topic>` — docs-only changes
- `chore/<topic>` — refactors, cleanup

## Commit messages

Conventional Commits style. Short subject, body if non-obvious.

## CI gates

CI runs `bun run lint` then `bun test` on every push to `main` and every PR. Merges are blocked on either failure.
