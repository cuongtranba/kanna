# ADR 2026-07-11 — `setup_loop` MCP tool with validated template

**Status:** Accepted.

**Depends on:** `adr-20260711-notification-driven-loop-orchestration` (loop
mechanism itself; this ADR adds the validated user-facing entry point).

## Context

The notification-driven loop-orchestration pattern (see the depended-on
ADR) leaves the recurring prompt shape up to the user / model. In practice
users type prompts like `set up /loop and goal to X` and the model
free-forms the recurring prompt — often forgetting the terminate rule
(`GOAL MET → END TURN`) or the delegate step (main does the work directly).
Free-form drift re-introduces the same failure modes we removed:

- Missing terminate rule → loop runs forever after goal met.
- Missing delegation clause → main context accumulates.
- Missing tracking-file update rule → subagents don't persist state.
- Vague goal ("improve X") → no way to detect completion.

## Decision

Add a server-owned `mcp__kanna__setup_loop({ goal, verify_command,
tracking_file?, chunk_hint? })` MCP tool. Kanna renders a deterministic
recurring prompt from validated input, ensures the tracking file exists,
`/clears` the main-agent Claude session, and enqueues the templated prompt
as an auto-continue. The model no longer authors the recurring prompt.

**Validation rules (hard-reject if any fail):**

1. `goal` non-empty string, ≤ 500 chars.
2. `verify_command` non-empty; shell-parseable (balanced quotes; non-empty
   token list under `shell-quote`).
3. `tracking_file` (default `PROGRESS.md`) resolves inside project cwd;
   no `..` escape; no absolute path outside cwd; no NUL byte.
4. `chunk_hint` (optional) ≤ 2000 chars.
5. Structural: the rendered prompt MUST contain the tracking-file path,
   the verify command, `delegate_subagent`, `run_in_background: true`,
   `GOAL MET`, `END THIS TURN`, `/clear`. Belt-and-suspenders check
   against future edits that would drop a required clause.

**Success path:** ensure tracking file exists (write a skeleton listing
Goal / Verify command / Progress / Failed approaches / Next chunk if
absent — never overwrite an existing file); wipe `session_token` for
provider `claude`; append `context_cleared`; emit
`auto_continue_accepted { source: "subagent_background", delayMs: 0,
prompt: <rendered> }`. Next main turn is a fresh spawn that reads the
tracking file and starts iterating.

**Failure path:** MCP result `isError: true` with `setup_loop rejected:\n-
<error 1>\n- <error 2>` — model rewrites its call. No side effects on
rejection (no file write, no /clear, no event emit).

## Consequences

**Positive:**

- Deterministic loop start — every field enforced server-side; model
  cannot omit terminate/delegate/update clauses by accident.
- User can type free-form (`set up /loop with goal X` / `/loop and goal
  to do X`); model parses to structured input; validator rejects vague
  goals instead of silently failing at runtime.
- Template edits are checked at build time by the structural invariant.

**Negative:**

- Model has an additional tool to learn. Description explicitly says
  "use this instead of writing loop prompts by hand".
- Only main chats get the tool (subagent spawns lose it) — a subagent
  cannot itself set up a nested loop. Deliberate: nested loops are a
  can-of-worms out of scope.

## Alternatives considered

1. **Client-side slash command `/loop-setup <goal>` expanding to template
   text in composer.** Rejected: forces the user to review/edit template
   text; adds UI surface; validation runs after composer send, which is
   too late to reject cleanly.

2. **Kanna-native `/loop` + `/goal` slash commands as first-class chat
   concepts (with UI panel).** Rejected: much bigger scope; the prompt-
   only pattern already covers the durable requirements.

3. **Skill under `.claude/skills/kanna-loop` with a validator CLI.**
   Rejected: skill instructions can drift; server-authoritative validation
   is the only enforcement that survives model changes.

## Implementation summary

- `src/server/loop-template.ts` — pure module. `validateLoopSetup(input,
  cwd)` returns `{ok, resolved}` or `{ok:false, errors}`. Renders prompt +
  skeleton.
- `src/server/loop-template-io.adapter.ts` — the only IO: `ensureTrackingFile`
  creates + never overwrites.
- `src/server/kanna-mcp.ts` — `SETUP_LOOP_DESCRIPTION`,
  `buildSetupLoopToolList`, `SetupLoopHandlerResult` type,
  `KannaMcpArgs.setupLoop` callback.
- `src/server/agent.ts` — `AgentCoordinator.setupLoop({chatId, input})`;
  `StartClaudeSessionArgs.setupLoop`. Wired on main chats only
  (`delegationContext.depth === 0`).
- `src/server/claude-pty/driver.ts` — `setupLoop` param propagated to the
  kanna-mcp HTTP shim server.
- Tests: `loop-template.test.ts` (17 cases: happy path + rejections +
  edge cases + structural invariant), `loop-template-io.adapter.test.ts`
  (3 real-fs cases), `kanna-mcp.test.ts` (5 setup_loop cases), and 4
  coordinator cases in `agent.test.ts`.

## Verification

- `bun test --conditions production src/server/loop-template.test.ts`
- `bun test --conditions production src/server/loop-template-io.adapter.test.ts`
- `bun test --conditions production src/server/kanna-mcp.test.ts`
- `bun test --conditions production src/server/agent.test.ts` — includes
  the four `setupLoop` scenarios (skeleton-created / skeleton-preserved /
  multi-error rejection / unknown-chat).
- `bun run lint` + `bun run typecheck` clean.
- Manual smoke: open a chat; type `set up /loop with goal 'eslint passes'
  verify 'bun run lint'`. Confirm the tool call succeeds, `PROGRESS.md`
  appears at cwd root with the skeleton, `context_cleared` renders in the
  chat, next turn is a fresh spawn that reads `PROGRESS.md`.
