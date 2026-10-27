---
title: Contributing Overview
description: How to contribute to Kanna.
---

Kanna is a community fork. PRs are welcome — see the guides below for the rules of the road.

- [Filing Issues](/guides/contributing/issues/) — the bug and feature forms, and what makes an issue implementable
- [Architecture](/guides/contributing/architecture/) — event sourcing, the IO seal, C3 docs
- [From send to "Starting..."](/guides/contributing/send-to-starting/) — the prompt-to-processing-row path and how to profile it
- [Pull Requests](/guides/contributing/pull-requests/) — where to open, how to target
- [Lint & Tests](/guides/contributing/lint-and-tests/) — CI gates
- [Dev Workflow](/guides/contributing/dev-workflow/) — local setup, worktrees, fast iteration
- [Releasing](/guides/contributing/releasing/) — release-please, commit messages, recovering a failed publish

Agents read the short rule set in [`CLAUDE.md`](https://github.com/cuongtranba/kanna/blob/main/CLAUDE.md) and the skills under `.claude/skills/`; each rule is enforced by a gate whose error message explains the fix, and these pages give the longer background.
