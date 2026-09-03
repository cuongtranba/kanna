---
name: kanna-loop
description: Autonomous long-horizon loops — the notification-driven orchestration pattern, setup_loop, the verify oracle and its arm-time gates, the tracking file (PROGRESS.md) and the structured MCP tools that read and write it, loop-armed tool blocking, the Progress panel, and loop wake recovery. Use whenever a task involves /loop, setup_loop, stop_loop, resume_loop, run_verify, query_tracking_file, append_tracking_row, replace_tracking_section, an armed loop, a loop that stopped waking or stalled, a loop that declared GOAL MET too early or kept going after the work was done, PROGRESS.md or another tracking file, loop_armed / loop_disarmed / loop_run_outcome events, or the chunk labels and rows in the chat footer's Progress card. Read it before changing the rendered loop prompt, since several of its phrases are asserted structurally and dropping one fails validation.
---

# Notification-driven loop orchestration

Long-horizon autonomous loops (eslint burn-downs, migration sweeps, multi-hour
codemods) run under a notification-driven pattern with per-iteration `/clear`
on the main agent's Claude session. There is no timer-based `schedule_wakeup`
anymore — it was removed when this pattern landed, superseding
`adr-20260603-agent-self-scheduled-wake`.

**Roles:**
- **Main agent = orchestrator; stateless-in-context, stateful-in-file.**
  Every subagent completion delivery /clears the main-agent Claude session
  (wipes `session_token`, appends `context_cleared` transcript entry). The
  next main turn is a FRESH Claude spawn that re-reads PROGRESS.md.
- **Subagent = worker per iteration.** Fresh Claude spawn per delegation
  (`sessionToken: null, forkSession: false` — enforced at
  `subagent-provider-run.ts:170-171`). Subagent does one chunk of work and
  writes PROGRESS.md before terminating.
- **PROGRESS.md** (or whatever tracking file the user configures) is the
  ONLY durability contract. Main context is intentionally ephemeral.

**Wake path:** the model calls
`mcp__kanna__delegate_subagent({run_in_background: true, prompt: ...})` and
ends the main turn. `SubagentOrchestrator` runs the subagent through the
existing permit pool + timeout + event-source plumbing; on terminal, its
`onBackgroundRunComplete` hook fires `AgentCoordinator.deliverSubagentToMain`,
which /clears the main session and emits an `auto_continue_accepted` event
with `source: "subagent_background"` and a minimal `"Read PROGRESS.md, decide
next action."` prompt. `fireAutoContinue` → `enqueueMessage` delivers on both
drivers.

**Loop termination:** absence of delegation. When the model reads PROGRESS.md
and sees the goal is met, it does not delegate. The main goes idle. No timer
to disarm, no wake cap to worry about.

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

**Example PROGRESS.md skeleton:**
```markdown
## Goal
eslint --max-warnings=0 exits 0

## Progress (latest first)
- 2026-07-11 W3 no-empty-function chunk 4/8 DONE (subagent run-abc123)

## Failed approaches
- Generic `noop` helper → typecheck fail (variance mismatch)

## Next chunk
W3 no-empty-function chunk 5/8: files X, Y, Z. Approach: shared typed noop.
```

**Example `/loop` recurring prompt:**
```
Read PROGRESS.md. If Goal met → PushNotification + STOP (do not delegate).
Else: delegate_subagent({run_in_background: true, prompt: "<Next chunk from
PROGRESS.md>; verify oracle; update PROGRESS.md with result then terminate"}).
End this turn.
```

## setup_loop MCP tool (validated template)

Instead of writing the recurring prompt by hand, the user can say "set up a
/loop with goal X, verify command Y" and the model calls
`mcp__kanna__setup_loop({ goal, verify_command, tracking_file?, chunk_hint? })`.
The server owns the template so the prompt is deterministic.

- **Pure validator** (`src/server/loop-template.ts`): rejects blank goal /
  unparseable verify command (unbalanced quotes) / `trackingFile` outside cwd
  / NUL byte. Returns a flat error list (does not fail-fast); the tool
  surfaces the list as `isError`. (There is intentionally NO length cap on
  `goal` / `chunkHint` — those were removed.)
