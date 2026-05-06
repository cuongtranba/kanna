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
