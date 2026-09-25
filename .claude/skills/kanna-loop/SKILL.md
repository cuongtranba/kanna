---
name: kanna-loop
description: Autonomous long-horizon loops — the notification-driven orchestration pattern, setup_loop, the verify oracle and its arm-time gates, the durable per-chat task list (mcp__kanna__task_* tools) that IS the loop's plan, loop-armed tool blocking, the Progress panel, and loop wake recovery. Use whenever a task involves /loop, setup_loop, stop_loop, resume_loop, run_verify, task_create/task_update/task_list/task_claim/task_settle/task_integrate/task_note, an armed loop, a loop that stopped waking or stalled, a loop that declared GOAL MET too early or kept going after the work was done, loop_armed / loop_disarmed / loop_run_outcome events, chat_task_* events, or the chunk labels and rows in the chat footer's Progress card. Read it before changing the rendered loop prompt, since several of its phrases are asserted structurally and dropping one fails validation.
---

# Notification-driven loop orchestration

Long-horizon autonomous loops (eslint burn-downs, migration sweeps, multi-hour
codemods) run under a notification-driven pattern with per-iteration `/clear`
on the main agent's Claude session. There is no timer-based `schedule_wakeup`
anymore — it was removed when this pattern landed, superseding
`adr-20260603-agent-self-scheduled-wake`.

**The plan is the chat's durable task list, not a markdown file
(adr-20260918-loop-tasks-replace-tracking-file).** A loop no longer creates,
reads, or writes `PROGRESS.md`. Its plan lives in event-sourced per-chat task
state (`src/shared/chat-tasks/**`, folded at `event-store-tasks.ts`, on the
`chat-tasks` log), read and written through the `mcp__kanna__task_*` tools. That
state survives `/clear`, a server restart, and the transcript tail window — the
three ways the old client-derived task card lost its rows. The markdown
tracking tools (`query_tracking_file` / `append_tracking_row` /
`replace_tracking_section`) remain for the NON-loop durable-document use in
CLAUDE.md; the loop simply does not use them.

**Roles:**
- **Main agent = orchestrator; stateless-in-context, stateful-in-tasks.**
  Every subagent completion delivery /clears the main-agent Claude session
  (wipes `session_token`, appends `context_cleared` transcript entry). The
  next main turn is a FRESH Claude spawn that re-reads the plan with
  `mcp__kanna__task_list`.
- **Subagent = worker per iteration.** Fresh Claude spawn per delegation
  (`sessionToken: null, forkSession: false` — enforced at
  `subagent-provider-run.ts:170-171`). Subagent does one task and records its
  outcome by SETTING the task's status (`mcp__kanna__task_update` /
  `task_settle`), not by appending to a log.
- **The task list** is the ONLY durability contract. Main context is
  intentionally ephemeral. Because a task's status is set rather than appended,
  a completed task cannot pile up and be redone — the bug class the old
  "replace, never append the Next chunk" rule guarded against is now
  structurally impossible.

**Wake path:** the model calls
`mcp__kanna__delegate_subagent({run_in_background: true, prompt: ...})` and
ends the main turn. `SubagentOrchestrator` runs the subagent through the
existing permit pool + timeout + event-source plumbing; on terminal, its
`onBackgroundRunComplete` hook fires `AgentCoordinator.deliverSubagentToMain`,
which /clears the main session and emits an `auto_continue_accepted` event
with `source: "subagent_background"`. The wake prompt is the validated static
loop template PLUS a freshly-rendered `<loop-state>` block
(`loop-wake-prompt.ts`, `composeLoopWakePrompt`) that lists the current tasks,
their counts and recent failure notes — a free deterministic prime that
survives the model skipping step 1. `fireAutoContinue` → `enqueueMessage`
delivers on both drivers.

**Loop termination:** absence of delegation. When the model calls `task_list`,
runs the TERMINAL CHECK, and sees every task completed with the oracle green,
it does not delegate. The main goes idle. No timer to disarm, no wake cap to
worry about.

**Removed (hard break) when this pattern landed:**
- `mcp__kanna__schedule_wakeup` MCP tool.
- `AgentCoordinator.scheduleAgentWakeup` method.
- `maybeArmPendingWorkflowWake` (pending-workflow poll harvest) — workflow
  status stays visible via the disk-watch panel; model can `delegate_subagent`
  to a status-check subagent for event-driven workflow wake.