- **Deterministic tracking-file reconcile** (`reconcileTrackingFile`, pure,
  same module): when the tracking file already EXISTS, it is reconciled
  against the canonical schema instead of being silently trusted — a pure
  string transform, no model judgement. Server-owned sections (`## Goal`,
  `## Verify command`) are rewritten in place when they differ from the
  setup_loop inputs; loop-owned sections (`## Progress`, `## Failed
  approaches`, `## Next chunk`) are preserved verbatim when present and
  inserted from the skeleton when missing (history never destroyed);
  preamble + unknown sections preserved. A conformant file round-trips
  byte-identical. The skeleton and the reconcile derive from one
  `CANONICAL_SECTIONS` table so they cannot drift. The tool result reports
  `created skeleton` / `reconciled: <actions>` / `already conforms`.
- **IO adapter** (`src/server/loop-template-io.adapter.ts`): creates the
  tracking file with a skeleton if absent; otherwise applies the injected
  pure reconcile and rewrites only when it reports a change. Parent dirs
  auto-created.
- **Coordinator entry** (`AgentCoordinator.setupLoop`): after validation +
  file ensure, wipes the chat's Claude `session_token`, appends
  `context_cleared`, and emits `auto_continue_accepted` with the templated
  prompt (source `subagent_background` — reuses the notification-driven
  path). Codex untouched.
- **Registration guard**: only registered on MAIN chats (`delegationContext.depth === 0`)
  — subagent spawns lose the no-op tool.
- **Rendered prompt invariants** (asserted structurally in `validateLoopSetup`):
  the recurring prompt MUST contain the tracking-file path, the verify
  command, `delegate_subagent`, `run_in_background: true`, `GOAL MET`,
  `ORACLE TOO WEAK`, `TERMINAL CHECK`, `EVERY section`,
  `with NO sections filter`, `Before writing DONE`, `END THIS TURN`, `/clear`,
  `query_tracking_file`, `append_tracking_row`, `replace_tracking_section`,
  `BOTH`, `AUTH_REQUIRED`, `do NOT call stop_loop`, and `Failed approaches`.
  Future edits to the template that drop any of these fail validation.

## Loop oracle + arm-time gates (adr-20260805-loop-oracle-hardening)

**The oracle is a proxy; the plan is the authority.** A loop once declared
GOAL MET at stage 4 of a 12-stage plan because its verify command — two greps
plus the standing gate — flipped green early. Step 3 of the rendered prompt is
therefore four cases over TWO signals, not one:

| verify | `## Next chunk` | orchestrator does |
| --- | --- | --- |
| exit 0 | empty / DONE | TERMINAL CHECK (below) → `GOAL MET` → `stop_loop` |
| exit 0 | still lists work | `ORACLE TOO WEAK` → `stop_loop`, hand to a human |
| non-zero | has work | delegate (normal case) |
| non-zero | empty | write the next chunk itself, then delegate |

The oracle-green-but-plan-full case deliberately STOPS rather than continuing:
the loop cannot tell a stale plan from a weak oracle, and only a human can
retighten the definition of done.

**TERMINAL CHECK (adr-20260806-loop-oracle-audit).** `## Next chunk` alone is
not enough to declare victory: a worker once wrote `DONE` there while five
undone chunks sat in a non-canonical `## Chunks` section that the
section-scoped read discipline meant nobody was ever shown — a grep-shaped
oracle was green, and the loop declared GOAL MET over an unfinished feature.
Before GOAL MET the orchestrator must call `query_tracking_file` with NO
sections filter — the ONE whole-file read the loop permits — and scan EVERY
section (canonical or not) for undone work; work found is case (b). The worker
brief carries the mirror rule: before replacing `Next chunk` with `DONE`, run
the same check and write any remaining work into `Next chunk` instead. Bounded
by construction: at most one full read per loop, on the terminal iteration.

**`setup_loop` refuses at arm time**, before the context wipe — every one of
these used to surface an iteration later, or not at all:

- worker is manual-trigger (`triggerMode` is carried in
  `LoopSetupContext.roster`; dropping it at the call site is the original bug —
  `MANUAL_ONLY` then fired only at the first delegation);
