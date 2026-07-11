# ADR 2026-07-11 — Notification-driven loop orchestration; remove `schedule_wakeup`

**Status:** Accepted.

**Supersedes:** `adr-20260603-agent-self-scheduled-wake`. Also retires the
pending-workflow harvest wake (formerly Part B of adr-20260603).

## Context

Session `326c9b8c-9f8d-4349-936f-c320ae76cfd8` in
`~/.kanna/data/transcripts/` shows a real autonomous eslint burn-down loop
losing momentum after ~4 iterations. Debug findings:

1. Main agent did all chunk work directly (no `delegate_subagent`) → main
   context piled up → 13 `compact_boundary` events over ~7 hours → post-
   compact turns forgot to call `schedule_wakeup` → loop died silently.
2. Rate limit at idx 5850 killed the fired auto-continue chain (single-shot,
   no retry-on-error).
3. Model drifted to "Recommend continuing in next session" prose after
   compaction — no explicit `AskUserQuestion` tool, just a natural-language
   handoff that ended the run.
4. `schedule_wakeup` is timer-based polling. The model must remember to
   re-arm every turn; compaction ate that memory.

Root cause: `schedule_wakeup` architecture. It relies on the model to (a)
re-arm on every turn and (b) keep its own context coherent across many
hours. Both properties break in practice for 8h+ runs.

Anthropic guidance (research summary):

- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  — discrete multi-session pattern; an "initializer agent" sets up files, a
  "coding agent" makes incremental progress in subsequent sessions. No max
  session length guardrail.
