---
id: adr-20260830-unarmed-delivery-names-plan
c3-seal: 9262746fd1601286051c4b9de95daf63ccfc915dab7af6718800e21e2f2fbbae
title: unarmed-delivery-names-plan
type: adr
goal: Stop the un-armed background-delivery prompt from asserting a tracking filename it has no basis for. `deliverSubagentToMain`'s no-loop-armed branch told a context-cleared main agent to "Read PROGRESS.md if present" — a hardcoded literal. Name the real plan from the `loop_armed` tombstone instead, as an absolute path, and name nothing when there is no tombstone.
status: proposed
date: "2026-08-30"
---

## Goal

Stop the un-armed background-delivery prompt from asserting a tracking filename it has no basis for. `deliverSubagentToMain`'s no-loop-armed branch told a context-cleared main agent to "Read PROGRESS.md if present" — a hardcoded literal. Name the real plan from the `loop_armed` tombstone instead, as an absolute path, and name nothing when there is no tombstone.

## Context

Every background-subagent completion `/clear`s the main agent and delivers a fresh prompt. When a loop is armed that prompt carries the full loop discipline, which already names the loop's own tracking file. When no loop is armed it fell through to a literal: `"Your Claude context has been cleared. Read PROGRESS.md if present, then decide the next action."`

`PROGRESS.md` is `setup_loop`'s DEFAULT tracking filename (`loop-template.ts` `DEFAULT_TRACKING_FILE`), so it does not identify a plan — it names as many plans as there are loops. Measured on the install where this was found: 54 `PROGRESS*.md` files across sibling worktrees, **26** of them named exactly `PROGRESS.md`.

Nothing resolved the ambiguity either. The tracking-doc MCP tools confine to the armed loop's `workdirAbs` and fall back to the chat cwd when no loop is armed (`kanna-mcp.ts`: `getArmedLoop?.(chatId)?.workdirAbs ?? args.cwd`) — a mitigation whose own comment scopes it to "while a loop is armed". So the sentence and the tool that resolves it both defaulted to the MAIN checkout, while the loop had been working in a sibling git worktree.

Observed in chat `108b8a13`: after the loop was disarmed (adr-20260830-loop-disarm-visible-resumable), deliveries fell into this branch. The user then asked for a review of the feature the loop had just built. Main is deliberately stateless-in-context, so the model had no memory of it; it followed the prompt, resolved `PROGRESS.md` against the main checkout, and found an unrelated, already-completed loop's plan. It reviewed that instead — producing browser evidence and a PR update for a different feature entirely, while the feature actually built in the worktree was never reviewed.

This is the same defect class `CLAUDE.md` already records fixing on the WRITE path: a loop tracking `PROGRESS-panes.md` once wrote its progress row into the committed `PROGRESS.md` of an unrelated finished loop, and `renderLoopPrompt` was changed to embed `file:` in every call it prescribes. The READ path was never fixed.

## Decision

Replace both un-armed literals with one prompt built from `describeLastPlan(deriveLastLoopSpec(...))`, a pure local helper.

With a tombstone recording a tracking file, the prompt names it **absolute** — `${workdirAbs}/${trackingFileRel}` — and says the path may be in a different checkout from the chat's working directory. Absolute is the load-bearing part: a bare filename is exactly what resolves against the wrong checkout, both for the model's own `Read` and for `query_tracking_file`'s cwd fallback. With a tombstone that records the file but no workdir (a loop armed before those fields existed) it names the file alone. With no tombstone at all it names **nothing** — the sentence becomes "Your Claude context has been cleared. Then decide the next action."

Naming nothing is the deliberate half. A confident wrong filename is worse than silence: the model still has the run's `<result>` in the notification, and inventing a path is what sent a review to the wrong repository. This is only reachable because adr-20260830-loop-disarm-visible-resumable retains the `loop_armed` tombstone; before that the spec was erased on disarm and there was nothing to read.

Deliberately NOT changed: `kanna-mcp.ts`'s `baseDir()` still falls back to the chat cwd when no loop is armed. Widening tool confinement to a disarmed loop's workdir is a scope change to a security boundary, and it is not needed — an absolute path in the prompt lets the model `Read` the plan directly without relaxing where the tracking-doc tools may write.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns `deliverSubagentToMain`; its un-armed prompt branch is the defect and now derives the plan path from the loop tombstone instead of a hardcoded filename | c3-210#n9248@v1:sha256:4357f6d650059aba4f1624273b4114b7fad8925535deed9952140c789d48e5f8 | Confirm the no-tombstone path names no file, and that the armed branch is untouched |
| c3-227 | N.A - checked, not modified | Checked because the prompt now reads `deriveLastLoopSpec`; that is a pure replay this component already exports and no file under `src/server/auto-continue/**` changed | c3-227#n10135@v1:sha256:f7affc2f6d825317e70bae8aa9faf9b19807849a5a39d911e467d871264b9fdd | None required now |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/claude-loop-commands.test.ts | 18 pass, incl. 2 new cases written RED first: the prompt names the disarmed loop's real plan as an absolute path, and names no file at all when the chat never ran a loop |
| bun test --conditions production src/server/agent.test.ts src/server/agent.notification-loop-scenario.test.ts | 147 pass. Four assertions that pinned `toContain("PROGRESS.md")` on UN-ARMED deliveries are inverted to `not.toContain` — they encoded the guess this ADR removes. The armed-loop assertion at the `setup_loop` test is untouched and still passes, because a rendered loop prompt legitimately names its own file |
| bun run test | 7318 pass / 2 skip / 0 fail across 551 files |
| bun run typecheck && bun run lint && bun run check:arch | Clean; 44 arch checks pass |
