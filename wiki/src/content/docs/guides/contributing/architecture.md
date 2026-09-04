---
title: Architecture (C3)
description: How Kanna's component documentation works.
---

Kanna uses C3 component docs at `.c3/`.

## Before coding

Run `/c3 query <topic>` (or `c3x lookup <file>`) to load component context, refs, and rules. **Do not skip this** — even for small edits. Skipping leads to stale assumptions and wrong patches.

## After coding

If a change touches component boundaries, refs, public contracts, or rules, run `/c3 change` (or `/c3 sweep` for audit) to update `.c3/` docs in the same PR. Code-doc drift is a blocker.

## Operations

| Op | Purpose |
|---|---|
| `query` | Look up component context, refs, rules for a topic |
| `audit` | Check a component against its docs |
| `change` | Update docs after a code change |
| `ref` | Add or fix a ref between components |
| `sweep` | Bulk audit across all components |

## File lookup

`c3x lookup <file-or-glob>` maps files/directories to components + refs.

## Skill

`c3-skill:c3` auto-triggers on `/c3` or architecture phrases.

## Always review what `c3x` wrote

**`c3x` can rewrite docs your change never touched.** Run `git status .c3/`
after *any* `c3x` write — `repair` and `change apply` alike — and
`git checkout --` anything you did not intend. `.c3/c3.db` is gitignored, so the
markdown is the only source of truth and git is the only thing that catches
this.

Most of the churn is cosmetic re-canonicalisation, but **text can be lost**, in
two shapes worth being able to recognise:

- **`\ |` in a table cell is damage.** A literal pipe in a cell must be `\|`;
  rewritten as `\ |` it escapes a space instead, the pipe then reads as a column
  separator, and the *next* serialisation truncates the row. One row lost 533
  bytes mid-sentence this way, and carried the broken escape for months.
- **A glob or emphasis character inside backticks in a cell.** The backtick
  strip leaves `*` unguarded, and the next pass eats it as markdown emphasis:
  `` `mermaid-*.js` `` → `mermaid-.js`. A cell showing `glob-.ext` where a `*`
  belongs is damaged.

`repair` is idempotent on this tree, so **any diff it produces is about your
change** and is worth reading. Three authoring mistakes make it produce one:

1. An `.c3/adr/` file with no YAML frontmatter is **deleted**, not skipped. Use
   `c3x add adr`, or write the frontmatter block yourself.
2. One unsealed fact blocks every cache rebuild, and the error names only that
   file while the visible symptom is elsewhere — unrelated `c3x lookup` calls
   start answering "no component mapping" for files that are correctly bound.
3. A wrapped list item loses its continuation indent. Keep list items on one
   line in `.c3/` prose.

## Keeping `c3x lookup` working

Every production-significant component has a spec at `.c3/eval/c3-NNN.yaml` with
a `code:` list; that is what maps a file back to its owning component. When you
add an architecture-significant file, add it to that `code:` list **and** to the
matching entry in `.c3/code-map.yaml`, then run `c3x repair` (expect no
warnings) and `c3x lookup <file>` to confirm. Renames and deletions need the
same treatment — stale anchors surface as warnings, so keep those clean.