- [Long-running Claude (scientific computing)](https://www.anthropic.com/research/long-running-Claude)
  — single tmux session with CLAUDE.md + CHANGELOG.md as portable memory.
  "Detach + close laptop" — implicit restart-tolerance. Ralph Loop pattern
  kicks the model back into context on completion claims.
- [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  — compaction / structured notes / sub-agent architecture are presented as
  alternatives, with memory tool (beta) for cross-session state.

Implicit pattern in all three: external file is the durability contract.
Any restart resumes cleanly from file. Main-context loss is tolerable.

## Decision

Adopt a notification-driven loop-orchestration pattern where:

1. **Main agent = stateless-in-context, stateful-in-file** (`PROGRESS.md`
   or similar user-owned tracking file).
2. **Every subagent completion delivery `/clears` the main agent's Claude
   session** — wipes `session_token` (reusing the same machinery
   `exit_plan_mode`'s `clearContext` branch already uses at `agent.ts:4430`)
   and appends a `context_cleared` transcript entry (same UI-rendered kind).
3. **The next main turn is a fresh Claude spawn** that re-reads PROGRESS.md
   as truth. No orchestration state is held in main context between
   iterations.
4. **Subagent = worker per iteration.** Fresh Claude spawn per delegation —
   already true at `subagent-provider-run.ts:170-171` (`sessionToken: null,
   forkSession: false`). Subagent writes PROGRESS.md before terminating.
5. **Delivery prompt is minimal** — `"Read PROGRESS.md, decide next action."`
   Subagent output is NOT carried forward as prompt content. PROGRESS.md is
   the only truth.
6. **Loop terminates by absence of delegation.** When the model reads
   PROGRESS.md and sees the goal is met, it does not delegate. Main goes
   idle. No timer to disarm, no wake cap to enforce.

**Hard break — remove entirely:**

- `mcp__kanna__schedule_wakeup` MCP tool.
- `AgentCoordinator.scheduleAgentWakeup` public method.
- `maybeArmPendingWorkflowWake` (pending-workflow poll harvest).
- `AutoContinueSource` variants `agent_wakeup` and `pending_workflow`
  (keep `subagent_background`, `user`, `auto_setting`, `token_rotation`).
- Env vars `KANNA_MAX_AGENT_WAKES` and `KANNA_PENDING_WORKFLOW_POLL_MS`
  (no polling, no wake cap; subagent permit pool bounds concurrency).
- PTY `--disallowedTools ScheduleWakeup` stays (native cron unusable under
  Kanna's spawn model) — no Kanna replacement.

## Consequences

**Positive:**

- Main context never accumulates → no compact_boundary events on main →
  protocol memory can't be discarded.
- 8h / 24h / N-day runs behave identically to 5-minute runs. Only
  PROGRESS.md survives, and it survives everything (Kanna restart, machine
  reboot, model change).
- No wake cap to think about — bounded by subagent permit pool.
- One code path for every auto-continue re-entry: rate-limit / auth-failure
  (existing `user` / `token_rotation` sources) or subagent-completion
  (`subagent_background`). No timer-based mechanism to maintain.

**Negative:**

- Every iteration costs one extra main turn (to read PROGRESS.md and
  delegate). Slower per iteration; more reliable.
- Native `/loop` slash command inside PTY-mode chats has no way to schedule
  (its `ScheduleWakeup` calls hit the disallowed list). Users adopt the
  `delegate_subagent({run_in_background: true})` pattern instead.
- Workflow live-status is no longer harvested via a Kanna-owned poll. Model
  handles it via a status-check subagent when needed. Workflow disk-watch
  panel still surfaces status to the UI.
- Third-party integrations that relied on the removed MCP tool break hard.
  Alignment with the user's stated preference ("hard break, no fallback").

**Neutral:**

- Provider-failure resume path (rate-limit / auth-error) is unchanged.
  Those wakes fire the literal `"continue"` and are unaffected.
- Subagent isolation was already correct — no code change on subagent
  side, just a reinforcing comment at `subagent-provider-run.ts`.
- The `subagent_background` source already existed. This ADR just makes it
  the ONLY source that delivers agent-driven wakes.

## Alternatives considered

1. **Threshold-based auto-restart (75% context usage triggers /clear).**
   Rejected: added a threshold parameter and cumulative-token tracking
   that the always-/clear rule makes unnecessary. Every iteration /clears
   → main token count per iteration is flat → the threshold never trips.

2. **Add `continue_loop` MCP tool alongside `schedule_wakeup`.** Rejected:
   two mechanisms is not a single source of truth. The user asked for
   single-source clarity; keeping `schedule_wakeup` alive but adding a
   sibling tool would have compounded the mental model.

3. **Change `schedule_wakeup` semantics to always /clear.** Rejected: same
   MCP surface but very different behaviour, silent regression for any
   existing use.

4. **Keep timer-based `schedule_wakeup` + add a Stop hook (Ralph Loop).**
   Rejected: Ralph Loop enforces re-arm but does nothing about context
   accumulation. The compaction failure mode from session 326c9b8c still
   applies.

## Implementation summary

- `src/server/kanna-mcp.ts`: remove `SCHEDULE_WAKEUP_DESCRIPTION`,
  `buildScheduleWakeupToolList`, `scheduleWakeup` on `KannaMcpArgs`.
- `src/server/agent.ts`: remove `scheduleWakeup` on
  `StartClaudeSessionArgs` and `AgentCoordinatorArgs.maxAgentWakes` /
  `pendingWorkflowPollMs`; remove `scheduleAgentWakeup` /
  `maybeArmPendingWorkflowWake` methods; rewrite
  `deliverBackgroundSubagentResult` → `deliverSubagentToMain` with always-
  /clear logic.
- `src/server/auto-continue/events.ts`: trim `AutoContinueSource` union.
- `src/server/claude-pty/driver.ts`: remove `scheduleWakeup` param + shim
  registration; leave `ScheduleWakeup` in `PTY_DISALLOWED_NATIVE_TOOLS`.
- `src/server/server.ts`: drop `KANNA_MAX_AGENT_WAKES` and
  `KANNA_PENDING_WORKFLOW_POLL_MS` env parses.
- `src/shared/types.ts`: update `AutoContinueSchedule.prompt` doc-comment.
- Tests: remove `schedule_wakeup` describe from `kanna-mcp.test.ts`;
  remove `scheduleAgentWakeup` / pending-workflow describes from
  `agent.test.ts`; add `deliverSubagentToMain` describe (success / failure
  / no-op); update read-model.test fixture; add
  `src/server/agent.notification-loop-scenario.test.ts` (50-iteration
  scenario + interleaved compact_boundary + failure + interleaved
  success/failure).
- Docs: replace CLAUDE.md `# Agent Self-Scheduled Wake` section with
  `# Notification-Driven Loop Orchestration`.

## Verification

- `bun test --conditions production src/server/agent.notification-loop-scenario.test.ts`
- `bun run lint` + `bun run typecheck` — side-effect seal + strong-typing
  clean.
- Manual smoke (PTY driver): open a chat with a scratch PROGRESS.md; type
  a `/loop` recurring prompt referencing PROGRESS.md; observe (1) main
  ends turn immediately after `delegate_subagent`, (2) each subagent
  completion triggers `context_cleared` transcript entry + fresh main
  spawn next turn, (3) main context stays tiny across many iterations,
  (4) NO `schedule_wakeup` calls anywhere in the transcript.
