---
id: adr-20260712-loop-orchestration-hardening
c3-seal: a0f827bbb8d19b6175cff0294026decf4f86e797ca92e5200c6e6ec9b2c2ecda
title: loop-orchestration-hardening
type: adr
goal: |-
    Fix four defects in the notification-driven autonomous loop (`setup_loop` +
    `delegate_subagent({run_in_background})`) that let a review-session loop drift
    into a single 7.5-hour main turn: (1) the loop prompt only drove the first
    turn, (2) nothing stopped the orchestrator from implementing directly, (3) the
    subagent run timeout was a hardcoded 600s total wall-clock that killed
    working subagents mid-edit, and (4) the loop guessed which subagent to
    delegate to.
status: proposed
date: "2026-07-12"
---

## Goal

Fix four defects in the notification-driven autonomous loop (`setup_loop` +
`delegate_subagent({run_in_background})`) that let a review-session loop drift
into a single 7.5-hour main turn: (1) the loop prompt only drove the first
turn, (2) nothing stopped the orchestrator from implementing directly, (3) the
subagent run timeout was a hardcoded 600s total wall-clock that killed
working subagents mid-edit, and (4) the loop guessed which subagent to
delegate to.

## Context

Reviewing chat `430ce553-c7c3-4c7e-9b25-583d8734ba36` showed the loop breaking
after a subagent TIMEOUT. `setup_loop` renders a full-discipline prompt, but
that prompt only ran turn 1: every subsequent background-completion wake was
fired by `AgentCoordinator.deliverSubagentToMain` with a generic "Read
PROGRESS.md, decide the next action" string that carried no loop discipline.
With no host enforcement, the main agent stopped delegating and became the
worker — 1154 Read + 1065 Edit + 917 Bash in one turn, 13 auto-compactions, no
`/clear`, falling back to the native `Agent` tool. Separately,
`SubagentOrchestrator` capped every run at a hardcoded 600s total wall-clock
(`DEFAULT_RUN_TIMEOUT_MS`) that paused only on interactive approval gates —
which background subagents never hit — so a productively-streaming subagent
was aborted mid-write at minute 10, leaving a typecheck-broken worktree.
Anthropic's Agent SDK guidance is explicit: no per-subagent wall-clock
deadline; bound with maxTurns + a stall watchdog. The loop touches the
provider-agnostic turn lifecycle owned by agent-coordinator.

## Decision

Four coordinated changes, all config-driven:

