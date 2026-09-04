---
title: Pull Requests
description: Targeting, branching, conventions.
---

## Target this repository

`origin` = `cuongtranba/kanna` is the only remote, and the only valid PR target.

`gh repo set-default` is not set, so `gh pr create` with no explicit target
prompts or guesses. Always pass:

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

Every push to `main` and every PR runs lint, the ast-grep useState gate, the
architecture budget, the complexity-ceiling check, typecheck, the client build,
the bundle check, and the test suite — plus gitleaks and semgrep as separate
workflows. Merges are blocked on any failure.

Run `bun run check` and `bun run test` locally first; see
[Lint & Tests](/guides/contributing/lint-and-tests/) for the full list and what
each gate is for.
