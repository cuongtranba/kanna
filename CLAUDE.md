# Architecture

This project uses C3 docs in `.c3/`.
For architecture questions, changes, audits, file context -> `/c3`.
Operations: query, audit, change, ref, sweep.
File lookup: `c3x lookup <file-or-glob>` maps files/directories to components + refs.

# Pull Requests

This is a fork. `origin` = `cuongtranba/kanna` (mine), `upstream` = `jakemor/kanna`.
PRs MUST target `cuongtranba/kanna`, never `jakemor/kanna`.
`gh repo set-default cuongtranba/kanna` is set; always pass `--repo cuongtranba/kanna`
or `--base main --head <branch>` to `gh pr create` to make the target explicit.

# Tests

`bun test` MUST pass locally before any push or PR. CI runs `bun test`
on every push to `main` and every PR via `.github/workflows/test.yml`;
merges are blocked on failure. For fast iteration on a single suite,
run `bun test src/server/<file>.test.ts`. When a test spawns `git` or
other subprocesses, ensure the spawn sets `stdin: "ignore"` and
`GIT_TERMINAL_PROMPT=0` so a hung credential prompt cannot exhaust the
test timeout.
