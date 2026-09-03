---
name: github-issue
description: Turn a bug or a feature idea into a GitHub issue detailed enough that an implementer can start work from it alone — investigate the real code first, cite file:line, bound the scope, then file it with gh once the user confirms. Use whenever the user reports something broken, proposes a feature or an improvement, or says any of "file an issue", "open a ticket", "create a GitHub issue", "report this bug", "write this up", "log this", "raise an issue", "feature request", "we should add", "this is broken", "this should do X instead". Use it also when a defect surfaces mid-task and is worth tracking rather than fixing now, when a finding has to be handed to another agent or a teammate, and when the user already drafted an issue and wants it sharpened — a vague issue silently charges the implementer a discovery pass they should never have had to pay.
---

# github-issue — write an issue someone can implement from

## What this skill is actually for

An issue is a **handoff document**. Its reader is an implementer — often an agent —
with zero context, who will act on it without the chance to ask a follow-up
question. Everything the issue leaves out, that reader has to guess, and they will
guess from whatever the code looks like today rather than from what you saw.

That framing decides everything below. The bar is not "did I describe the problem"
but **"could someone who has never seen this code start work from this alone, and
finish the right thing?"**

The gap between a ticket and an issue is investigation. A user reports a *symptom*;
a good issue reports a *mechanism*, with the file and line where it lives. Closing
that gap is grep and reading, and it is the bulk of the work here — the writing is
the easy part.

## Workflow

### 1. Check whether it already exists

```bash
gh issue list --repo <owner>/<repo> --state all --search "<distinctive keywords>" --limit 20
```

Search the distinctive noun, not the generic one — `outputPath` and `backdrop-blur`
find things, `bug` and `slow` do not. If you find a match, say so and ask whether to
comment on it instead. Filing a fifth copy of a known problem buries the four
existing threads that already hold the diagnosis.

### 2. Classify and locate

Decide bug vs. feature, then find the area of the codebase it belongs to. If the
request is really several things — a defect plus two improvements — say so and offer
to split. One issue should have one outcome, because that is the unit a PR closes.

In this repo, load the architecture facts before you read code:

```bash
/c3 query <topic>        # component context, contracts, rules
c3x lookup <file>        # which component owns a file
```

Those facts record decisions whose reasons are invisible in the source, so an issue
written without them tends to propose something the repo already rejected.

### 3. Investigate — this is the load-bearing step

Do not skip to the template. Everything that makes the issue useful is found here.

**Work from symptom to mechanism.** Grep the literal strings the user saw — error
text, UI labels, log lines, a function name they mentioned. Then read the
*surrounding* module, not just the matching line: defects usually live in a guard, an
ordering assumption, or a lifecycle edge that only makes sense with the neighbours in
view. For a wide sweep across many files, spawn the `Explore` agent so you get the
conclusion instead of a wall of matches.

**Verify every claim before you write it.** Before asserting "nothing else sets
`outputPath`", grep every write to it and confirm. A confidently-worded guess is
worse than an admitted gap, because the implementer will trust it and spend a day
chasing your wrong theory. When you genuinely could not determine the cause, write
`Not diagnosed —` and list what you ruled out. That is honest and still useful.

**Collect real evidence.** A chat id, a run id, a timestamp, a measured number, an
actual log excerpt, a reproduction command. Concrete observation beats plausible
description: it lets the implementer confirm the bug themselves before changing
anything, and it survives the code drifting under it.

**Trace downstream.** Once you have the defective line, follow what depends on it.
Each consequence is a place the implementer must check, and enumerating them is what
turns a one-line fix into a correct one.

**Find the scope boundary.** What looks affected but isn't? #806 spends a paragraph
explaining why the PTY driver is fine — that paragraph stops the implementer from
"fixing" working code. Boundaries are as valuable as the work itself.

For a feature, the same discipline points elsewhere: find where the thing would
live, what already exists nearby that it should match, which existing hook or field
it can reuse, and which gates (`DESIGN.md`, the ast-grep rules, the side-effect seal)
constrain the implementation.

### 4. Draft from the right template

Read the matching reference file and follow its shape:

- **Bug** → `references/bug-report.md`
- **Feature / improvement** → `references/feature-request.md`

Both include an annotated real example from this repo. They are short; read the one
you need in full rather than working from memory of this section.

Include a mermaid diagram when the change spans components or the data flow is the
point — a flow you would otherwise spend three paragraphs describing. Validate it
with `mcp__kanna__validate_mermaid` before it lands, if that tool is available;
a broken diagram renders as an error to every reader.

### 5. Read your own draft as the implementer

Before showing anything, answer these six as if you had just been assigned the
ticket with no other context. Each unanswerable one sends you back to step 3.

