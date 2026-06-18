---
id: adr-20260618-pty-disable-native-task
c3-seal: 3ac0f1d624daf56aef115118eb5fc2ac25c9ce09a2ba11e846f438b589435e3b
title: pty-disable-native-task
type: adr
goal: |-
    Gate claude-code's native `Task` (Agent/subagent) tool OFF in the PTY driver so
    that under `KANNA_CLAUDE_DRIVER=pty` the model can ONLY delegate work through
    `mcp__kanna__delegate_subagent` (the Kanna orchestrator), never through the
    native `.claude/agents` subagent path. The SDK driver is left unchanged and
    keeps native `Task`. This closes the PTY-side control gap where the model could
    spawn a native subagent that bypasses Kanna's orchestrator.
status: implemented
date: "2026-06-18"
---

## Goal

Gate claude-code's native `Task` (Agent/subagent) tool OFF in the PTY driver so
that under `KANNA_CLAUDE_DRIVER=pty` the model can ONLY delegate work through
`mcp__kanna__delegate_subagent` (the Kanna orchestrator), never through the
native `.claude/agents` subagent path. The SDK driver is left unchanged and
keeps native `Task`. This closes the PTY-side control gap where the model could
spawn a native subagent that bypasses Kanna's orchestrator.

## Context

Both Claude drivers currently expose the native `Task` tool AND register the
Kanna delegation shim, so the model has two competing delegation paths:

- SDK driver: `CLAUDE_TOOLSET` (`src/server/agent.ts:111-128`) lists `Task` +
`TaskOutput`, and `createKannaMcpServer` registers `delegate_subagent`
(`agent.ts:1049-1062`).
- PTY driver: `PTY_DISALLOWED_NATIVE_TOOLS`
(`src/server/claude-pty/driver.ts:213`) only disables `AskUserQuestion`,
`ExitPlanMode`, `ScheduleWakeup`; native `Task` stays enabled, and the same
Kanna shim is wired (`agent.ts:2346-2347`).

A native `Task` subagent bypasses every Kanna orchestrator guarantee: permit
pool, cancel cascade, roster injection, and the `DEPTH_EXCEEDED` /
`LOOP_DETECTED` guards in `subagent-orchestrator.ts`. Under PTY this is worse —
native `Task` subagents only emit sidechain transcript lines
(`jsonl-to-event.ts:91,238`) with no lifecycle events, so Kanna cannot observe
or control them. PTY exists precisely to give Kanna more control over the
spawned `claude`, so the native path defeats its purpose.

Affected topology: the PTY driver (c3-225) owns the `--disallowedTools` arg set;
the orchestrator (c3-210) and the MCP host (c3-226) own the delegation path the
model is being forced onto.

`TaskOutput` is intentionally NOT gated: it also retrieves output for
background Bash tasks (the `KANNA_PTY_BACKGROUND_TASK_MAX_MS` keep-alive
feature), so disabling it would regress an unrelated feature. Only `Task` (the
subagent spawner) is gated.

## Decision

Append `"Task"` to `PTY_DISALLOWED_NATIVE_TOOLS` in
`src/server/claude-pty/driver.ts`. This passes `--disallowedTools ... Task` to
the spawned `claude`, so the CLI refuses the native subagent tool and the model
falls through to the force-registered `mcp__kanna__delegate_subagent` shim
(already wired for PTY). Mirrors the existing #215 pattern used for
`AskUserQuestion` / `ExitPlanMode` / `ScheduleWakeup`.

Chosen over (a) disabling `Task` on BOTH drivers — SDK can observe native
subagents fine and the user wants native built-ins kept there; and (b) removing
the Kanna shim entirely — that drops the roster/permit/cancel orchestration the
PTY path depends on.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | Owns the --disallowedTools arg set the change extends | Confirm the disallow-list pattern + index-safety contract still holds |
| c3-210 | component | Owns the delegation path the PTY model is now forced onto | Confirm orchestrator is the sole PTY delegation surface (no native bypass) |
| c3-226 | component | Registers the delegate_subagent shim the model must now use | Confirm shim stays force-registered for PTY regardless of feature flag |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | Gating native Task on PTY only must not branch the transcript/tool-call shape the UI sees; delegation still normalizes to the same entries | review |
| ref-event-sourcing | Forced kanna delegation keeps every run event-sourced (launch/result) for restart recovery, unlike fire-and-forget native Task | review |
| ref-tool-hydration | Cited by c3-210 + c3-226; the delegate_subagent result the model now relies on must hydrate into a unified transcript entry, not a native-Task sidechain shape | review |
| ref-colocated-bun-test | The driver test asserting PTY_DISALLOWED_NATIVE_TOOLS is colocated and must be updated in the same change | comply |
| ref-strong-typing | Cited by c3-226; PTY_DISALLOWED_NATIVE_TOOLS stays a typed as const tuple, no untyped widening at the driver boundary | comply |
| ref-local-first-data | Cited by c3-226; N.A - this change adds no persistent state and no new data surface, only a CLI disallow-list entry | N.A - no persistent state added |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | The updated assertion lives in src/server/claude-pty/driver.test.ts next to the file under test, run under bun test | comply |
| rule-strong-typing | PTY_DISALLOWED_NATIVE_TOOLS stays a typed as const tuple; no untyped widening introduced | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Driver | Add "Task" to PTY_DISALLOWED_NATIVE_TOOLS tuple | src/server/claude-pty/driver.ts:213 |
| Test | Update equality + index assertions to expect the 4-element tuple; assert Task present in built CLI args | src/server/claude-pty/driver.test.ts:456,465 |
| Docs | Update CLAUDE.md PTY section listing the disallowed native tools | CLAUDE.md PTY driver section |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI / validator / schema / template change; this ADR only changes server code + its colocated test + CLAUDE.md | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/claude-pty/driver.test.ts | Asserts PTY_DISALLOWED_NATIVE_TOOLS contains Task and the variadic flag stays last in CLI args | src/server/claude-pty/driver.test.ts |
| --disallowedTools CLI arg | Spawned claude refuses native Task; model uses kanna delegate shim | src/server/claude-pty/driver.ts:293 |
| c3x check --include-adr | ADR validates against schema, no FAIL rows | c3x check output |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Disable Task on both SDK and PTY | SDK observes native subagents fine and the user wants native built-ins preserved there; only PTY has the control gap |
| Remove the delegate_subagent shim, keep native Task everywhere | Drops Kanna roster/permit/cancel/depth-loop orchestration that the PTY workflow depends on |
| Also gate TaskOutput | TaskOutput serves background Bash task output (KANNA_PTY_BACKGROUND_TASK_MAX_MS); gating it regresses an unrelated feature |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Disabling Task breaks claude-code's native Workflow orchestration on PTY | Workflow spawns agents via the separate Workflow tool, not the model-facing Task tool; Task gate does not touch Workflow | bun test src/server/claude-pty (workflow + driver suites stay green) |
| Index-math assertion in driver.test.ts drifts when tuple grows | Test computes index from PTY_DISALLOWED_NATIVE_TOOLS.length, auto-adjusts; equality assertion updated explicitly | bun test src/server/claude-pty/driver.test.ts |
| Model has no delegation path if shim mis-registered | delegate_subagent is force-registered for PTY independent of KANNA_MCP_TOOL_CALLBACKS; covered by existing wiring at agent.ts:2346 | bun test src/server/kanna-mcp.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-pty/driver.test.ts | Pass; PTY_DISALLOWED_NATIVE_TOOLS includes Task, index assertion holds |
| bun run lint | 0 errors, warnings at or below cap |
| c3x check --include-adr | ADR validates, no FAIL rows |