- the verify command **already exits 0** (the loop would declare GOAL MET
  having done nothing — either the goal is met or the oracle is too weak);
- the tracking file is **git-tracked and records a different goal**
  (`assertTrackingFileSafe`) — reconciling it would rewrite a finished loop's
  committed record;
- `workdir` is not the project checkout or a worktree of the same repo;
- `parallelism` outside 1..`MAX_PARALLELISM` (4).

`force: true` overrides the already-passing-oracle and tracked-file refusals.

**`workdir`.** The loop's working directory — where the verify command runs and
where `trackingFile` is rooted. Defaults to the project cwd; point it at a
sibling git worktree so the plan sits beside the branch it describes. Bounded
by `isWorktreeOfSameRepo` (compares `git rev-parse --git-common-dir`, which
makes worktrees of one repo compare equal while an unrelated repo does not).
The tracking-doc MCP tools resolve their base dir from the armed loop **per
call**, not per spawn — tools are built at spawn and `setup_loop` arms mid-turn.

**`parallelism`** (default 1) renders a fan-out rule, but only for chunks the
plan explicitly marks `[parallel]`, each naming its OWN worktree. Independence
is never inferred — two workers in one checkout corrupt each other's edits.

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
(`{verifyCommand, workdirAbs, trackingFileRel}`) backs `run_verify`, the
tracking-doc tools' base dir, and the chunk-label fallback below. It shipped
declared-but-never-passed, which silently hid `run_verify` entirely and made
every worktree loop resolve its tracking file against the chat cwd. It is now
wired from `toArmedLoopInfo(isLoopArmed(chatId))` (the single `LoopState` →
`ArmedLoopInfo` adapter, `claude-loop-commands.ts`) through BOTH drivers, on
BOTH the main-turn path (`claude-session-spawner.ts`) and the subagent path
(`agent-deps-builders.ts` → `claude-subagent-wiring.ts` →
`subagent-provider-run.ts`). **Do NOT copy `isLoopArmed`'s
`delegationContext.depth === 0` gate onto it.** That gate is right for
tool-blocking (only the orchestrator is blocked) and wrong here: the
tracking-doc tools are registered for subagents too, and a worker without the
loop's `workdirAbs` writes its progress into the wrong checkout.

## Loop Progress row labels (adr-20260805-loop-chunk-label)

A run's Progress row reads `SubagentRunSnapshot.label`, which
`deriveChunkLabel(prompt)` derives from the spawn prompt's first line. That is
right for an ad-hoc delegation (model-authored prompt) and useless for a loop:
`renderLoopPrompt` joins the worker brief into ONE line starting `Do the next
chunk in <file>. All work happens in <workdir>.` and asks for it verbatim, so
every row rendered the same 80-char boilerplate. Two channels now carry chunk
identity, first-match-wins:

1. **`[chunk: …]` marker** — the worker prompt opens with
   `[chunk: <one-line summary of the Next chunk you just read>]`, the ONE
   substitution step 4 asks the orchestrator to make. `parseChunkMarker`
   (shared, pure) returns null for an unsubstituted `<…>` body so template
   noise never reaches the UI. Pinned by `"[chunk:"` in the template's
   `requiredSubstrings`.
2. **The plan** — absent a usable marker, `buildLoopChunkLabelResolver`
   (`kanna-mcp.ts`) reads the armed loop's tracking file and takes the first
   line of `## Next chunk` (`chunkLabelFromSection`). At delegate time that
   section IS the chunk (the worker rewrites it only after finishing), so this
   needs no model cooperation — it is what makes the label a guarantee.

The marker wins because it is per-delegation: under `parallelism > 1` one turn
delegates several chunks and a single shared plan section cannot tell them
apart. The label rides `delegateRun({label})` → `spawnRun`, which falls back to
`deriveChunkLabel`. The file read lives in `kanna-mcp.ts` (already an adapter
importer), so no IO enters `subagent-orchestrator.ts`. A resolver failure is
swallowed — a label is cosmetic and must never fail a delegation.

## Loop Progress panel — file-sourced steps (adr-20260806-loop-progress-file-sourced-steps)