| The implementer asks | Answered by |
| --- | --- |
| Where do I start? | a concrete `file.ts:line`, not "somewhere in the runner" |
| How do I know it's really that? | evidence you observed, not inference you found convincing |
| What else does this touch? | the downstream-consequences list |
| What must I *not* change? | the scope boundary / "not in scope" section |
| How do I know I'm done? | the verification or acceptance section |
| What did you already rule out? | rejected alternatives, with the reason |

Two failure modes worth naming, because both read as thorough:

- **Volume as a substitute for precision.** A pasted 200-line file or a whole diff
  makes the reader do the isolating you were supposed to do. Quote the smallest
  excerpt that shows the defect and mark the offending line.
- **A fix section that is really a patch.** Describe the *direction* and the
  *constraints* you discovered — "enrich the existing entry rather than skipping it,
  and keep the snapshot's description as the winner, since it carries the better
  text". The implementer has the current file open and better information than your
  snapshot; what they cannot recover on their own is what you learned about why the
  obvious fix is wrong.

### 6. Show it, then file it

Filing is outward-facing and public, so it never happens unprompted. Print the full
rendered body plus the title and labels you intend to use, and ask for a go-ahead.
Offer the obvious edits (title wording, label set, split into two).

On approval:

```bash
gh issue create --repo cuongtranba/kanna \
  --title "<title>" \
  --label "<label>" \
  --body-file /tmp/issue-body.md
```

Write the body to a file rather than inlining it — backticks, `$`, and newlines in
a shell argument mangle the markdown. Report the returned URL.

If the user says draft-only, save the body to a file and hand them the path.

## Situations that bend the workflow

**The user already has a draft.** Read it, then run step 3 against it — the draft
supplies the symptom and the intent, and the investigation supplies what it is
missing. Show the sharpened version as a replacement and say what you added, so
they can tell whether you changed their meaning.

**The defect is in a dependency or an external tool.** You cannot cite a line you
cannot read, so the weight shifts onto evidence: the exact input, the observed
output, a diff of what it did to your files, and the minimal reproduction. Name
which repo the fix actually belongs in, and file where the user asked. Issues #881
and #880 in this repo are that shape — a c3x defect recorded here because this is
where the damage lands.

**The user wants it fast.** The file-and-line is the part that is not negotiable —
without it the issue costs the implementer more time than you saved. What can be
dropped is breadth: fewer downstream consequences, no diagram, a one-line
acceptance. Say what you skipped rather than leaving the gaps looking intentional.

**It surfaced mid-task and you are not stopping to fix it.** Write it now, while
you still have the file open and the ids in hand. That context is gone in ten
minutes, and reconstructing it later costs far more than writing it down did.

## Titles

The title is what a maintainer scans in a list of forty, so it should state the
defect and its consequence, not the topic.

| Kind | Shape | Real example |
| --- | --- | --- |
| Bug | declarative: what breaks, and the resulting harm | `Background-task output streaming never arms on the SDK driver (outputPath dropped by level-snapshot ordering)` |
| Bug (short) | `<area>: <what goes wrong>` | `Codex scanner: EACCES on a subdirectory silently drops the whole subtree` |
| Feature | `<area>: <what to build>` | `cron: update an armed job in place (/cron update <jobId> …)` |
| Chore/CI | conventional-commit prefix | `ci(security): add gitleaks secret-scanning workflow (full-history, SARIF)` |

`Fix the sidebar` names a topic. `UI: silent (BellOff) icon overlaps the "Running
m:ss" status text in the sidebar chat row` names a defect — and is searchable two
months later, which is when it matters.

## Labels

This repo's set is small and mostly self-evident; pick from what exists rather than
inventing:

`bug` · `enhancement` · `documentation` · `performance` · `agent-fix` ·
`question` · `good first issue` · `help wanted` · `duplicate` · `wontfix` ·
`invalid`

`agent-fix` marks an issue intended to be picked up by an agent — which raises the
bar on everything above, since an agent will not come back to ask what you meant.
Confirm the label set with the user at step 6 rather than guessing.

Check the live list before filing in an unfamiliar repo:

```bash
gh label list --repo <owner>/<repo>
```

## Reference

- `references/bug-report.md` — bug template, section-by-section rationale, annotated example (#806)
- `references/feature-request.md` — feature template, rationale, annotated example (#851)

`.github/ISSUE_TEMPLATE/` is the same structure for the web path — a human filing
from the browser answers those sections as form fields. `gh issue create` bypasses
the forms entirely, so this skill stays the authority for an agent-filed body; the
two are kept in step by hand, and a change to either belongs in the same PR as the
change to the other.

Two issues worth reading in full as the standard to aim at:

```bash
gh issue view 806 --repo cuongtranba/kanna   # bug: evidence table, downstream list, scope boundary
gh issue view 851 --repo cuongtranba/kanna   # feature: placement rationale, rejected alternatives
```