- `AutoContinueSource` variants `agent_wakeup` and `pending_workflow`.
- Env vars `KANNA_MAX_AGENT_WAKES` and `KANNA_PENDING_WORKFLOW_POLL_MS`.

**PTY behaviour:** native `ScheduleWakeup` stays disallowed
(`PTY_DISALLOWED_NATIVE_TOOLS` still includes it) — the CLI cron is a
dead-letter under Kanna's spawn model and there is no Kanna replacement.
Native `/loop` slash command inside PTY-mode chats will not have a way to
schedule (its `ScheduleWakeup` calls hit the disallowed list); use
`delegate_subagent({run_in_background: true})` instead.

**Example task list (what `mcp__kanna__task_list` returns):**
```json
{
  "tasks": [
    { "id": "k:a1", "subject": "no-empty-function chunk 4/8", "status": "completed" },
    { "id": "k:b2", "subject": "no-empty-function chunk 5/8", "status": "in_progress", "claimId": "c-9" },
    { "id": "k:c3", "subject": "no-empty-function chunk 6/8", "status": "pending" }
  ],
  "total": 3, "completed": 1, "elided": 0
}
```
A failed approach is a `task_note({ kind: "failed_approach", … })`, read back
via `task_get`; it is the one loop concept a task's own fields cannot hold, so
it lives as a note (task-scoped or plan-scoped) and is re-injected into the wake
`<loop-state>` block so the next iteration does not repeat a dead end.

**Example `/loop` recurring prompt:**
```
task_list. If every task is completed and the oracle is green → STOP (do not
delegate). Else: mark the next pending task in_progress, then
delegate_subagent({run_in_background: true, prompt: "<that task>; verify oracle;
task_update status completed then terminate"}). End this turn.
```

## setup_loop MCP tool (validated template)

Instead of writing the recurring prompt by hand, the user can say "set up a
/loop with goal X, verify command Y" and the model calls
`mcp__kanna__setup_loop({ goal, verify_command, chunk_hint?, tasks?, tracking_file? })`.
The server owns the template so the prompt is deterministic.

- **Pure validator** (`src/server/loop-template.ts`): rejects blank goal /
  unparseable verify command (unbalanced quotes) / `trackingFile` outside cwd
  / NUL byte. Returns a flat error list (does not fail-fast); the tool
  surfaces the list as `isError`. (There is intentionally NO length cap on
  `goal` / `chunkHint`.)
- **Seeds the task list, writes no file.** The arm path creates the plan as
  tasks: `tasks?` seeds a plan written in advance
  (`{ subject, needs?, worktree?, branch? }[]`), else `chunk_hint` seeds a
  single task, else the plan starts empty and the orchestrator writes the first
  step itself. `reconcileTrackingFile` / `assertTrackingFileSafe` /
  `ensureTrackingFile` are gone from arming — there is no file to reconcile or
  clobber.
- **`tracking_file` is a one-time import hint, kept for back-compat.** If it is
  passed and the file exists with a `## Task queue` or `## Next chunk`,
  `importTrackingFileAsPlan` (`src/shared/chat-tasks/import-tracking.ts`) reads
  it into tasks once (progress → done, failed approaches → notes); the file is
  then left untouched on disk and never written again. Passing it and having it
  missing is a no-op. Rejecting it would break every saved prompt and skill that
  passes it, so it is accepted, not refused.
- **Re-arm safety.** Arming refuses (unless `force: true`) when the chat still
  has incomplete tasks from an earlier plan, listing them — the task-era analog
  of the old "don't silently clobber a previous loop's tracking file" gate.
- **Coordinator entry** (`AgentCoordinator.setupLoop`): after validation +
  seeding, wipes the chat's Claude `session_token`, appends `context_cleared`,
  and emits `auto_continue_accepted` with the templated prompt (source
  `subagent_background`). Codex untouched.
- **Registration guard**: only registered on MAIN chats (`delegationContext.depth === 0`)
  — subagent spawns lose the no-op tool.
