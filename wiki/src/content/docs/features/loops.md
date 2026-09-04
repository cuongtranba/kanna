---
title: Loops
description: Point an agent at a goal and a verify command and let it grind — with a tracking file as the only durable state, and gates that stop it declaring victory early.
---

A **loop** runs an agent repeatedly until a goal is actually met. It is for the
long grind: an eslint burn-down, a migration sweep, a codemod across hundreds of
files — work that is too big for one turn but too mechanical to babysit.

## Loops versus cron

Both repeat. They stop for different reasons, and that is the whole distinction:

|  | Cron | Loop |
| --- | --- | --- |
| Fires on | the **clock** | the previous iteration **finishing** |
| Stops when | you stop it | its **goal is met** |
| Knows if it worked | no | yes — a verify command says so |
| Good for | polling, reports, periodic checks | finishing a body of work |

A [cron job](/features/cron-jobs/) has no goal and no oracle. A loop is nothing
but a goal and an oracle.

## Arming one

Ask, in plain words:

> Set up a loop. Goal: `eslint --max-warnings=0` passes. Verify with
> `bun run lint`.

The agent calls `setup_loop` with the goal, the verify command, and optionally
a tracking file (default `PROGRESS.md`) and a first chunk.

## The verify command is the oracle

**Exit 0 means done.** That is the entire contract, and it is worth choosing
carefully — the loop cannot be more rigorous than the command you gave it.

`setup_loop` refuses to arm rather than starting something that cannot work:

- The verify command **already exits 0**. Either the goal is met or the oracle
  is too weak; starting would declare victory having done nothing.
- The worker subagent is **manual-trigger** — a loop cannot @-mention it.
- The tracking file is **git-tracked and records a different goal**. Reconciling
  it would rewrite a finished loop's committed record.
- `workdir` is not the project checkout or a worktree of the same repository.
- `parallelism` is outside 1–4.

The first two are overridable with `force`, if you know why.

## The tracking file is the only durable state

Each iteration the main agent's context is **wiped on purpose**. It re-reads the
tracking file, decides the next chunk, hands it to a worker, and ends its turn.
Nothing is carried in its head between iterations, so nothing is lost when the
context goes — the file is the memory.

```markdown
## Goal
eslint --max-warnings=0 exits 0

## Progress (latest first)
- 2026-07-11 W3 no-empty-function chunk 4/8 DONE (run-abc123)

## Failed approaches
- Generic `noop` helper → typecheck fail (variance mismatch)

## Next chunk
W3 no-empty-function chunk 5/8: files X, Y, Z. Approach: shared typed noop.
```

**Failed approaches earns its place.** Without it, a fresh worker retries the
dead end the last one already burned an iteration on.

`## Goal` and `## Verify command` belong to Kanna and are rewritten to match how
the loop was armed. `## Progress`, `## Failed approaches` and `## Next chunk`
belong to the loop and are preserved verbatim — arming over an existing file
never destroys its history.

## It will not declare victory early

A green oracle is not the same as finished work, and a loop once declared
success at stage 4 of a 12-stage plan because its verify command flipped green
early. So the decision reads **two** signals, not one:

| Verify | Plan's next chunk | What happens |
| --- | --- | --- |
| passes | empty | Full check, then **goal met** — loop stops |
| passes | still lists work | **Oracle too weak** — stops and hands back to you |
| fails | has work | Delegate the next chunk (the normal case) |
| fails | empty | Write the next chunk, then delegate |

The second row is the interesting one: it **stops rather than continuing**. The
loop cannot tell a stale plan from a weak oracle, and only a person can retighten
the definition of done.

Before declaring the goal met, the agent also reads the **whole** tracking file
once and scans every section for undone work — including sections it does not
recognise. That check exists because a worker once wrote `DONE` in the next-chunk
section while five unfinished chunks sat in a heading nobody was reading.

## Watching it

The chat footer grows a **Progress** panel: one row per chunk, marked done,
running, pending or failed, with a "Loop running" pill while it is armed. If the
loop hits a rate limit the panel shows when it resumes, plus a **Resume now**
button.

The panel outlives a disarm, so a stopped loop still shows what it got through.

## Stopping and resuming

- **Just type.** Sending a message disarms the loop — you are taking over.
- **Ask it to stop.** The agent calls `stop_loop`.
- **Ask it to resume.** `resume_loop` re-arms the loop it last ran, from the
  same spec, with no arguments needed.

While a loop is armed the main agent's own editing tools are blocked. It is an
orchestrator, not a worker — the actual edits happen in the subagent that owns
each chunk.

## Costs and caveats

- A loop's per-iteration cost is a **subagent run**, not a chat turn. A loop
  that looks idle in turn-level token metrics shows up in the subagent ones.
- Loops are unattended by design. Give one a checkout it may break — a
  [board card's worktree](/features/boards/) is a good fit — rather than your
  only copy.
- The goal is only as good as the verify command. `bun run lint` is an oracle;
  "the code is better" is not.
