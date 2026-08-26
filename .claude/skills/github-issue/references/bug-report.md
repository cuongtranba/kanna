# Bug report

## Template

```markdown
## Summary

<What is broken, how wide the blast radius is, and the one-line mechanism.
Three sentences. A reader who stops here should know whether it affects them.>

## Evidence

<What you actually observed: chat/run id, timestamps, log excerpt, measured
numbers, or the exact commands to reproduce. A table when there is ordering or
a sequence involved.>

## The defect

`path/to/file.ts:LINE-LINE`

```ts
<smallest excerpt that shows the problem, with the offending line marked>
```

<Why this is wrong. Then why nothing else compensates — the grep you ran that
proves no other code path saves it.>

Downstream consequences:

- `path/a.ts:LINE` — <what goes wrong there as a result>
- `path/b.tsx:LINE` — <…>

<Scope boundary: what looks affected but is not, and why.>

## Fix

<Direction and constraints, not a patch. What the change has to preserve, and
which obvious approach is wrong and why.>

Not in scope / already correct:

- <thing the implementer might "fix" but should leave alone, and why it's right>

## Regression test

<The assertion that fails before and passes after — specific enough to write.>
```

Sections that do not apply get dropped, not filled with "N/A". A bug you could
not diagnose keeps Summary and Evidence, and replaces **The defect** with
`Not diagnosed — ruled out: <list>`. That is an honest, useful issue. A fabricated
mechanism is not.

## Why each section earns its place

**Summary** is triage. Maintainers read it to decide priority, so it needs the
blast radius (*every* task on *one* driver) not just the symptom. The one-line
mechanism goes here too — it is the sentence people quote when linking the issue.

**Evidence** is what lets the implementer confirm the bug before touching
anything, and what keeps the issue trustworthy as the code drifts. Prefer things
you observed over things you inferred: a chat id and two timestamps 1 ms apart
prove an ordering claim that a paragraph of prose only asserts. When ordering is
the bug, a table is worth more than any description, because the bug *is* the
sequence.

**The defect** is the handoff itself. Two things make it work:

- The `file:line` heading, so the implementer opens the right file first.
- The *smallest* excerpt with the failing line marked. A 200-line paste makes
  the reader redo the isolating you already did.

Then the closing move: proving nothing else compensates. `Nothing else ever
writes outputPath — mergeBackgroundTaskSnapshot preserves prev?.outputPath ??
null, and the snapshot payload carries no path` is a grep result, and it is what
upgrades "this line looks wrong" to "this is the bug".

**Downstream consequences** convert one defective line into the full list of
places that misbehave because of it. Each entry is a checkpoint for the fix and,
usually, a test. Without it the implementer patches the line, sees the symptom
persist somewhere else, and reopens.

**The scope boundary** stops wasted and wrong work. #806 explains why PTY is
unaffected; without it an implementer "fixing" both drivers would break the one
that works.

**Fix** describes direction because the implementer has the current file open and
better information than your snapshot — a pasted patch goes stale and gets
applied blindly. What they *cannot* recover on their own is the constraint you
learned the hard way: which value must win, which callback must not double-fire.

**Not in scope / already correct** is the highest-value-per-line section in the
whole document. Three lines here prevent a whole class of over-reach.

**Regression test** is the definition of done. State the assertion concretely
enough that someone could write it from the sentence alone.

## Annotated example — issue #806

> **Background-task output streaming never arms on the SDK driver (outputPath
> dropped by level-snapshot ordering)**

The title names the mechanism in parentheses, so it is searchable by cause.

**Summary** — bounds it immediately:

> Background-task output streaming (shipped in #788) is **dead for every
> `Bash(run_in_background)` task on the SDK driver**. […] Root cause is an
> ordering assumption in `claude-session-runner.ts`: the SDK's
> `background_tasks_changed` level snapshot always arrives **before** the Bash
> `tool_result` that carries the output path, so the launch branch's `!has(id)`
> guard skips it.

Scope ("every task, on one driver"), the origin PR, and the mechanism — in two
sentences.

**Evidence** — a real observation, then the generalization:

> Observed in chat `3cf1de5c-…`, task `b3tqaogys`. The snapshot lands 1 ms
> before the `tool_result`, and the same ordering holds for every background
> bash launch in that transcript (`bg3l20uk8`, `b1ak9zr35`, …)

| t (epoch ms) | entry | effect |
|---|---|---|
| …612618 | `status` `backgroundTaskIdsSnapshot: ["b3tqaogys"]` | inserts with `outputPath: null` |
| …612619 | `tool_result` `"Output is being written to: …"` | id already present → **launch branch skipped** |

Four other task ids are what turn one anecdote into "this is the ordering,
always". The `effect` column is doing the real work — it maps each observed line
onto the code path it drives.

**The defect** — the guard is marked inline, in the code:

```ts
if (!session.backgroundTasks.has(id)) {          // <-- always false on SDK
```

Then the compensation check, then the consequences as `file:line — effect`
triples, then the boundary paragraph explaining why PTY is fine.

**Fix** — direction plus the two non-obvious constraints:

> Make the launch branch **enrich** an existing entry rather than skip it […]
> Preserve the snapshot-supplied `taskType` / `description` / `startedAt` — the
> snapshot already carries a good `description`, so the current
> `launchDescription` must stay a fallback, not an overwrite.
>
> Guard against double-firing `onBackgroundTaskLaunch` […] `trackTask` would
> otherwise re-register and replay the file from offset 0.

Neither constraint is visible from the defective line. Both are exactly what an
implementer would get wrong on the first pass — which is the test for whether a
Fix section is pulling its weight.

And the boundary:

> Not in scope / already correct:
> - `local_agent` tasks legitimately carry `outputPath: null` […] so
>   `hasOutput: false` is right for them and the chevron should stay hidden

Without that line, an implementer chasing "the chevron never renders" makes it
render for tasks that have no output to show.