- **Rendered prompt invariants** (asserted structurally in `validateLoopSetup`
  against `LOOP_STEP_INVARIANTS` / `LOOP_PARALLEL_STEP_INVARIANTS` in
  `src/shared/loop-progress.ts`): the recurring prompt MUST contain the verify
  command, `mcp__kanna__task_list`, `mcp__kanna__task_update`,
  `mcp__kanna__task_create`, `mcp__kanna__task_note`, `delegate_subagent`,
  `run_in_background: true`, `GOAL MET`, `ORACLE TOO WEAK`, `TERMINAL CHECK`,
  `EVERY task`, `with NO status filter`,
  `Before you mark the last task completed`, `END THIS TURN`, `/clear`, `BOTH`,
  `AUTH_REQUIRED`, `do NOT call stop_loop`, and `failed_approach` (the parallel
  list adds `mcp__kanna__task_claim`, `mcp__kanna__task_settle`,
  `mcp__kanna__task_integrate`, `WAIT`, `QUEUE BLOCKED`, `its OWN git worktree`,
  `git -C`). Future edits that drop any of these fail validation. The invariant
  list and the rendered template must be edited together.

## Loop oracle + arm-time gates (adr-20260805-loop-oracle-hardening)

**The oracle is a proxy; the plan is the authority.** A loop once declared
GOAL MET at stage 4 of a 12-stage plan because its verify command — two greps
plus the standing gate — flipped green early. Step 3 of the rendered prompt is
therefore four cases over TWO signals, not one:

| verify | task list | orchestrator does |
| --- | --- | --- |
| exit 0 | no pending / in_progress task | TERMINAL CHECK (below) → `GOAL MET` → `stop_loop` |
| exit 0 | still has an unfinished task | `ORACLE TOO WEAK` → `stop_loop`, hand to a human |
| non-zero | a task is pending | delegate (normal case) |
| non-zero | no pending task | write the next task itself (`task_create`), then delegate |

The oracle-green-but-plan-full case deliberately STOPS rather than continuing:
the loop cannot tell a stale plan from a weak oracle, and only a human can
retighten the definition of done.

**TERMINAL CHECK.** The oracle alone is not enough to declare victory — a
grep-shaped oracle can flip green while real work remains. Before GOAL MET the
orchestrator must call `mcp__kanna__task_list` with NO status filter and confirm
EVERY task is completed; any pending or in_progress task is case (b). The worker
brief carries the mirror rule: before it marks the LAST task completed it runs
the same check, and if any task remains it leaves that task for the orchestrator
to delegate rather than declaring the plan done. (The old failure mode — undone
work hiding in a non-canonical markdown section a section-scoped read never
showed — cannot recur: a task list has no hidden sections.)

**`setup_loop` refuses at arm time**, before the context wipe — every one of
these used to surface an iteration later, or not at all:

- worker is manual-trigger (`triggerMode` is carried in
  `LoopSetupContext.roster`; dropping it at the call site is the original bug —
  `MANUAL_ONLY` then fired only at the first delegation);
- the verify command **already exits 0** (the loop would declare GOAL MET
  having done nothing — either the goal is met or the oracle is too weak);
- the chat still has **incomplete tasks from an earlier plan** (arming over
  them would mix two plans) — listed in the error; `force: true` overrides;
- `workdir` is not the project checkout or a worktree of the same repo;
- `parallelism` outside 1..`MAX_PARALLELISM` (3).

`force: true` overrides the already-passing-oracle and incomplete-tasks
refusals.

**`workdir`.** The loop's working directory — where the verify command runs and,
for a parallel loop, the integration tree branches merge into. Defaults to the
project cwd; point it at a sibling git worktree so the work sits beside the
branch it describes. Bounded by `isWorktreeOfSameRepo` (compares `git rev-parse
--git-common-dir`, which makes worktrees of one repo compare equal while an
unrelated repo does not). The task tools resolve the integration workdir from the
armed loop **per call**, not per spawn — tools are built at spawn and
`setup_loop` arms mid-turn.

**`parallelism`** (default 1, max `MAX_PARALLELISM` = 3) switches the loop to the
claim protocol below. The cap is 3, not 4, because `DEFAULT_MAX_PARALLEL` is the
whole server's subagent permit pool — a loop allowed to take all 4 starves every
other chat, and exhaustion does not fail, it queues silently.

## Parallel loops — the task store IS the lock

For `parallelism > 1` the plan is the same task list, and its per-task fields
(`needs`, `worktree`, `branch`, `claimId`, `runId`) are the concurrency control.
A worker takes work with `mcp__kanna__task_claim` and returns it with
`task_settle`; there are no checkboxes to hand-edit.

