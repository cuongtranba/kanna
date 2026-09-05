---
id: adr-20260905-restore-picker-row-detail
c3-seal: eee2e56193cd2e4a55ff9d4f97d6aeb3201cf6ef58f2448bf0d40f3f2afd5c76
title: restore-picker-row-detail
type: adr
goal: 'Restore the two facts adr-20260905-provider-agnostic-slash-commands accidentally deleted from c3-115''s mention/slash picker row while editing that row''s provider-scoping clause: that accepting a suggestion inserts a chip node rather than submitting, and that the slash list is project-keyed so a new chat renders it with no fetch. Neither fact changed; the rewrite simply did not carry them forward.'
status: done
date: "2026-09-05"
---

# restore-picker-row-detail

## Goal

Restore the two facts adr-20260905-provider-agnostic-slash-commands accidentally deleted from c3-115's mention/slash picker row while editing that row's provider-scoping clause: that accepting a suggestion inserts a chip node rather than submitting, and that the slash list is project-keyed so a new chat renders it with no fetch. Neither fact changed; the rewrite simply did not carry them forward.

## Context

adr-20260905 replaced c3-115's `Alternate — mention/slash picker` row to record that the `/` catalog is no longer narrowed by provider. A `block` patch replaces a whole row, so every other clause in that cell had to be re-authored by hand — and two were dropped: "Enter or click inserts a chip node, never submits" and "the slash list is project-keyed so a new chat renders it with no fetch". The replacement also wrote "Enter or Tab accepts", which states a keybinding the predecessor row never claimed.

Both dropped clauses are still true of the code. `SlashCommandTypeaheadPlugin`'s `onSelectOption` replaces the typed query with a `SlashCommandNode` rather than submitting, and `useSlashCommands(projectId)` reads the project-keyed `project-commands` snapshot, which is the whole reason c3-231 keys its cache by cwd rather than by chat.

This is a doc-only repair. No code changes.

## Decision

Re-author the row with the original clauses restored verbatim and only the provider-scoping sentence replaced. The keybinding claim reverts to the predecessor's "Enter or click", which is what the row said before and what the component does.

The wider lesson is recorded here rather than in a rule: a `block` patch over a table row is a whole-cell replace, so re-authoring one clause means carrying every other clause across by hand. Cite the row and diff the cell before replacing it.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-115 | component | Owns the row whose clauses were dropped; this restores them | c3-115#n9744@v1:sha256:dbbf302c8af1a4938e770c0399b800095c1480155157990bb6f20d610692eedf | Confirm the restored row states the chip-node and project-keyed facts and keeps adr-20260905's provider-scoping correction |
| c3-1 | container | N.A - ancestor named only to complete the top-down descent | N.A - ancestor escape | N.A - ancestor escape |
| c3-0 | system | N.A - ancestor named only to complete the top-down descent | N.A - ancestor escape | N.A - ancestor escape |

## Verification

| Check | Result |
| --- | --- |
| c3x check --include-adr | ok — no errors |
| git diff -- .c3/c3-1-client/c3-115-chat-ui-chrome.md | The row regains the chip-node and project-keyed clauses; the provider-scoping sentence from adr-20260905 is unchanged |