1. **Idle stall-watchdog.** `PausableTimeout.reset()` re-arms the full window
on every streamed subagent event (`onChunk` / `onEntry`), converting the
run timeout from a total wall-clock cap into a stall/idle watchdog. Only a
run with no activity for the whole window aborts. The window is
configurable via the `subagentRuntime.runTimeoutMs` app setting (env
fallback `KANNA_SUBAGENT_RUN_TIMEOUT_MS`), wired into the orchestrator at
construction.
2. **Durable loop-armed state + prompt re-injection.** New
`loop_armed` / `loop_disarmed` auto-continue events + a `deriveLoopState`
read-model persist the armed loop (subagent id + rendered prompt) across
restart. `deliverSubagentToMain` re-injects the persisted loop prompt on
every wake when a loop is armed, instead of the generic string.
3. **Hard tool-block in loop turns.** While a loop is armed, the SDK
`canUseTool` denies `Edit/Write/MultiEdit/NotebookEdit/Task` and the PTY
driver adds them to `--disallowedTools`. A new `stop_loop` MCP tool disarms
on GOAL MET; a real user `chat.send` also disarms (takeover). The
orchestrator can then only Read / Bash(verify) / delegate.
4. **Deterministic worker.** `setup_loop` gains a `subagentId` param;
`validateLoopSetup` resolves it from the param or the configured
`subagentRuntime.defaultLoopSubagentId`, rejects an unknown/missing id, and
embeds the concrete id in the rendered delegate call.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | Parent system of the affected component; named for top-down completeness, aggregate behavior unchanged | c3-0#n3@v1:sha256:c9f10a833b3e499d1329f9637c65ac8e7c7b9f78b6210e91ff3f44b8d31e38bc | N.A - no system-level contract change |
| c3-210 | component | Owns the turn lifecycle: adds loop-armed state, prompt re-injection, the canUseTool loop tool-block, stopLoop, and wires the configurable stall-watchdog timeout into SubagentOrchestrator | c3-210#n6441@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | Confirm event-sourcing (loop_armed/disarmed replay) + provider-agnostic behavior preserved |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-tool-hydration | The loop tool-block gates native tool calls (Edit/Write/Task) that this ref normalizes into transcript entries; the block happens before hydration, hydration is unchanged | ref-tool-hydration#n8317@v1:sha256:376e5fee261bd3b463633f19523020439854d9bd11ddc28ff5cffe12d8ed485e | comply |
| ref-event-sourcing | loop_armed/loop_disarmed are appended to the auto-continue JSONL log and armed state is derived by replay (deriveLoopState) — no new snapshot fold | ref-event-sourcing#n8147@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa | comply |
| ref-provider-adapter | Prompt re-injection + the stall-watchdog run through the provider-agnostic path; both SDK and PTY drivers get the tool-block, preserving the single transcript/tool model | ref-provider-adapter#n8213@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 | comply |
| ref-colocated-bun-test | New tests sit next to their module and run under bun test — no separate test dir | ref-colocated-bun-test#n8081@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Every new test (idle-watchdog, deriveLoopState, canUseTool block, PTY parity, loop-template) is colocated <module>.test.ts next to its module | rule-colocated-bun-test#n8418@v1:sha256:6c733a6bc908ab2c89a563a0429d06eb34d56731aaa4a18067213c18dbdf6c8f | comply |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| subagent-orchestrator.test.ts | idle-reset keeps a steadily-active run alive past runTimeoutMs; a silent run still stalls | bun test src/server/subagent-orchestrator.test.ts |
| auto-continue/read-model.test.ts | deriveLoopState arm/disarm/re-arm/per-chat | bun test src/server/auto-continue/read-model.test.ts |
| agent.test.ts (buildCanUseTool) | Edit/Write/MultiEdit/NotebookEdit/Task denied while armed; Read/Bash/delegate allowed | bun test src/server/agent.test.ts -t "loop-armed tool-block" |
| claude-pty/driver.test.ts | loopArmed adds the blocked tools to --disallowedTools | bun test src/server/claude-pty/driver.test.ts |
| loop-template.test.ts | subagentId required/default/invalid; prompt embeds id + stop_loop + no-self-edit | bun test src/server/loop-template.test.ts |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A hung (no-event) subagent pins a run for the whole idle window | Window is bounded + configurable; only truly silent runs stall out | subagent-orchestrator stall test |
| Loop-armed tool-block persists after a session if not disarmed | stop_loop on GOAL MET + real user send both disarm; state is event-sourced and per-chat | read-model.test.ts arm/disarm cases |
| Tool-block evaluated only at spawn | Loop wakes are fresh spawns (session_token wiped). Session reuse across an armed-state flip (arm via setup_loop, disarm via stop_loop / user-send takeover) is prevented by `loopArmedAtSpawn` on the session record: `startClaudeTurn` respawns when the captured state differs from `isLoopArmed()` — both drivers, since both bake the block at spawn | driver.test.ts loopArmed cases; agent.test.ts PTY + SDK respawn-on-flip cases |

## Claude Code alignment (same PR, follow-up to review)

Three gaps against Claude Code's native subagent handling (reverse-engineered
reference: `claude-code-qa`) closed in this PR:

| Gap | Claude Code behavior | Kanna implementation |
| --- | --- | --- |
| Turn bound | Per-agent frontmatter `maxTurns` (`loadAgentsDir.ts`), param override in `runAgent.ts`, hardcoded 200 only for the fork agent; `query()` emits `max_turns_reached` and the run keeps its output. NOT a global setting. | `Subagent.maxTurns` (Settings editor, optional, unset = unbounded). Claude-SDK runs thread it natively into `options.maxTurns` (graceful). PTY/Codex get a host-side backstop in `SubagentOrchestrator`: abort with `MAX_TURNS` once tool_call count exceeds the bound; `ProviderRunStart.nativeMaxTurns` keeps the backstop off SDK runs. |
| Tool restriction | Filter-at-spawn: `filterToolsForAgent` removes forbidden tools from the tool list, the model never sees them (`ALL_AGENT_DISALLOWED_TOOLS`, `COORDINATOR_MODE_ALLOWED_TOOLS`). | Loop-armed spawns pass `options.disallowedTools` (SDK) / `--disallowedTools` (PTY) with `LOOP_BLOCKED_NATIVE_TOOLS`; `canUseTool` deny demoted to belt-and-suspenders. Armed-flip respawn (above) keeps the spawn-time block fresh. |
| Result re-entry format | `<task-notification>` XML (task-id / status / summary / result) enqueued into the pending message queue (`LocalAgentTask.tsx`). | `buildTaskNotification` (agent.ts) renders the same XML into the `subagent_background` wake prompt. Un-armed deliveries include `<result>` (4k cap); armed loop deliveries omit it (PROGRESS.md contract) and append the loop prompt. |

## Verification

| Check | Result |
| --- | --- |
| bun run lint | exit 0, no warnings |
| bun run typecheck | exit 0 |
| bun run test | all pass |