**A task is claimable only when it is pending (or a stale lease), every id in
`needs` is completed, and its worktree is not held by a lease whose run is still
alive.** That one rule (`selectClaimableTask` in
`src/shared/chat-tasks/schedule.ts`) is the whole scheduler: with `t2 needs:
t1`, `t1` and an independent `t3` run in parallel while `t2` waits, and a pure
foundation phase degenerates to one worker.

**The claim is atomic in one process** — `EventStore.decideChatTaskEvents` runs
the read-decide-append inside the store's per-chat write chain, so two concurrent
`task_claim` calls can never lease the same task. This replaces the old
`withFileLock` read-modify-write, which existed only because the markdown tools
had an `await` between reading and writing the file.

**Reclaim is keyed on run liveness, NEVER on a wall clock** — this is the defect
that made the first design unshippable. A worker that FAILS never calls
`task_settle`, so its lease is still fresh when its own failure-wake arrives; an
orchestrator that reads "a live lease exists" then takes WAIT, ends the turn, and
**nothing ever wakes that chat again**, because only a run completion produces a
wake. A TTL cannot save this: TTL expiry generates no wake. So
`delegate_subagent` takes a `claim_id`, the server records `runId` on the task
(`chat_task_run_bound`), and `task_claim` reclaims every in-progress task whose
run is absent from `store.getSubagentRuns(chatId)` or not `running`. A wall-clock
grace (`CHAT_TASK_CLAIM_GRACE_MS`, 2 min) survives ONLY for a claim that never
bound a run — the orchestrator dying between claiming and delegating, a
one-tool-call window. Do not reintroduce a lease TTL as the primary recovery
path.

**Tools** (`kanna-mcp-tools/chat-tasks.ts`): `task_claim`, `task_settle`
(`done` | `release`), and `task_integrate`, which merges each completed,
not-yet-integrated task's branch into the integration workdir (`mergeLoopBranch`,
`loop-integrate-io.adapter.ts`) and records `chat_task_integrated`. Integration
is a SERVER tool, not prompt-level git: the orchestrator is a fresh context every
turn, and a multi-step stateful git operation driven by prompt discipline is the
least reliable place to put it.

