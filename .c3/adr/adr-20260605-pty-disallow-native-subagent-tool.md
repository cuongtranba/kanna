---
id: adr-20260605-pty-disallow-native-subagent-tool
c3-seal: 1e4cf616fbc9b98d82c35563f02421f43913e0ca610cb3a10a9b7281012286ba
title: pty-disallow-native-subagent-tool
type: adr
goal: |-
    Force every Claude PTY spawn to route subagent delegation through Kanna's
    `mcp__kanna__delegate_subagent` MCP tool by disallowing the Claude CLI's native
    in-process subagent tool (`Agent`, plus its legacy name `Task`) via
    `--disallowedTools`. Today the model, when nudged by skills like
    `superpowers:subagent-driven-development`, picks the native `Agent` tool; under
    the PTY driver that subagent runs in-process and buffers its `isSidechain`
    transcript writes, so the on-disk JSONL (the driver's SOLE event source) shows
    zero progress for 13–18 minutes per dispatch and the Kanna UI cannot surface
    any subagent activity. Disallowing the native tool makes the CLI reject it the
    same way it already rejects native `AskUserQuestion`/`ExitPlanMode`/
    `ScheduleWakeup`, so the model falls back to the durable, observable Kanna
    delegation path.
status: accepted
date: "2026-06-05"
---

## Goal

Force every Claude PTY spawn to route subagent delegation through Kanna's
`mcp__kanna__delegate_subagent` MCP tool by disallowing the Claude CLI's native
in-process subagent tool (`Agent`, plus its legacy name `Task`) via
`--disallowedTools`. Today the model, when nudged by skills like
`superpowers:subagent-driven-development`, picks the native `Agent` tool; under
the PTY driver that subagent runs in-process and buffers its `isSidechain`
transcript writes, so the on-disk JSONL (the driver's SOLE event source) shows
zero progress for 13–18 minutes per dispatch and the Kanna UI cannot surface
any subagent activity. Disallowing the native tool makes the CLI reject it the
same way it already rejects native `AskUserQuestion`/`ExitPlanMode`/
`ScheduleWakeup`, so the model falls back to the durable, observable Kanna
delegation path.

## Context

The PTY driver (c3-225) tails `~/.claude/projects/<encoded-cwd>/<session>.jsonl`
as its only event source. The native `Agent`/`Task` subagent tool executes
inside the same `claude` process and does not stream incremental `isSidechain`
lines to that file — output lands in one burst at completion. Observed in chat
`8dd66bf9`: each native `Agent` dispatch (Task 0, Task 8, …) produced 0
sidechain lines and no `tool_result` for 13–18 min while the PID stayed alive
and CPU-busy, which is indistinguishable from a hang and shows no progress in
the Kanna subagent panel. Kanna's own system-prompt append already instructs
the model to delegate via `mcp__kanna__delegate_subagent` (c3-210 orchestrator),
which runs through `SubagentOrchestrator.delegateRun`, emits per-turn
HarnessEvents, and drives the UI panel. The native tool is the only path that
escapes this observability. The existing `PTY_DISALLOWED_NATIVE_TOOLS` constant
in `driver.ts` (the #215 pattern) is the established seam for exactly this:
disallow a native built-in so a Kanna-mediated equivalent is used instead.

## Decision

Add `"Agent"` and `"Task"` to `PTY_DISALLOWED_NATIVE_TOOLS` in
`src/server/claude-pty/driver.ts`. Both names are included because Claude Opus
4.8's transcript emits the subagent tool as `Agent` while older CLI versions
and Kanna's own `CLAUDE_TOOLSET` still name it `Task`; disallowing both is
version-drift-proof and costs nothing (the CLI ignores names it does not know).
The constant is pushed last into the variadic `--disallowedTools` argv by
`buildPtyCliArgs`, so the addition needs no wiring change — only the constant
and its assertion test. This reuses the proven #215 mechanism rather than
inventing a new gate, keeping a single choke-point for "native tools Kanna
replaces with an MCP shim". Applies uniformly to main and subagent spawns;
`delegate_subagent` is registered for both whenever an orchestrator +
delegation context are supplied, so the fallback path exists at every depth
(and correctly fails `DEPTH_EXCEEDED` at the chain cap instead of silently
spawning an unobservable native agent).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | Owns PTY_DISALLOWED_NATIVE_TOOLS and the --disallowedTools argv assembly being changed | Confirm change-safety table + colocated test assertion updated |
| c3-210 | component | Agent-coordinator owns delegate_subagent registration that becomes the sole subagent path under PTY; no code change but it is the fallback target | Confirm delegate registration covers main + subagent spawns (no new gap) |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | The change preserves the HarnessEvent/prompt-delivery contract; disallowing a native tool does not alter the normalized turn shape | comply |
| ref-colocated-bun-test | The assertion test for the constant sits beside driver.ts as driver.test.ts | comply |
| ref-event-sourcing | Cited by both c3-225 and c3-210; the change touches no event shape and preserves the log-before-broadcast invariant — delegation still flows through the orchestrator's existing event path | comply |
| ref-tool-hydration | Cited by c3-210; disallowing native Agent/Task removes tool calls that would have needed hydration, and delegate_subagent is already a hydrated tool — no new transcript-entry normalization is introduced | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Test for the constant change lives in src/server/claude-pty/driver.test.ts next to the source | comply |
| rule-strong-typing | The constant stays a typed as const string-literal tuple; no any/untyped shape introduced | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Constant | Add "Agent","Task" to PTY_DISALLOWED_NATIVE_TOOLS | src/server/claude-pty/driver.ts:213 |
| Comment | Update the nearby doc comment to note native subagent tool is disallowed so delegation routes through mcp__kanna__delegate_subagent | src/server/claude-pty/driver.ts |
| Test | Update the PTY_DISALLOWED_NATIVE_TOOLS equality assertion + last-flag-position test to include the two new names | src/server/claude-pty/driver.test.ts:456,465 |
| Docs | Update the PTY-driver section of CLAUDE.md to list Agent/Task among disallowed natives and explain the delegate-only rationale | CLAUDE.md |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI underlay touched | This ADR changes Kanna runtime + docs only, not the c3x CLI/validators/schema | c3x check passes after c3x set status transitions |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| driver.test.ts equality assertion | Fails if PTY_DISALLOWED_NATIVE_TOOLS drifts from the expected 5-name tuple | src/server/claude-pty/driver.test.ts |
| driver.test.ts last-flag-position test | Fails if --disallowedTools is no longer last / count math breaks | src/server/claude-pty/driver.test.ts |
| Claude CLI --disallowedTools | Runtime: CLI rejects native Agent/Task calls so the model must use the MCP delegate | src/server/claude-pty/driver.ts buildPtyCliArgs |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Leave native Agent enabled, accept the 13–18 min blind stalls | The stall is indistinguishable from a hang, gives no UI progress, and bypasses the configured Kanna subagent roster the user explicitly wants used |
| Edit the superpowers:subagent-driven-development skill to call delegate_subagent | Skill lives outside the kanna repo; a per-skill fix does not generalize and the model can still reach the native tool from other skills/prompts |
| Force-register an Agent→delegate_subagent shim mirroring the AskUserQuestion pattern | Signatures differ (native Agent takes a free-form subagent_type/prompt; delegate needs a roster subagent_id); a faithful 1:1 shim is not possible, so disallow-and-fall-back is the honest mechanism |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Skills that assume a general-purpose native Agent (subagent-driven-development, dispatching-parallel-agents) lose ad-hoc subagents; only the configured roster is reachable via delegate | This is the intended tradeoff; documented in CLAUDE.md and the PR body so the operator knows roster entries (not ad-hoc general-purpose) are the supported path under PTY | PR description states the tradeoff; CLAUDE.md PTY section updated |
| CLI subagent tool renamed again in a future Claude version, re-opening the native path | Both Agent and Task disallowed now; a third name would need a follow-up, caught when a new stall is observed | driver.test.ts asserts the exact tuple so any intended change is explicit |
| SDK driver (non-PTY) still allows native Task | Out of scope — this ADR governs the PTY driver only; SDK driver keeps native Task by design | Constant is PTY-only (PTY_DISALLOWED_NATIVE_TOOLS) |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-pty/driver.test.ts | Pass (updated constant + position assertions green) |
| bun run lint scoped to changed files | No new warnings/errors |
| c3x check | Clean (no drift) |