The chat footer's Progress card lists the loop's WHOLE checklist, read from the
armed loop's tracking file. It used to show only the delegations *this server
process* started since the current `loop_armed` — usually one row, with work
finished before the arm invisible and `LoopRowStatus: "pending"` unreachable.

- **Step source = the plan.** `LoopTrackingRegistry`
  (`src/server/loop-tracking-registry.ts`) watches the armed loop's tracking
  file and caches `{doneEntries, nextChunkSection}` — `## Progress` items via
  the new `StructuredDoc.listItems(content, section)` port method (mdast, so a
  continuation line or nested sub-list stays part of ITS item), and the
  `## Next chunk` source. IO is injected from
  `loop-tracking-io.adapter.ts`; `readTrackingFile` is **sync** because
  `snapshot()` is called from the pure, sync `deriveChatSnapshot`.
- **`watchTrackingFile` watches the PARENT DIR**, filtered by basename
  (`watchWorkflowDir`'s new `filterBasename`) — an inode-bound watcher is
  orphaned by a rename-based write, and a loop can arm before its skeleton
  lands. An event reporting no filename still fires.
- **One reconcile, two hooks.** `syncLoopTracking`
  (`src/server/loop-tracking-sync.ts`) derives the watch from `deriveLoopState`
  and is called from `AgentCoordinator.emitAutoContinueEvent` (the single
  append path for `loop_armed` / `loop_disarmed`) plus `rehydrateLoopTracking`
  at boot in `server.ts`. `register` is a no-op on an unchanged path — it runs
  on EVERY auto-continue event, and rate-limit churn would otherwise thrash the
  watcher.
- **Rows are oldest-first on BOTH paths** (`LoopProgressSnapshot.rows`
  docstring flipped). `buildLoopProgress` with `tracking` emits: plan-recorded
  chunks (`done`, synthetic ids `progress:<i>`) → a count-based top-up for a
  completion the worker never recorded → errored runs → the current step (live
  `running` runs, else one `pending` row from `## Next chunk` when armed). A
  completed run the plan already records is DROPPED, not label-matched — the
  plan is the authority and fuzzy matching flickers. `tracking == null`
  reproduces the old run-only behaviour exactly.
- **Known trade-off:** errored runs sort after every plan row, because a
  `## Progress` row carries no machine-readable timestamp. `maxDoneEntries`
  (200) caps the broadcast payload only; the file still grows on disk.
- **Transport:** no new WS topic. `BroadcastManager` subscribes to the registry
  and re-pushes the CHAT topic via `scheduleChatStateBroadcast`.

## Structured tracking-file access (mdast — bounds loop context growth)

Both the main orchestrator and its subagents are FRESH Claude spawns every
loop iteration, so nothing accumulates ACROSS iterations. The one thing that
persists and grows is the tracking file (PROGRESS.md) — and reading it whole
each iteration made per-turn context scale O(file size). The fix bounds it at
the READ + APPEND boundary via structured, section-scoped access instead of
capping the file.

- **Pure engine** (`src/shared/structured-doc/`): a format-agnostic port
  (`StructuredDoc`: `sections` / `query` / `listItems` / `append` / `replace`) + an extension registry
  (`resolveStructuredDoc(ext)` — `.md` → the mdast adapter today; add a
  format = one adapter + one registry row). The markdown adapter uses mdast
  (`mdast-util-from-markdown` + `micromark-extension-gfm`) purely as a PARSER
  to locate section + list-item boundaries by source `position` offset; every
  slice is taken from the ORIGINAL string, so queries/appends are
  byte-faithful (no reserialization of untouched content). NO IO — allowed in
  `src/shared/**` under the side-effect seal.
- **IO leaf** (`src/server/structured-doc-io.adapter.ts`): `readDoc` /
  `writeDoc` byte IO only.
- **MCP tools** (`kanna-mcp.ts`, `buildTrackingDocToolList`): registered
  whenever a `chatId` is present — so BOTH the main orchestrator AND subagents
  get them (no `depth === 0` gate, unlike setup_loop). Self-contained: they
  confine the path to the ARMED LOOP's workdir when one is armed, else the chat
  cwd (`confinePathToDir`), dispatch by extension through the registry, and
  call the IO leaf — no coordinator/spawner threading.
  - `query_tracking_file({ file?, sections?, list_limit? })` — returns only
    the requested sections (default file `PROGRESS.md`); `list_limit` keeps
    the first N items of a section's first list (e.g. latest N Progress rows)
    with a one-line elision marker. The whole file never enters context.
  - `append_tracking_row({ file?, section, entry, position? })` — inserts one
    entry under a section (`position: "top"` for newest-first logs) without a
    read-before-edit of the whole file. For true LOGS only (Progress, Failed
    approaches).
  - `replace_tracking_section({ file?, section, body })` — replaces a section's
    entire body. For sections holding CURRENT state, above all `Next chunk`,
    which must describe exactly one next step. Appending there instead makes
    completed chunks pile up until a later iteration re-reads a finished chunk
    and redoes the work — an observed bug, not a hypothetical.
  - **Always pass `file:`.** It defaults to `PROGRESS.md`, and the rendered
    worker prompt used to omit it — so a loop tracking `PROGRESS-panes.md` wrote
    its progress row into the committed `PROGRESS.md` of an unrelated finished
    loop. `renderLoopPrompt` now embeds `file:` in every call it prescribes.
- **Loop prompt wiring** (`renderLoopPrompt`): the orchestrator step 1 and the
  delegated-subagent prompt both instruct `query_tracking_file` (read) +
  `append_tracking_row` (write) and forbid reading/editing the whole file. The
  two tool names are asserted in the structural invariant.
- **Trade-off:** the file still grows unbounded ON DISK — that is intentional
  (history preserved); only context is bounded. `reconcileTrackingFile` stays
  line-based (byte-exact round-trip contract) and is untouched — the engine is
  additive, used only by the query/append path.

## Loop-armed state + hard tool-block (adr-20260712-loop-orchestration-hardening)

`setup_loop` durably arms the loop (`loop_armed` auto-continue event carrying
the resolved `subagentId` + rendered prompt; replayed by `deriveLoopState`).
`mcp__kanna__stop_loop` (model, on GOAL MET) and a real user `chat.send`
(takeover — awaited before the turn starts) emit `loop_disarmed`. While armed:

- **Filter-at-spawn (Claude Code's `filterToolsForAgent` pattern), both
  drivers.** `LOOP_BLOCKED_NATIVE_TOOLS` (Edit/Write/MultiEdit/NotebookEdit/
  Task) are removed at spawn — PTY via `--disallowedTools` CLI args, SDK via
  `options.disallowedTools` — so the model never sees them. The SDK
  `canUseTool` deny stays as mid-turn belt-and-suspenders.
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

## The un-armed delivery prompt NAMES the plan, or names nothing

When no loop is armed, `deliverSubagentToMain` used to tell the context-cleared
main agent to "Read PROGRESS.md if present". That is `setup_loop`'s DEFAULT
filename, so it identifies nothing — MEASURED on one install: 54 `PROGRESS*.md`
across sibling worktrees, **26** named exactly `PROGRESS.md`. And nothing
resolved it: the tracking-doc tools fall back to the chat cwd once no loop is
armed (`getArmedLoop?.(chatId)?.workdirAbs ?? args.cwd`), so both the sentence
and the tool pointed at the MAIN checkout while the loop had worked in a
worktree. A post-loop review followed it, read an unrelated finished loop's
plan, and graded the wrong feature.

`describeLastPlan(deriveLastLoopSpec(...))` now builds that sentence from the
`loop_armed` tombstone: the tracking file **absolute**
(`${workdirAbs}/${trackingFileRel}`), because a bare filename is precisely what
resolves against the wrong checkout. With no tombstone it names **nothing** — a
confident wrong filename is worse than silence, and the run's `<result>` is
still in the notification. This is the same defect class already fixed on the
WRITE path (`renderLoopPrompt` embedding `file:` in every call it prescribes);
the READ path was the half nobody had done.

`kanna-mcp.ts`'s `baseDir()` is deliberately NOT widened to a disarmed loop's
workdir — that is a confinement boundary, and an absolute path in the prompt
solves the problem without relaxing where the tracking-doc tools may write.

See `adr-20260830-unarmed-delivery-names-plan`.
