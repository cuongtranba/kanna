---
id: adr-20260819-c3-120-list-marker
c3-seal: 36988bddbe1033a664b0a5fc02a21cad9dc60a5ef17bfa9949ba8529fe7a7112
title: c3-120's Purpose is one paragraph again, not a paragraph and a stray bullet
type: adr
goal: |-
    Rewrap one line of `c3-120`'s Purpose so the `+` in "the sanctioned
    CopyStateStore + clipboard adapter" no longer starts a line, and drop the list
    node that line was being parsed into. No wording changes; the paragraph reads
    exactly as before.
status: accepted
date: "2026-08-19"
---

## Goal

Rewrap one line of `c3-120`'s Purpose so the `+` in "the sanctioned
CopyStateStore + clipboard adapter" no longer starts a line, and drop the list
node that line was being parsed into. No wording changes; the paragraph reads
exactly as before.

## Context

`.c3/c3-1-client/c3-120-cron-ui.md` wraps its Purpose paragraph so that one
line begins `+ clipboard adapter), CronRunMessage (…`. In CommonMark a line
starting with `+ ` is a bullet, so that is not a wrapped sentence — it is a
list item, and c3x parses it as one. The fact's Purpose is therefore stored as
two nodes: a paragraph ending mid-sentence at "the sanctioned CopyStateStore",
and a one-item list holding the rest.

Every c3x write re-emits that structure, so the on-disk text comes back as
`- clipboard adapter` with a blank line before it — the sentence split in half
and the marker silently changed. It reproduces on `c3x repair` and on any
`change apply` touching any fact, which makes it collateral damage on unrelated
PRs: it surfaced on both #782 and #783 and was reverted by hand each time, per
CLAUDE.md's standing instruction to `git status .c3/` after any c3x write.

Reverting is not a fix. The hazard is in the committed text, so the next person
to run c3x reintroduces it.

## Decision

**Rewrap the line so `+` falls mid-line.** The paragraph then parses as the
single paragraph it was always meant to be, and the re-emitted text matches
what is committed. Every word is unchanged — this is a line-break move, not a
rewording.

Two patches, because the damage has two halves: the paragraph node is replaced
with the complete rewrapped text, and the stray list node is deleted.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-120 | component | Its Purpose section is re-parsed from a paragraph plus a stray list into one paragraph; the prose is byte-identical apart from line breaks | c3-120#n9386@v1:sha256:2cbcdf82b2718faab701b17a9d2701fb539e584a6608cbb7faca7b346edb97b4 | None: no contract, boundary or claim changes |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Cited by c3-120 | rule-colocated-bun-test#n12068@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | N.A - no code changes, so no test can change |
| rule-strong-typing | Cited by c3-120 | rule-strong-typing#n12129@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | N.A - no code changes |
| rule-zustand-store | Cited by c3-120 | rule-zustand-store#n12161@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | N.A - no code changes |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep reverting the damage after each c3x write | It is committed text, so it recurs for every contributor forever, and it has already cost two unrelated PRs a manual revert. |
| Reword to "CopyStateStore plus its clipboard adapter" | Changes the wording of a frozen fact to work around a line break; the rewrap is faithful and the wording is not the defect. |
| Fix the normalizer in cuongtranba/c3-skill | Worth doing separately, but it does not repair this file, and this file is broken markdown regardless of which parser reads it. |

## Verification

| Check | Result |
| --- | --- |
| c3x read c3-120 --section Purpose --cite | one node where there were two |
| c3x check | no new issues |
| git diff on the rendered fact | line breaks only; word-diff is empty apart from the removed bullet marker |
| c3x repair, run twice | .c3/ stays clean; the file no longer re-emits as a list |