**Decision table gains two rows.** `WAIT` (nothing claimable, a live run holds a
lease) ends the turn without delegating or stopping — the finishing worker wakes
it. `QUEUE BLOCKED` (nothing claimable, no live run, unfinished tasks) stops for
a human: a cycle, an unknown `needs` id, or a task with no worktree
(`validateChatTasks`'s four problem kinds).

**Arm-time / claim refusals:** a parallel loop merges branches into `workdir`, so
each task must name its OWN git worktree; a task with no worktree, or one naming
the loop workdir itself, is refused at claim. The integration branch defaults to
the branch checked out in `workdir` at arm time. There is no longer a
git-tracked-file refusal — there is no file.

**The failure budget scales** — `loopFailureBudget(parallelism)` is
`MAX_CONSECUTIVE_LOOP_FAILURES + parallelism - 1`. At a flat 3 with three
workers, one correlated failure (expired token, bad worktree set) burns the whole
budget in a single round, where in serial it covers three independent attempts.
Both consumers — `deliverSubagentToMain` and `handleFailedLoopTurn` — share it,
because they increment one counter.

**`/clear` during a parallel loop had to be fixed to work at all.**
`clearClaudeSessionContext` only closed the session when `!isSessionInUse`, so a
worker completing during another worker's wake-turn silently no-opped the clear
and the next orchestrator turn ran inside the previous turn's context — breaking
"fresh context, the file is the only state" exactly where the claim design needs
it. It now sets `session.contextClearPending`, which `spawnClaudeTurn` reads as a
respawn trigger beside `loopArmedAtSpawn`.

**Workers never call `run_verify`** — it resolves its cwd from the armed loop, so
a worker would verify the INTEGRATION tree rather than its own worktree, and
could be served a sibling's cached result. The worker prompt tells it to run the
verify command with Bash inside its own worktree instead.

**`LOOP_PARALLEL_STEP_INVARIANTS` is a SEPARATE, complete list** from
`LOOP_STEP_INVARIANTS`. Adding the parallel phrases (`task_claim`,
`task_settle`, `task_integrate`, `WAIT`, `QUEUE BLOCKED`, `git -C`) to the
serial list would require them in the serial prompt too; the two lists move
independently so serial and parallel prompts can each change alone.

**Host-owned failure backstop.** A `loop_run_outcome` auto-continue event
records each iteration; `deriveLoopState` folds it into `consecutiveFailures`
(reset by `loop_armed` and by any success). At
`MAX_CONSECUTIVE_LOOP_FAILURES` (3) the host emits `loop_disarmed` with reason
`repeated_failures`. This is what lets the prompt safely tell the model to
RETRY infra failures (`AUTH_REQUIRED`, `CAP_EXCEEDED`, timeouts) instead of
calling `stop_loop` — previously one transient auth error parked the run until
a human noticed.

**`run_verify` (oracle memoization).** The gate ran twice per productive
iteration (orchestrator, then worker) at ~65s each, and again on iterations
where nothing could have changed. `mcp__kanna__run_verify` runs the armed
loop's command and caches the result on a workspace digest (`git rev-parse
HEAD` + `status --porcelain` + size/mtime of every dirty path, sha256'd,
`loop-verify-io.adapter.ts`). Unchanged tree → the previous result instantly.

**A null digest is NEVER cached** (`loop-verify-cache.ts`): a non-git or
unfingerprintable tree must re-run, because serving a remembered pass for an
unknown tree is the same stale-green failure this whole section exists to
prevent. Timed-out runs are not cached either — a timeout says nothing about
the tree. Cache is in-memory, process-scoped, bounded at 64 entries; a restart
re-runs the oracle, which is the safe direction to be wrong in.

Loops armed before this landed replay with `verifyCommand`/`workdirAbs` null on
`LoopState`; `run_verify` then refuses and asks for a re-arm rather than
guessing a command to execute.

**Oracle guidance.** Prefer a test in the repo over a grep in a shell script:
a `renderToStaticMarkup` assertion cannot be satisfied by an import line,
whereas `grep -q SplitContainer` can. Scope the oracle to the TERMINAL state
of the plan, not the current stage.

**Arm-time oracle audit (adr-20260806-loop-oracle-audit).** `setup_loop` now
says the above at the moment it matters: pure `auditOracle` +
`extractOracleScriptPath` (`loop-template.ts`) statically inspect the verify
command and the `.sh`/`.bash` it references (read via `readOracleScript` in
`loop-template-io.adapter.ts`, confined to the loop workdir). Weak markers
(`test -f`, `[ -f`, `grep -q|-c|-L`, `ls … /dev/null`) with no test-runner
invocation, three-plus markers gating a real test run, or an unreadable
referenced script each produce one warning on the required
`SetupLoopHandlerResult.oracleWarnings`, rendered as an `Oracle audit:` block
appended to the setup_loop reply. NON-FATAL by design — heuristics misfire and
the operator owns the oracle; the audit never blocks arming. Pattern tables
live beside `auditOracle`; extend them with a unit fixture in the same PR.

**`getArmedLoop` must be SUPPLIED at every spawn site.** `ArmedLoopInfo`
(`{verifyCommand, workdirAbs, trackingFileRel, parallelism}`) backs `run_verify`
and the task tools' integration workdir + `requireWorktree` gate. It once shipped
declared-but-never-passed, which silently hid `run_verify` entirely. It is wired
from `toArmedLoopInfo(isLoopArmed(chatId))` (the single `LoopState` →
`ArmedLoopInfo` adapter, `claude-loop-commands.ts`) through BOTH drivers, on BOTH
the main-turn path (`claude-session-spawner.ts`) and the subagent path
(`claude-subagent-wiring.ts` → `subagent-provider-run.ts`). The same sites also
thread `chatTaskStore`, so a WORKER's `task_*` calls land on the PARENT chat.
**Do NOT copy `isLoopArmed`'s `delegationContext.depth === 0` gate onto them** —
that gate is right for tool-blocking (only the orchestrator is blocked) and wrong
here: the task tools are registered for subagents too, which is the whole point.

## Loop Progress row labels (adr-20260805-loop-chunk-label)

A run's Progress row reads `SubagentRunSnapshot.label`, which
`deriveChunkLabel(prompt)` derives from the spawn prompt's first line. That is
right for an ad-hoc delegation (model-authored prompt) and useless for a loop:
`renderLoopPrompt` joins the worker brief into ONE line and asks for it verbatim,
so every row would render the same boilerplate. The `[chunk: …]` marker carries
chunk identity instead: the worker prompt opens with
`[chunk: <the subject of the task you are delegating>]`, the ONE substitution
step 4 asks the orchestrator to make. `parseChunkMarker` (shared, pure) returns
null for an unsubstituted `<…>` body so template noise never reaches the UI;
pinned by `"[chunk:"` in the template's `requiredSubstrings`. There is no longer
a file-reading fallback resolver — the claimed task's own subject is the label,
and an unsubstituted marker simply yields no label (the run falls back to the
subagent name). The label rides `delegateRun({label})` → `spawnRun`.

(The Progress card ROWS themselves are task-sourced — see the next section — so
`deriveChunkLabel` now matters only for the per-run label on an errored,
task-unbound run.)

## Loop Progress panel — task-sourced steps

The chat footer's Progress card lists the loop's WHOLE plan, derived from the
chat's task projection (`buildLoopProgress` in `src/shared/loop-progress.ts`,
fed by `deriveChatTasks` off `state.chatTasksByChatId` in
`read-models.ts`). The unified card (`src/client/app/LoopProgressSection.tsx`,
which absorbed the old `TaskProgressSection`) is titled "Progress" when a loop is
armed and "Tasks" otherwise, showing a `completed/total` tally in the latter.

- **One row per task**, in plan (creation) order: completed → `done`,
  in_progress → `running`, pending → `pending`, and a pending task whose `needs`
  are unmet → `blocked` (`isBlockedByNeeds`). When armed, an errored subagent run
  NOT bound to any task is appended as a `failed` row so a crash before the task
  settled is still visible; a run bound to a task (`runId`) is not duplicated.
- **Native CLI Task tool calls appear too**, mirrored under the `n:` id
  namespace (Kanna-minted tasks are `k:`), so an ordinary non-loop chat gets a
  working Tasks card that — unlike the old client reducer — survives `/clear`
  (native tasks go `stale`, not deleted) and the transcript tail window.
  A subagent keeps its OWN native task counter (its first task is `#1` even when
  the parent already has a `#1`), so its tasks are scoped `n:<parent_tool_use_id>:<id>`
  and its `TaskList` resync replaces only that scope. Its tool results also carry
  no structured `tool_use_result`, so `TaskCreate`'s id is read from the result
  text (`Task #<id> created successfully`); without that fallback every create
  is dropped and the next `TaskUpdate` adopts the task under its bare id, which
  renders as a task titled "1" with no description.
- **Transport:** no new WS topic and no file watcher. `loopProgress` rides the
  existing `ChatSnapshot`; the coordinator's chat-task store port emits a chat
  state change after every task write, which re-pushes the chat topic.

## Structured tracking-file access — kept for NON-loop use only

The loop no longer reads or writes a tracking file, but the structured
tracking-document tools remain for the durable-document use CLAUDE.md documents
(a repo-resident file the user reads, commits and diffs):

- **Pure engine** (`src/shared/structured-doc/`): a format-agnostic port
  (`StructuredDoc`: `sections` / `query` / `listItems` / `append` / `replace`) +
  an extension registry (`resolveStructuredDoc(ext)`). NO IO — allowed in
  `src/shared/**` under the side-effect seal.
- **IO leaf** (`src/server/structured-doc-io.adapter.ts`): `readDoc` /
  `writeDoc` byte IO only. `withFileLock` (`tracking-file-lock.ts`) still guards
  the read-modify-write.
- **MCP tools** (`kanna-mcp.ts`, `buildTrackingDocToolList`): `query_tracking_file`,
  `append_tracking_row`, `replace_tracking_section`, registered whenever a
  `chatId` is present. Outside a loop a missing file is seeded from
  `renderTaskDocSkeleton`.

The loop-only file tooling that USED to live here — `claim_tracking_task` /
`complete_tracking_task` / `integrate_tracking_tasks`, `loop-task-queue.ts`,
`loop-tracking-registry.ts`, `loop-tracking-sync.ts`,
`loop-tracking-io.adapter.ts`, and the file-based reconcile/skeleton
(`reconcileTrackingFile`, `assertTrackingFileSafe`, `ensureTrackingFile`) — was
deleted when the loop moved to the task store.

## Loop-armed state + hard tool-block (adr-20260712-loop-orchestration-hardening)

`setup_loop` durably arms the loop (`loop_armed` auto-continue event carrying
the resolved `subagentId` + rendered prompt; replayed by `deriveLoopState`).
`mcp__kanna__stop_loop` (model, on GOAL MET) and a real user `chat.send`
(takeover — awaited before the turn starts) emit `loop_disarmed`. While armed:

- **Filter-at-spawn (Claude Code's `filterToolsForAgent` pattern), both
  drivers.** `LOOP_BLOCKED_NATIVE_TOOLS` (Edit/Write/NotebookEdit/Task/Agent)
  are removed at spawn — PTY via `--disallowedTools` CLI args, SDK via
  `options.disallowedTools` — so the model never sees them.
- **Mid-turn guard is a PreToolUse hook, not `canUseTool`.** The SDK never
  consults `canUseTool` for a call the permission mode already approved, and
  under `acceptEdits` that is every Edit/Write inside the working
  directories. The SDK session registers a PreToolUse hook
  (`buildLoopGuardHooks`, `claude-session-start.ts`) that reads
  `isLoopArmed()` per call and denies the blocked tools, which also covers
  the turn in which `setup_loop` armed the loop, before the respawn.
- **Respawn on armed flip.** Spawn args are immutable per process, so
  `ClaudeSessionState.loopArmedAtSpawn` is compared against the live
  `isLoopArmed()` in `startClaudeTurn`'s reuse condition — any flip (arm or
  disarm) forces a fresh session at the next turn boundary.
- **Armed wakes re-inject the full loop prompt** (see the re-entry rules in
  `.claude/skills/kanna-subagents/SKILL.md`), never the generic "decide next
  action" string.

## Per-subagent maxTurns (Claude Code frontmatter analog)

`Subagent.maxTurns` (Settings → Subagents editor; optional, unset = unbounded,
positive int) caps agentic turns per run — the analog of Claude Code's
per-agent-definition frontmatter `maxTurns` (NOT a global setting there
either; CC hardcodes 200 only for its fork agent). Enforcement:

- **Claude SDK runs:** threaded natively into `query()` `options.maxTurns` —
  the SDK stops gracefully at the limit and the accumulated output is kept
  (CC's `max_turns_reached` semantics).
- **PTY claude + Codex runs:** no native bound — `SubagentOrchestrator`
  applies a host-side backstop (`ProviderRunStart.maxTurns` +
  `nativeMaxTurns: false`): the run is aborted with error code `MAX_TURNS`
  once its `tool_call` entry count exceeds the bound. Harder semantics than
  native (abort, not graceful); the `nativeMaxTurns` flag prevents the
  backstop from clobbering the SDK's graceful stop.

## Loop wake recovery — three windows where a wake is lost

An ARMED loop always holds exactly one pending wake: a running subagent, a
queued message, or an active turn. Three ways that invariant broke, each fixed
by a different pass. The general queued-message durability rules live in
`CLAUDE.md` ("Queued messages are released on commit, not on dequeue"); what
follows is the loop-specific half.

**`recoverArmedLoopWakes` — the wake that died WITH the server.** The loop's
background subagent (or its delivery in `deliverSubagentToMain`, whose four
writes are not atomic) died before reaching the queue. Observed twice: chat
c87ab0ad (OOM killed run fc17bee6 seven minutes in) and chat 5cea83a7 (OOM
landed 118 ms after `loop_run_outcome`, before `auto_continue_accepted`). At
boot no subagent survives the dead process, so armed + idle + empty queue
proves the wake is lost, and the recovery re-emits it from the durable
`LoopState.prompt`. Runs AFTER `recoverQueuedMessages` on purpose: a chat whose
wake survived to the queue is busy (or still queued) by then, so the armed-loop
pass cannot double-fire it. The busy check goes through the injected
`isChatBusy` (the single predicate), never ad-hoc maps.

**`handleFailedLoopTurn` — the wake lost while the server kept running.** Both
passes live in `src/server/loop-wake-recovery.ts` and share ONE re-arm
(`rearmLoopWakeIfLost`), so what counts as a lost wake cannot drift between
them. An orchestrator turn that dies BEFORE it calls `delegate_subagent` leaves
no subagent to deliver, no queued message, and no active turn — and
`deliverSubagentToMain` is unreachable by construction, so nothing re-armed.
Observed twice in chat 108b8a13: an `api_error: ENOTFOUND` ended the wake turn
on 2026-08-28 (stalled 16 h, released only by a server restart) and again on
2026-08-29 (stalled 55 min, until the user typed "resume", which disarms). A
transport error matches neither `detectFromResultText` nor the auth detector, so
`handleLimitDetection` — the only other path that re-arms a failed main turn —
never fires.

It hangs off `AgentCoordinator`'s `onTurnTerminal` on `outcome === "failed"`, the
choke point every provider terminal path already funnels through. Four things
about it are load-bearing:

- **The re-arm is DEFERRED** (injectable `RearmScheduler`, default `setTimeout`).
  `recordTurnFailed` fires the observer BEFORE `activeTurns.delete` and before
  the queued-message drain, so an immediate re-arm reads a chat that is still
  busy. Every guard is re-evaluated at fire time, which is what makes the exact
  delay uncritical.
- **It records `loop_run_outcome {ok: false}`** so a repeatedly-crashing
  orchestrator feeds `MAX_CONSECUTIVE_LOOP_FAILURES` and gets disarmed with a
  visible reason. Without it this fix trades a silent stall for a silent hot loop.
- **The `running`-subagent guard is RUNTIME-ONLY.** A turn that failed after
  delegating still has its wake held by that run. The boot pass must NOT consult
  it: a run killed with the server never wrote a terminal event and replays as
  `running` forever, so honouring it there re-breaks the c87ab0ad incident.
- **It never throws.** It runs from the observer all turns pass through, so an
  escape would break the terminal path of turns that have no loop at all.

`cancelled` is deliberately excluded — a cancel is a human stop, and re-arming
would fight the user.

See `adr-20260814-armed-loop-wake-recovery` and
`adr-20260830-loop-runtime-wake-rearm`.

## A disarm is visible and undoable

Any user `chat.send` disarms an armed loop as a takeover
(`claude-send-command.ts`) — correct, since an armed loop blocks Edit/Write/Task
at spawn, but it used to be silent AND irreversible.

- **`compactLoopWakeEvents` retains the last `loop_armed` + `loop_disarmed`
  PAIR** as a tombstone. `loop_armed` is the sole carrier of `subagentId`, the
  rendered prompt, `verifyCommand`, `workdirAbs` and `trackingFileRel`; dropping
  it left nothing to re-arm from and nothing to name the loop's real plan with.
  **Both halves or neither** — keeping the arm alone replays through
  `deriveLoopState` as a still-ARMED loop, silently re-arming a loop the user
  stopped (pinned by "deriveLoopState returns null after disarmed-loop
  compaction").
- **`deriveLastLoopSpec` is a SECOND projection, deliberately.**
  `deriveLoopState` answers "is a loop running right now" and must keep
  returning null after a disarm; `deriveLastLoopSpec` answers "what loop did
  this chat last run" and survives it. Do not merge them.
- **`loop_disarmed` is a transcript entry**, rendered by `LoopDisarmedMessage`
  with the plan + worktree it recorded. Written for `goal_met`, `user_send` and
  `repeated_failures`; skipped for `chat_deleted` (no transcript left to read
  it in). The append is wrapped — the durable disarm already landed, so losing
  the card costs visibility while throwing would fail the user's send.
- **`resume_loop`** re-arms from the tombstone WITHOUT re-validating: the spec
  already passed `setup_loop`'s gates, and re-running them would refuse a loop
  whose oracle now passes — the very state a resume is for. Depth-0 only, like
  `setup_loop`. `consecutiveFailures` resets, matching `deriveLoopState`.
- **`rateLimit` is NOT gated on `loopState`.** A loop parked on a usage limit is
  exactly when a user types "resume" — and that send nulled `loopState`, which
  nulled `rateLimit`, which un-rendered the "Resume now" button. The attempt to
  resume destroyed the resume affordance.

See `adr-20260830-loop-disarm-visible-resumable`.

## The un-armed delivery prompt

When no loop is armed, `deliverSubagentToMain` builds the context-cleared main
agent a short prompt naming what the last loop left behind. With the plan now in
the task store rather than a file, the honest pointer is `mcp__kanna__task_list`
— the chat's tasks survive a disarm, so a post-loop review can read exactly what
was completed and what was left. `describeLastPlan(deriveLastLoopSpec(...))`
still exists and `trackingFileRel` stays optional on the `loop_armed` /
`loop_disarmed` tombstone for loops armed before this change; a legacy tombstone
that carries a tracking file still names it, and the run's `<result>` rides the
notification regardless.

The historical bug this section recorded — a bare `PROGRESS.md` resolving
against the wrong checkout across 26 sibling worktrees — is deleted by
construction: the task store is keyed on `chatId` and has no path.

See `adr-20260830-unarmed-delivery-names-plan` (superseded by
`adr-20260918-loop-tasks-replace-tracking-file`).
