---
title: Filing Issues
description: How to write a bug report or feature request a coding agent can implement.
---

Issues are opened through [issue forms](https://github.com/cuongtranba/kanna/issues/new/choose) — a **Bug report** and a **Feature request**. Blank issues are disabled; questions and troubleshooting go to the links on that page instead.

The forms are longer than most projects' because most issues here are implemented by a coding agent working from the issue text alone. Anything the form does not capture becomes a round-trip with you, or a guess.

## What makes an issue implementable

Three questions have to be answerable without asking you:

| Question | Bug report | Feature request |
| --- | --- | --- |
| How do I reproduce it / what should exist? | Steps to reproduce, Expected vs actual | Proposed behaviour |
| How do I know I am done? | Definition of fixed | Acceptance criteria |
| Where do I look first? | Area, Suspected defect | Area, Where it goes |
| What must I **not** change? | Not in scope / already correct | In scope / deliberately not doing |

Two fields earn more than their length suggests:

- **Chat / session id** (bug reports, under Evidence). It lets a maintainer replay the whole transcript and event log for that session. One id often replaces a paragraph of description.
- **The scope boundary** — the last row of that table. Naming what looks affected but is not, or the adjacent feature that should *not* be built, is what stops an implementer from changing working code.

Everything optional is genuinely optional. A bug you could not diagnose is still a good bug report: summary, reproduction and evidence, with the suspected-defect field left empty or filled with what you ruled out. A fabricated mechanism is worse than an admitted gap, because the implementer will trust it.

## Area and C3

The **Area** dropdown maps to a [C3 component](/guides/contributing/architecture/) — the options carry ids like `c3-113`. Whoever picks the issue up runs `/c3 query <id>` before writing code, so even a rough guess saves them a search. Pick "Not sure" over a wild guess; a wrong id sends the first look at the wrong component.

## Implementation gates

Both forms end with an **Implementation gates** checklist that lands in the issue body unchecked. It is for the implementer, not the reporter — leave it alone. It restates conditions that already apply:

- `/c3 query` before, `/c3 change` after a boundary change
- a test written before the fix or feature
- `bun run typecheck`, `bun run lint`, `bunx ast-grep test`, `bun run lint:usestate`, `bun run check:arch`, `bun run test` — see [Lint & Tests](/guides/contributing/lint-and-tests/)
- `DESIGN.md` compliance for anything under `src/client/**`
- docs updated in the same PR
- a conventional-commit PR title, which release-please turns into the changelog

## Titles

- Bugs: `<area>: <what goes wrong>` — e.g. `chat: transcript scrolls past the last message on long chats`. Name the defect and its consequence, not the topic; `Fix the sidebar` is unsearchable two months later.
- Features: `feat: <what a user can now do>`, optionally scoped — e.g. `feat(topics): add bulk selection and delete action`.

## Filing from an agent

An agent filing with `gh issue create` bypasses the web forms, so the same structure lives in the repo as the `github-issue` skill (`.claude/skills/github-issue/`). Its `references/bug-report.md` and `references/feature-request.md` hold the body templates, the rationale for each section, and an annotated real issue to aim at. The web forms mirror those sections — keep the two in step when either changes.

## Secrets

Transcripts, server logs and `~/.kanna` files contain OAuth tokens and API keys. Redact before pasting. A vulnerability report belongs in a [private advisory](https://github.com/cuongtranba/kanna/security/advisories/new), never a public issue — and if a credential leaked, [rotate it first](/guides/contributing/secret-scanning/).
