---
id: adr-20260904-cross-project-orchestration
title: cross-project-orchestration
type: adr
goal: Decide how work spanning several projects in a stack is sequenced, and record why the board-dependency design is preferred over relaxing the loop's single-repository contract.
status: proposed
date: "2026-09-04"
---

# adr-20260904-cross-project-orchestration

## Goal

Decide how work spanning several projects in a stack is sequenced, and record why the board-dependency design is preferred over relaxing the loop's single-repository contract.

## Context

A stack chat can now reach every bound root and obeys every bound project's instructions (adr-20260904-project-stack-instructions). What it still cannot do is **sequence** work across them: "regenerate the client only after the API schema lands" is a thing the user holds in their head and enforces by hand.

`c3-232 orchestration-core` was the previous attempt and was deleted on purpose (adr-20260802-retire-orchestration-core) for being unreachable from any user gesture and redundant with the loop. That is the constraint this ADR is written against: **anything proposed here must be reachable from a gesture the user already makes on day one**, or it repeats that mistake.

Two mechanisms already sequence work in Kanna, and neither spans projects:

- **Boards.** One card is one worktree is one branch is one chat (`board-start-work.ts`). That invariant is what makes three agents on three cards safe. Cards already carry their own `projectId`, and a stack board already holds one sync binding per member repo — so a board is *already* the cross-project surface; it simply has no notion of order.
- **Autonomous loops.** One goal, one oracle, one tracking file, one tree. `setup_loop` refuses a workdir that is not the project's checkout or a worktree of it, and `run_verify` memoizes against a fingerprint of one working tree.

## Decisions

### D1 — Option A (board card dependencies) is the design; Option B is not adopted

**Option A — `blockedBy: cardId[]` on a card.** `board-start-work.ts` refuses or defers a card whose blockers are not yet in a `done` column, with the reason surfaced in the drawer (which already renders `blockedReason`).

It is preferred because it changes no execution model. There is no new engine, no new durability contract, and no new failure mode: a blocked card is simply a card that cannot start yet. It fits the invariant that makes the current design safe, and it is reachable on day one from a gesture users already make — dragging and starting cards.

**Option B — a stack-scoped loop.** Relaxing the same-repo guard (`claude-loop-commands.ts`, `loop-template-io.adapter.ts`) from "a worktree of the primary project" to "any root bound to this chat", with a per-project oracle.

Not adopted. It reads as the direct answer to "orchestration at a high level", but the loop's whole durability contract assumes **one tracking file in one tree**, and `run_verify`'s memoization fingerprints **one working tree**. A stack-scoped loop needs an answer to: which tree holds `PROGRESS.md`; what "the oracle" means when it is N commands in N trees; what a partial pass means for the GOAL MET terminal check; and what `run_verify` caches against. Those are four new contracts to serve one feature, and getting the terminal check wrong means a loop that declares success without doing the work — the exact failure the arm-time already-green refusal exists to prevent.

If a stack-wide goal is still wanted after Option A ships, it should be revisited as its own ADR with those four questions answered first, not folded in here.

### D2 — Dependencies are validated as a DAG at write time, not at start time

A cycle among `blockedBy` edges is unrepresentable-if-rejected and undiagnosable-if-accepted: at start time it presents as "every card is blocked" with no card to blame. The edge write refuses a cycle and names the path.

### D3 — A blocked card DEFERS, it does not silently do nothing

"Start work" on a blocked card must say which card blocks it, in the drawer, using the existing `blockedReason`. Board actions have no undo and a gesture that appears to do nothing reads as a bug.

### D4 — The dependency edge is board-local, and does not sync to a tracker

Trackers model blocking differently (or not at all), and an agent-origin change is already held back from a tracker by default (`heldReason: "agent_push_disabled"`). Pushing a Kanna-local ordering decision into someone's GitHub project is out of scope and would need its own opt-in.

### D5 — The activity rollup ships regardless, and is not part of this decision

"What is running across this stack right now" is answerable today: `ChatActivity` is already computed per chat, every stack chat carries its `stackId`, and `SidebarData.stacks` already carries `StackSummary`. It is a fold over data that already exists — no new events, no new state, no dependency on A or B — so it shipped with this ADR rather than waiting for it (`src/shared/stack-activity.ts`).

It is listed here because the plan grouped it under Phase 3, not because it is contingent on anything decided above.

## Consequences

- Cross-project ordering becomes a property of the board, so it is visible where the work already is, and a stack with no board is unaffected.
- A card gains an edge set that must be validated, migrated and rendered — three slices, shippable independently: the edge and its cycle check, then the Start-work gate, then the drawer copy.
- A stack-wide autonomous loop remains unavailable. That is a real gap and is stated as such in the wiki's Stacks page rather than left to be discovered.
- **No Option A code is written under this ADR.** It is `proposed`; the plan's own rule is that implementation waits for `accepted`.
