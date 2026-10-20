---
name: kanna-sessions
description: Claude session and turn lifecycle in Kanna — the Agent SDK driver, builtin /clear and /compact, compaction and the history primer, PendingToolSlots and KANNA_MCP_TOOL_CALLBACKS, the kanna-mcp built-in shims, the LSP tool allowlist, background-task keep-alive, self-wake, live blocks (chat.live), isSessionInUse and session teardown, queued messages and their recovery, transcript memory budgets, the workflow status panel, projectProcessEnv, and /name skill expansion on Codex. Use whenever a change touches claude-session-*, claude-send-command, claude-turn-*, agent-coordinator, event-store queue or transcript code, the idle reaper or budget enforcer, CLAUDE_TOOLSET, compaction, or a chat that is stuck busy, lost a queued message, or got torn down mid-turn.
---

# Kanna sessions — turns, compaction, queue, keep-alive

Moved verbatim from the root `CLAUDE.md`. These invariants are each backed by a measured incident; read the relevant section before editing the code it names.

## Tool Callback Feature Flag (KANNA_MCP_TOOL_CALLBACKS)

Setting `KANNA_MCP_TOOL_CALLBACKS=1` routes `AskUserQuestion` and
`ExitPlanMode` through the durable approval protocol in
`src/server/tool-callback.ts`. Pending requests survive server restart
(resolved as `session_closed` fail-closed on boot) and are replayed to the
client on reconnect as `pending_tool_request` transcript entries. Default is
off; without the flag the legacy `canUseTool` → `onToolRequest` path runs.

The model's native `AskUserQuestion` / `ExitPlanMode` reach the durable protocol
through `buildCanUseTool` (`claude-spawn-helpers.ts`), so Kanna registers no
`ask_user_question` / `exit_plan_mode` MCP stand-ins and there is no
`forceInteractiveToolCallbacks` argument. The flag **exclusively** gates that
`canUseTool` routing and the 8 built-in shims
(`read/glob/grep/bash/edit/write/webfetch/websearch`).

### Pending-tool lifecycle (legacy `canUseTool` path — PendingToolSlots)

On the legacy path the parked request is nothing but an in-memory promise:
the parked `resolve` IS the SDK worker's `canUseTool` continuation. Drop it
and that worker blocks forever, `respondTool` throws `"No pending tool
request"`, and the chat is wedged with no way back — under the SDK driver
`interrupt()` is in-band, so the session survives and nothing else frees it.

**The parked continuation lives in `PendingToolSlots`
(`src/server/pending-tool-slot.ts`), keyed by chatId and INDEPENDENT of any
`ActiveTurn`** (adr-20260807-pending-tool-slot). There is no
`ActiveTurn.pendingTool` field and no ghost turn: when the SDK self-resumes
after a background-task notification and calls `canUseTool` outside any
Kanna turn, the request simply parks in the slot. The predecessor design
fabricated a ghost `ActiveTurn` (`rebuiltFromSession`) to hold the resolve;
every consumer of `activeTurns` then had to special-case it, and the one
that didn't leaked the ghost forever — chat stuck "running", sends queued
with no drain, `selfWakeActive` wedged, idle reaper blocked (session
04fb43c9). Do NOT reintroduce a turn-attached pending tool.

Slot transitions: `park` (dedup — an occupied slot is discarded first),
`take`/`takeAny` (caller settles, used by `respondTool`/`cancelChat` so the
transcript append precedes the worker resuming), `discard` (settle-now, used
at terminal results and session death). Settling uses `discardedToolResult`
→ `{discarded: true}`, and `buildCanUseTool` short-circuits that to
`behavior: "deny"` — without the short-circuit its legacy branch maps *any*
result to `behavior: "allow"`, so the SDK would actually execute
`AskUserQuestion` with empty answers and overwrite the "Discarded" marker.

Settle sites: `cancelChat` (FIRST, turn-independent — one Stop frees a
question parked mid-turn or mid-self-wake), the runner's real-turn result
finalize, the self-wake disarm branch (which also drains the queued-message
queue), and the runner's `finally` (session death). The reaper
(`isClaudeSessionIdle`) and budget enforcer never close a session whose chat
has a parked slot — the worker is blocked inside `canUseTool`, so
`lastUsedAt` stales while the user reads the question.

**Busy derivation is single-sourced:** `isChatBusy`
(`claude-session-state-queries.ts`) = live turn ∨ booting turn ∨ parked
slot ∨ streaming self-wake. The send gate and `maybeStartNextQueuedMessage`
both consume it; never combine the underlying maps ad-hoc.

Optional `KANNA_SERVER_SECRET` env var stabilises HMAC tool-request ids
across the process lifetime. Cross-restart idempotency does not matter
because `recoverOnStartup()` fail-closes all pending records on boot.

Periodic `tickTimeouts` driver fires every 5s; default request timeout is
600s. Pending requests time out as `{kind:"deny", reason:"timeout"}`.

## Claude sessions run on the Agent SDK only

Every Claude chat runs the Claude Agent SDK (`startClaudeSession`); OpenRouter
chats go through the same entry point. The PTY driver — the
`claude` CLI under a pseudo-terminal, with the on-disk transcript JSONL as its
event source — was removed in `adr-20261008-remove-pty-driver`, along with its
loopback MCP server, instance registry, status panel and `kanna-pty` skill. The
embedded terminal (`terminal-manager*`) is a different feature and is untouched.

- **Compatibility, not configuration.** `claudeDriver.preference` is no longer a
  setting: `normalizeClaudeDriverSettings` drops a saved value, `pty` included,
  without a warning, and the file is rewritten without it on the next save.
  `KANNA_CLAUDE_DRIVER=pty` logs one warning at boot and is otherwise ignored.
  `TurnRunConfig.driver` is optional so turn logs written before the removal still
  describe themselves; new turns do not write it.
- **`claudeDriver.lifecycle` stayed**, because SDK sessions use it: the idle
  timeout and the resident-session limit (Settings → Providers).
- **What looks PTY-shaped but is not dead.** The background-task launch-text
  regex (`backgroundTaskIdsFromToolResult`) is the SDK's version-skew fallback.
  `pushChannelPrompt` feeds keep-alive subagent sessions. `OutputRing`
  (`output-ring.ts`) backs background-task output tracking, and
  `claude-projects-path.adapter.ts` (`encodeCwd`, `computeProjectDir`,
  `computeWorkflowsDir`) locates Claude's on-disk project directory for
  workflows, imports and subagent transcripts.

## Builtin slash commands — `/clear` and `/compact [instructions]`

Two commands Kanna implements itself rather than forwarding as prompt text.
`src/shared/builtin-commands.ts` is the single source for both the parser and
the picker catalog (`BUILTIN_SLASH_COMMANDS`, `scope: "builtin"`); a colocated
drift guard asserts every catalog entry parses, so the picker can never
advertise a command dispatch does not handle. **A builtin must be the whole
message** — `/clear now` does not match, because discarding what the user typed
is worse than treating the line as a prompt.

`runBuiltinCommand` (`claude-send-command.ts`) is the one dispatch site, called
from `sendCommand` **after** the `isChatBusy` branch and from
`dequeueAndStartQueuedMessage` (non-steered only). That placement is what makes
a `/clear` typed mid-turn queue like any other message; do not hoist it above
the busy check.

- **`/clear`** starts no turn. `clearChatContext`
  (`claude-context-commands.ts`) nulls every provider's token, applies the
  claude suppress-persist + idle-session teardown, **stops the codex process**,
  and appends `context_cleared`. The codex stop is load-bearing:
  `CodexAppServerManager.startSession` reuses a live session on a cwd match and
  never consults the session token, so a token wipe alone is a no-op on the next
  turn. `clearClaudeSessionContext` lives here too (moved from
  `claude-loop-commands.ts`, re-exported) so the loop `/clear` and the user
  `/clear` cannot drift.
- **`/compact`** is a turn everywhere. claude + openrouter get the CLI command
  verbatim (`appendUserPrompt: false`). Codex's app-server exposes **no**
  compaction request, so Kanna runs the summarization itself and
  `claude-turn-runner.ts` reshapes the reply into `compact_boundary` **then**
  `compact_summary`. That order is load-bearing — the history primer resumes at
  the last boundary, so summary-first would discard the summary. Error, cancel,
  or empty prose commits nothing.

### `CompactionTurnKind` — one field, two questions

`ActiveTurn.compactionTurn` is `"proactive" | "user" | "codex_summary"` (it
replaced the boolean `proactiveCompactInjection`). One predicate reads it:

- `isProactiveCompactTurn` — gates the `compactFailureCount` circuit breaker and
  the `message.dequeue` refusal. `proactive` only. Both exist to bound Kanna's
  **own** automatic injection; a user-typed `/compact` owns no queued message
  and must not consume that budget.

A `compact_boundary` entry never finalizes a turn; the turn ends on its `result`
entry. The PTY driver finalized on the boundary because the CLI wrote no result
row for a compaction, which is why `isCliCompactTurn` existed — both went away in
`adr-20261008-remove-pty-driver`.

### History primer is scoped to the last context reset

`buildHistoryPrimer` (`history-primer.ts`) starts at the most recent
`context_cleared` / `compact_boundary`, counts `compact_summary` as assistant
content, and hoists a summary sitting on the older side of its own boundary
(emission order is not ours to control). Without this, `shouldInjectPrimer`
returning true on a null token means a cleared chat re-sends up to
`PRIMER_MAX_CHARS` (60k) of the conversation it just dropped — which silently
defeated the loop `/clear` path (`setup_loop`, `deliverSubagentToMain`,
`disarmFailingLoop`) too, despite that design resting on main being
stateless-in-context. `shouldInjectPrimer` itself is unchanged: "token null ⇒
prime" was always right; the bug was *what* got primed.

The picker merges the builtins in `localCommandsForCwd`, not in
`LocalCatalogService.list` (whose contract stays the disk catalog). The catalog
is no longer narrowed by provider — see **Local skills on every provider** below.
A project-authored `.claude/commands/clear.md` is dropped from the listing
because dispatch intercepts that name first; rename it.

See `adr-20260811-builtin-clear-compact-commands`.

### Compaction observability — typed metadata, SDK hooks, the `appendMessage` seam

`compact_metadata` was always on the wire and never read: `trigger` and
`pre_tokens` sat inside `debugRaw` as untyped text. `CompactBoundaryEntry` now
carries a typed `compactMetadata` (`transcript-types.ts`), parsed by
`parseCompactMetadata` in the normalizer — so it covers the live SDK stream and
the on-disk JSONL reader (`agent-transcript-parse.ts`), which share that function.

**Both wire spellings are real, and neither is defensive.** The SDK stream emits
`compact_metadata` / `pre_tokens`; the CLI's on-disk transcript JSONL, which
session import and subagent transcripts read, emits `compactMetadata` /
`preTokens`. `parseCompactMetadata` reads both per field, exactly as
`ClaudeRawUsage` already does for `input_tokens` / `inputTokens`. Dropping
either spelling silently breaks one of the two readers.

**Assistant usage is NESTED under `.message`, and reading it from the top level
silently emits nothing.** `normalizeClaudeUsageSnapshot` returns `null` for
`undefined`, so the wrong path costs no error — just no `context_window_updated`
entry, ever, which takes out the composer's session-token pill and the
context-window meter. #344 fixed exactly this in the PTY driver's JSONL reader
and left `claude-harness-stream.ts` alone on the belief that "the SDK stream-json
shape keeps `usage` at the top level"; it does not. Measured before the fix:
**0 of the 40 most recent chats**, all `sdk`, held a single
`context_window_updated` entry. `claude-harness-stream.ts` now spells it
`message?.usage ?? usage`, and its suite's fixtures carry the nested shape — the
flat fixtures are what masked the defect.

**`PostCompact` exists to keep the primer whole, not for diagnostics.**
`selectPrimerEntries` scopes from the newest `compact_boundary` and carries
pre-boundary history forward only when a `compact_summary` entry exists.
SDK auto-compaction emits the boundary and no summary — measured on one install:
**19 boundaries across 4 chats, zero summaries** — so every compaction silently
truncated the primer to nothing. The `"This session is being continued"` branch
in the normalizer never fires here; that text is a CLI artifact, not an SDK
stream message. `PostCompact` is the only place the summary is available, so
`AgentCoordinator.handleCompaction` appends it as a `compact_summary` entry.
`history-primer.test.ts` pins the loss case, so deleting the hook fails a test
rather than quietly costing every long chat its history.

**The hooks are observational and must stay that way.** `SyncHookJSONOutput`
has no `PreCompact`/`PostCompact`-specific output, so they cannot steer
compaction; both return `{}`. Three bounds are load-bearing:

- **`input.agent_id` returns early.** The SDK's own Task-tool workers fire these
  hooks (`sdk.d.ts` documents `agent_id` as the way to tell them apart).
  Without the guard a worker's compaction is counted as a main-session one and
  its internal summary is written into the user's transcript.
- **Registration is conditional on `onCompaction`,** and subagent sessions never
  pass it — `claude-subagent-wiring.ts` forwards the *parent* chatId, so a
  subagent's summary would land in the user's chat and then feed back into the
  parent's next cold start.
- **The append is fire-and-forget.** `requireChat` throws synchronously before
  the store's write chain and `HookCallbackMatcher` carries a `timeout`, so
  awaiting it turns a cold chat or a backed-up transcript flush into a rejected
  hook. Ordering is safe either way: appends serialise through the write chain,
  and the primer already hoists a summary sitting on the older side of its
  boundary. The entry's `messageId` is derived from the session id plus the
  summary, so a re-fire dedupes.

**Telemetry is recorded at `EventStore.appendMessage`, not in the runner**, and
both reasons matter. `runClaudeSession` measures 122 against the `complexity`
ceiling pinned in `budget.ts` (127), so it has almost no headroom. And it is
Claude-only: Codex's synthesized boundary (`claude-turn-runner.ts`) and its
native one (`codex-app-server.ts`) never reach it, while every producer funnels
through `appendMessage`. Attributes are `{provider, trigger}` only — at that
seam the chat's `model` is the *current* one rather than the compacted turn's,
so it would be wrong as well as unbounded.

`COMPACTION_TOKEN_BUCKETS` needs its own view in `otel.adapter.ts`: OTel's
default boundaries stop at 10 000 and real `pre_tokens` is ~207 000, so without
it every observation lands in `+Inf` and `histogram_quantile` returns garbage —
the same failure `DURATION_BUCKETS_MS` exists to prevent. No alert rule is armed
yet; the names are in `EXPORTED_PROM_METRICS` so one can be added from observed
data, which `rules.test.ts` requires a paused rule to justify.

**`PreCompact` deliberately does not checkpoint task state.** The harness cannot
author it — only the model knows the task — so the hook records
`kanna.compaction.started` and returns. The checkpointing discipline is carried
by the durable-state paragraph in `KANNA_SYSTEM_PROMPT_BASE` instead, which is
why that paragraph is part of this feature rather than optional polish.

### A tracking document is durable task state, and works outside a loop

`append_tracking_row` / `replace_tracking_section` / `query_tracking_file` are a
repo-resident, git-diffable, human-readable durable-document surface: a file the
user reads, commits, and travels with a worktree, holding prose (Decisions,
Unresolved errors). They create the file on a missing path, seeded from
`renderTaskDocSkeleton` (`shared/task-doc.ts`): Objective, Acceptance criteria,
Status, Completed, Remaining, Decisions, Failed approaches, Unresolved errors.
No new store and no new IO — `writeDoc` already `mkdir -p`s, and the same
`StructuredDoc` engine reads it back by section.

**This is a DIFFERENT surface from the loop's task list.** A loop's plan lives in
the chat-scoped, event-sourced task store (`mcp__kanna__task_*`, above), which is
not in git and holds structured rows; this tracking document is on disk and holds
prose. Use `mcp__kanna__task_*` for a structured checklist for THIS chat that
survives `/clear` and compaction and shows in the footer; use the tracking
document for a durable repo-resident record the user will read, commit and diff.
The loop no longer uses these tools at all.

**The skeleton says `## Objective`, never `## Goal`.** The default filename is
`PROGRESS.md`. Because the loop no longer reads or writes any tracking file, a
document created this way can never collide with a loop's plan or reach the
Progress panel.

## Local skills on every provider — `/name` expansion + the Codex roster

The claude CLI resolves `/name` against `.claude/skills` + `.claude/commands`
itself, so `claude` and `openrouter` (same SDK, `settingSources: ["user",
"project", "local"]`) have always worked. Codex received the literal line and
answered it as prose, and `commandsForProvider` hid every non-builtin from its
picker to stop that — which left the whole local skill catalog unreachable
there. Kanna now expands the command itself, on two fronts.

**`providerExpandsSlashCommands` (`provider-model-types.ts`) is the gate, and
its DEFAULT direction is load-bearing.** It lists the providers whose harness
does the expansion (claude, openrouter); everything else gets Kanna's. A
provider added later and forgotten by the list therefore gets WORKING slash
commands, where a default of "the harness handles it" would silently give it
none. Its membership equals `providerUsesSdkSession` today and the two are
pinned against each other by a test — but they answer different questions (how a
prompt is DELIVERED vs what the prompt should BE), so do not collapse them.

**User-invoked** — `expandSlashCommand` (`skill-invocation.ts`) resolves the
name through `LocalCatalogService.resolve`, reads the file with
`readCatalogFileBody`, and `buildSlashExpansion` (`shared/slash-expansion.ts`)
substitutes `$ARGUMENTS` / `$1..$9`. A **command** expands to its substituted
body verbatim (a command file *is* a prompt); a **skill** gets a header naming
it, its directory, and the arguments, because `SKILL.md` is a document rather
than a request. Dispatched from `claude-send-command.ts` at the two sites that
already dispatch builtins — after `parseBuiltinCommand` (so `/clear` is never
shadowed), after the `isChatBusy` branch (so a `/skill` typed mid-turn queues),
and never for a steered message.

**`StartTurnForChatArgs.promptOverride` is what the provider runs; `content`
stays the line the user typed.** So the transcript bubble and the generated
title read `/deploy staging` rather than an 8 KB skill body. `user_prompt`
carries `expandedCommand` and `UserMessage` renders it as one muted line —
without it "the skill ran" and "your text was sent verbatim" are
indistinguishable, and they behave completely differently.

**Model-invoked (Codex)** — `renderSkillRosterBlock` (`kanna-system-prompt.ts`)
lists each skill's name, description and absolute `SKILL.md` path into
`buildCodexDeveloperInstructions`, capped at `KANNA_SKILL_ROSTER_LIMIT` (60) and
truncating long descriptions. **Reading the named file IS the invocation:**
Codex's app-server protocol has no way to declare a tool — `ThreadStartParams`
carries no `mcpServers`, `TurnStartParams` no `tools`, and an unknown dynamic
tool call is answered `Unsupported dynamic tool call` — so `developerInstructions`
is the only injection point there. It works because the thread runs
`sandbox: "danger-full-access"`, which makes a personal or plugin skill outside
the project cwd reachable by absolute path. The roster is the ONE consumer of
`KannaSystemPromptOptions.skills`; the Claude suffix ignores it, since the CLI
loads a skill on demand and this only inlines a pointer.

**Applied at `thread/start`, so a skill authored mid-chat reaches the model at
the next session start** (`/clear`, restart, idle reap) — `startSession` reuses a
live session on a cwd match.

**`LocalCatalogService` has two readers over ONE scan.** `resolve` is restricted
to user-invocable entries so an invocation and the picker cannot disagree about
which names exist; `skills` deliberately INCLUDES `user-invocable: false` ones,
because that flag hides a skill from the picker while leaving auto-triggering
intact. Both read the cached row — neither rescans.

**`` !`cmd` `` and `@path` are NOT executed.** They survive verbatim and the
expansion adds one line telling the model to run/read them with its own tools.
Executing a shell command on the send path would put arbitrary execution ahead
of the turn meant to approve it.

**Every failure degrades to "send what the user typed."** An unresolvable name
may be a path, or a command the provider itself knows; an unreadable `.claude`
directory costs a skill, while failing the send costs the turn.

## Kanna-MCP Built-in Shims

When `KANNA_MCP_TOOL_CALLBACKS=1`, kanna-mcp registers 8 additional tools
that mirror Claude's built-ins: `mcp__kanna__{read, glob, grep, bash, edit,
write, webfetch, websearch}`. They route through the durable approval
protocol with the same path-deny rules as the bash tool from P1 (readPathDeny
for `read`/`glob`/`grep`, writePathDeny for `edit`/`write`).

An ordinary SDK session keeps the model's native built-ins, so the model has no
reason to call the shims there. **A restricted subagent is different:**
`claude-session-start.ts` strips `SDK_RESTRICTED_FS_NATIVE_TOOLS` from its
toolset whenever `restrictedAllowedPaths` is set, and the shims — registered
with those paths — become its only file tools, each call checked by
`permission-gate.ts`. With the flag off, such a subagent has no file tools at
all; PR 4 of `PLAN-agent-sdk-builtins.md` replaces this with a PreToolUse hook
that keeps the native tools. The removed PTY driver also routed through the
shims, via `--tools "mcp__kanna__*"`.

`websearch` is a stub that always returns `isError: true` — real web search
needs an external API integration which is out of scope for P3a.

## The `LSP` tool — one tool, every language

`CLAUDE_TOOLSET` (`claude-session-config.ts`) is an **exclusive allowlist**, not
a hint. The SDK documents its `tools` option as "the **base set** of available
built-in tools" (`sdk.d.ts`), and `claude-session-start.ts` passes the array
rather than `{type:"preset", preset:"claude_code"}` — so a native tool absent
from that list is not merely unadvertised, it is **unreachable**, and asking for
it by name is a silent no-op. `LSP` was missing for exactly that reason, which
read from inside a session as "the SDK does not support LSP" (upstream
`claude-agent-sdk-typescript#123`, filed against SDK 0.2.2 / CLI 2.1.2). It does:
the CLI this repo ships registers `LSP` with `goToDefinition`, `findReferences`
and `goToImplementation`. Verify the gate on a live session by reading the
spawned process's own argv — `ps -ww -o command= -p <pid>` prints the `--tools`
list verbatim.

**`LSP` is ONE tool covering every language.** There is no per-language tool and
no Kanna-side language list: the CLI picks a server from whichever `*-lsp`
plugin is installed, matching the file's extension through the plugin's
`extensionToLanguage` map. **Adding a language is therefore never a code change
here** — install the plugin, then put its `command` on PATH:

| Plugin | `command` on PATH | Install |
| --- | --- | --- |
| typescript-lsp | typescript-language-server | `npm i -g typescript-language-server typescript` |
| pyright-lsp | pyright-langserver | `npm i -g pyright` |
| gopls-lsp | gopls | `go install golang.org/x/tools/gopls@latest` |
| rust-analyzer-lsp | rust-analyzer | `brew install rust-analyzer` |
| jdtls-lsp | jdtls | `brew install jdtls` |

The marketplace also ships clangd, csharp, kotlin, lua, php, ruby and swift; all
work the same way. **The plugin is pure config — it declares the command and the
extension map, and ships no binary.** A plugin whose server is missing fails at
`lsp_server_start` and the tool simply never answers for that language, so an
install is only half done until the binary resolves. It must resolve on the PATH
of the process that spawns claude, which is not necessarily your shell's:
`go install` and Homebrew write to `~/go/bin` and `/opt/homebrew/bin`, and a
server launched from a profile-less context may see neither.

**The restricted path deliberately strips `LSP`** — it is in
`SDK_RESTRICTED_FS_NATIVE_TOOLS`. Restricted mode exists to confine a subagent to `restrictedAllowedPaths`, and it
does that by removing the native FS tools so the `mcp__kanna__*` shims can route
every read through `permission-gate.ts`. **`LSP` is a file-read primitive that
gate cannot see**: `goToDefinition` returns file locations and contents, so a
native `LSP` in a confined subagent would read straight past its allowed roots.
The CLI's own boundary is no substitute — it enforces cwd + `--add-dir`, which is
broader than `restrictedAllowedPaths` by construction. The CLI classifies `LSP`
the same way, listing it beside Read/Grep/Glob as a file tool subject to
working-directory checks.

**`SendMessage` is on the list for the same reason `LSP` is.** The CLI's own
`Agent` tool advertises it twice — in the tool description ("Use SendMessage
with the agent's ID or name to continue a previously spawned agent") and in
every background-launch result (`Use SendMessage with to: '<agentId>' … to
continue this agent`, the text `claude-prompt-helpers.test.ts` pins). With it
absent from the allowlist the model followed that advice and got `No such tool
available: SendMessage. SendMessage is disabled for this session` (chat
`11e60231`, 2026-09-15), then had to relaunch a fresh `Agent` with a full
re-brief — the prior agent's context was unreachable. `SendMessage` is not a
file-read primitive and stays available on the restricted path.

## A project's process never inherits Kanna's runtime env (`projectProcessEnv`)

Anything Kanna starts to run a PROJECT's code — a Claude SDK session, the
Codex app-server, the embedded terminal, the loop oracle, an MCP stdio server —
builds its environment through `projectProcessEnv` (`src/server/project-process-env.ts`),
which drops the variables that describe Kanna rather than the project. Today that
is `NODE_ENV`: the pm2 deploy used to run Kanna with `NODE_ENV=production`, every
spawn spread `process.env`, and so every project opened in Kanna ran its tests
against React's production bundle (`act(...) is not supported in production
builds of React`). Kanna's own suite patched itself in #127 and the leak kept
resurfacing everywhere else.

A new project-facing spawn goes through `projectProcessEnv`. A spawn that runs
Kanna's own code (the CLI supervisor, the self-updaters, plugin builds, git
plumbing) keeps `process.env`. The server's `Bun.serve` mode comes from
`KANNA_RUNTIME_PROFILE`, never from Bun's `NODE_ENV` default, so the deployment
needs no `NODE_ENV` at all. `adr-20260927-project-process-env-node-env`.

## A queued message carries the whole dispatch, and the builder must not enumerate it

`buildEnqueueMessageResult` (`event-store-write-ops.ts`) owns exactly three
things — the generated `id`, `createdAt`, and a defensive copy of
`attachments`. Everything else on `QueuedChatMessage` is the caller's dispatch
metadata and must survive **verbatim**, so the builder **spreads**
`...message`. It used to list the fields by hand, which made every addition to
`QueuedChatMessage` a silent data-loss bug: an omitted optional property in an
object literal is not a type error, so nothing failed to compile and nothing
failed at runtime — the field simply vanished.

`cronRun` was lost exactly that way, and the queue is the only place it could
be lost: the tag is the sole link between a fired cron run and the turn that
answers it (`fireCronJob` → `enqueueMessage` → dequeue → `ActiveTurn.cronRun`
→ `store.onTurnTerminal` → `cron_run_outcome`). With no tag, **every cron run
finished unattributed and stayed `running` forever**, so each later tick either
orphan-healed it (`errorCode: "orphaned"`) or skipped it as
`previous_run_active` — and on the inline path each orphan-then-restart ran
`clearChatContext`, killing and respawning that chat's claude process every
cycle. The tell in a live log is the total absence of `cron_run_outcome
{ok: true}` while `turn_finished` events are present.

**Do not re-enumerate the shape here**, and note that the cron fire suite fakes
`enqueueMessage` and hand-preserves the tag — it is *more* faithful than
production was, which is why it stayed green. The round-trip is pinned against
the real `EventStore` in `event-store.test.ts`.

## A session in use is never torn down — `startingTurns` is part of "in use"

A turn registers its `ActiveTurn` only **after** the provider session spawns
(`claude-turn-starter.ts`), so for the whole boot window `startingTurns` is the
only signal that a chat is live. All three teardown gates — `enforceClaudeSessionBudget`
(LRU eviction), `isClaudeSessionIdle` (idle reaper), and `clearClaudeSessionContext`
(`/clear` and inline cron fire) — now delegate to **`isSessionInUse`**
(`claude-session-state-queries.ts`), the single predicate that covers all seven
in-use conditions (activeTurns, startingTurns, pendingTools, pendingPromptSeqs,
hasLiveWorkflow, hasPendingBackgroundTask, selfWakeActive). The eviction case
is the sharpest: a **warm** session reused for a follow-up still carries the
*previous* turn's `lastUsedAt`, so it sorts **first** in LRU — without the
`startingTurns` guard the prime eviction victim is the chat the user has just
come back to. `clearClaudeSessionContext` needs it because inline cron
re-checks `isChatBusy` and then awaits twice before calling it, so a turn can
legitimately start inside that window.

### A turn is settled by the session that OWNS it, not the one that is resident

`closeClaudeSession` deletes the `claudeSessions` entry **first**. So by the
time `runClaudeSession`'s `finally` unwinds, `claudeSessions.get(chatId) ===
session` is false for any teardown initiated anywhere but the runner — and
gating the fail-close on that residency check skipped it entirely:
`recordTurnFailed`, `activeTurns.delete` and `pendingTools.discard` never ran.
The result was a **ghost `ActiveTurn`**: a turn that never ended, a chat busy
forever, and no terminal event for any observer — including the cron outcome
hook.

`ActiveTurn.sessionId` binds a turn to the session it runs on, and the `finally`
now splits its guards by what each one actually owns:

- **map delete + OAuth release** — residency (`isCurrentSession`), unchanged.
- **settling the turn** — ownership (`active.sessionId === session.id`). A turn
  that declares no session falls back to the residency rule, so a missing
  binding can never leave a turn unsettled.
- **`pendingTools.discard`** — skipped only when a *successor* session is
  resident, which owns its own parked requests.

A superseding session's bookkeeping is still left strictly alone: wiping it
leaves its stream running headless (no isError branch fires → `sessionToken`
never cleared → the next turn loops on the same too-large `--resume` context).

## Queued messages are released on commit, not on dequeue

A queued message is a chat's only durable "start this once idle" trigger. For a
user it is a convenience; for an autonomous loop the wake **is** the queued
message, so losing one strands a still-armed loop with nothing left to wake it.

`dequeueAndStartQueuedMessage` therefore no longer removes the message up
front. It passes `StartTurnForChatArgs.onTurnRecorded` — invoked the moment
`recordTurnStarted` makes the turn replayable from the event log — and the
removal happens there. `runBuiltinCommand` takes the same callback so `/clear`
releases after the context wipe and `/compact` at its turn record. **Do not
move the release earlier**: removing it before the turn is durable is exactly
the bug (chat c87ab0ad, 2026-08-13 — pm2 restarted the server 150 ms after the
prompt was appended and before `recordTurnStarted`; the loop stayed armed, its
queue was empty, and it sat dead for 2.5 h until the user typed "Resume").

`recoverQueuedMessages` (`queued-message-recovery.ts`, called from
`server.ts` boot, detached) is the other half: nothing on boot ever drained the
queue — it was drained only by live events — so a surviving message would still
sit forever. Recovery is best-effort and sequential; a chat that refuses to
start is logged and skipped, never fatal to boot.

Replay is idempotent via `isPromptAlreadyAppended`: a turn that appended its
`user_prompt` and then died leaves that entry trailing, so the restart passes
`appendUserPrompt: false`. Identity is the durable `autoContinue.scheduleId`
when present, else exact content, and only against the TRAILING entry — in
steady state that is a `result`, never the prompt about to run.

The check is gated behind `{ replay: true }`, which ONLY `recoverQueuedMessages`
passes. Reading the transcript costs a full load plus a deep clone, and replay
is the only path that can hit a stale prompt — so the steady-state drain never
pays for it. Keep it that way: dropping the gate puts a MB-scale read on every
queued send.

Residual window (accepted): a crash between `recordTurnStarted` and the spawn
still loses the wake. That is two adjacent store writes, down from the whole
spawn — which on a slow MCP boot was seconds.

The loop-specific half of this story — `recoverArmedLoopWakes` (the wake that
died WITH the server), `handleFailedLoopTurn` (the wake lost while the server
kept running), the `loop_armed`/`loop_disarmed` tombstone that makes a disarm
visible and `resume_loop` possible, and the un-armed delivery prompt that names
the plan absolutely or names nothing — is in
`.claude/skills/kanna-loop/SKILL.md`.

See `adr-20260813-queued-message-dequeue-on-commit`.

## Transcript memory is bounded by bytes, and loaded lazily

Transcript JSONL is never compacted, so a chat's transcript has no size limit
(measured on one install: 379 MB across 152 chats, largest 13.7 MB). Two
consequences, both fixed — and both easy to reintroduce.

**`TranscriptCache` budgets bytes, not chats.** `maxChats = 4` was never a
memory bound: MEASURED, the four largest transcripts on that install cost
**220 MB RSS** (~4.7x their 47 MB of source text, parsed to JS objects). The
cache now enforces `maxBytes` (default 24 MiB of SOURCE bytes ≈ 110 MB RSS)
alongside the chat cap, and always retains the most recent entry so a single
oversized transcript degrades to a re-read instead of thrashing. `set()` takes
the source size — `loadTranscriptWithBytes` hands it over for free — and falls
back to `estimateTranscriptBytes` when a caller has no cheap size. **A count
cap over unbounded-size items is not a bound**; do not swap back.

**`startTurnForChat` no longer loads the transcript per turn.**
`store.getMessages` loads the whole file AND deep-clones it — tens of MB of
heap on a big chat, every turn, pinning that chat in the LRU. It is now behind
`loadExistingMessages`, a thunk. The title check short-circuits on
`chat.title === "New Chat"` and `!chat.hasMessages` first, so an established
chat never triggers the load; the primer thunk runs only when a primer is
actually built. Adding an unconditional `deps.store.getMessages(...)` back to
this path silently restores the whole cost.

`state.subagentRunsByChatId` is now capped at `MAX_SUBAGENT_RUNS_PER_CHAT`
(200) settled runs per chat — oldest settled runs are evicted on each terminal
event (`applySubagentEvent`, `event-store-subagent.ts`); running runs are never
evicted. The `entries[]` array inside each retained snapshot is capped at
`MAX_SUBAGENT_ENTRIES_PER_RUN` (2000) — oldest entries are spliced out when the
cap is exceeded, keeping the most recent interactions in memory.
`seenMessageIdsByChatId` (dedup gate in `EventStore`) is capped at
`MAX_SEEN_MESSAGE_IDS` (2000) per chat via FIFO eviction — oldest entries
dropped first using Set insertion order. Safe because Claude API always generates
fresh `messageId`s per response; historical ids that age out will never repeat.
Without the cap, a long-running server accumulates one entry per message forever.
`state.autoContinueEventsByChatId` is evicted only by whole-chat delete, but its
dominant contributors are now bounded — see **Cron run-event retention** below.
`compactLoopWakeEvents` (`auto-continue/compact-loop-wakes.ts`) also trims
superseded `loop_armed` events: once a later `loop_armed` or `loop_disarmed`
arrives, all prior loop-state events (`loop_armed`, `loop_disarmed`,
`loop_run_outcome`) carry no weight in any live read and are dropped. When the
loop is currently disarmed every loop-state event is dropped. MEASURED before
this fix: 285 KB for one long loop chat, 91% of it the same rendered loop prompt
re-embedded on every wake by `deliverSubagentToMain`.

## Live blocks — the model's output while it is being generated (`chat.live`)

The SDK emits one `assistant` message per COMPLETED content block, so without
partial messages a long thinking phase, a long reply, or a 20 KB `Write` input
showed nothing but "Running..." until it finished — chat `071d8b8f` sat 86 s on
one turn and the user read it as a hung session. A main-chat Claude session now
runs with `includePartialMessages: true`; the harness folds `stream_event`
frames into ONE `LiveBlock` (`src/shared/live-block.ts`: text, thinking, or a
tool call with its target and input size) and `LiveTurnIndicator` renders it in
place of `ProcessingMessage`. ADR `adr-20261008-live-block-streaming`.

- **A live block is never a transcript entry.** It rides its own `chat.live`
  `WsEvent`, pushed straight to the chat's subscribers by `pushLiveBlock`
  (`ws-router-broadcast.ts`). Not the chat-state broadcast (it rebuilds sidebar
  and meta every pass) and not the `ChatOpLog` ring (512 ops — per-token ops
  would evict real ones and force resyncs). Persisting deltas would also bloat
  the transcript the history primer replays.
- **`stream_event` and `system/thinking_tokens` are consumed BEFORE the
  `session_token` yield.** The harness yields a token for every message carrying
  `session_id` and the runner broadcasts the chat on each, so letting either
  through is a full chat broadcast per token. Do NOT dedupe tokens instead: the
  runner skips persisting while `cancelledResultPending > 0` and relies on the
  next message re-yielding the token to persist it then.
- **Thinking text needs `--thinking-display summarized`,** passed through
  `extraArgs`. The model's default display is omitted, so thinking arrived with
  empty text and the normalizer dropped it. The SDK's `thinking` option is not
  used because it also forces `--thinking adaptive`.
- **The hand-off between overlay and entry is ordered on both sides.** The
  client clears the overlay in the same handler that applies the `chat.ops`
  carrying the completed entry (`opsSettleLiveBlock`), so React renders both in
  one pass. `LiveBlockHub` (`live-block-throttle.ts`) defers its own clear by one
  100 ms interval and holds the next block until then, so a new block cannot
  overtake the previous block's entry and get wiped by it. Sending the clear
  immediately makes every block blink back to "Running...".
- **Subagent sessions do not request partial messages** (`streamLiveBlocks` is
  set only by `spawnClaudeTurn`), and frames with a non-null
  `parent_tool_use_id` are ignored.
- **The text block is revealed client-side as a typewriter; the snapshot stays
  the only source of truth** (`live-typewriter.ts`, `useLiveTypewriter.ts`,
  `LiveText` in `LiveTurnIndicator.tsx`). The server still sends cumulative
  text every 100 ms; the client shows a prefix of the latest snapshot, advanced
  by `TimerPort.requestAnimationFrame` at `max(45 graphemes/s, backlog / 220 ms)`
  with a 50 ms per-frame cap and a fractional carry, and schedules no frame once
  caught up. The prefix is counted in `Intl.Segmenter` graphemes, re-segmented
  from the whole snapshot on every update, so a Vietnamese diacritic or a ZWJ
  emoji is never half drawn; a trailing grapheme that ends in a ZWJ or a high
  surrogate is withheld until the next snapshot completes it. A snapshot that
  does not extend the previous one restarts at 0, except a `boundLiveText` tail
  slice (leading `…`), which jumps to the end. The rest of the word being typed
  is rendered after the caret as `aria-hidden` transparent text so the browser
  wraps the whole word before it is typed. The revealed source is split into
  paragraphs on blank lines (fence-aware). Blank lines stay attached to the
  preceding paragraph rather than being dropped, because the settled renderer
  (`$convertFromMarkdownString` with `shouldPreserveNewLines`) turns each blank
  line into an empty margin-bearing paragraph, and dropping them made the overlay
  shorter than the entry it snaps to; the line still being typed is never
  attached. Finished paragraphs are `React.memo`
  children keyed by index with the source as the only prop, so only the trailing
  paragraph re-renders per frame, after its odd backtick and `**` are closed. The
  caret is injected by `renderMarkdownWithCaret` (`renderMessage.tsx`) at the last
  Lexical `TextNode` of the parsed document, never as a sentinel character in the
  markdown source: a private-use character beside `_` or a backtick breaks
  Lexical's delimiter parsing and leaks into code. Fenced code is not typed: when
  the reveal enters a fence it jumps to the fence's end in the current snapshot
  (past the closing line if present, else the snapshot end), so a code block
  updates at snapshot cadence. `HighlightedCode` restarts Shiki on every `source`
  change, and per-frame changes would keep highlighting from ever landing. A
  fence shows no caret. Under `prefers-reduced-motion` each
  snapshot is shown in full with a steady caret. The hand-off above is untouched:
  the completed entry replaces the overlay in one pass and snaps to the final
  text, with no finishing animation. `.kanna-live-caret` is separate from
  `.kanna-typewriter-cursor`, which belongs to the empty state.

## Compaction is the Claude Code CLI's job (KANNA_PROACTIVE_COMPACT)

**Kanna's own proactive `/compact` injection is OFF by default, deliberately.**
`isProactiveCompactEnabled` (`claude-send-command.ts`) gates
`shouldInjectProactiveCompact` on `KANNA_PROACTIVE_COMPACT=enabled`; anything
else stands aside and lets the CLI compact.

**The feature was built on a premise that has expired.** #116 introduced it
because "the SDK `query()` driver spawns a fresh claude subprocess per turn and
never enters the CLI's REPL main loop, so the CLI's built-in auto-compact never
fires by itself". It fires now: chat `ecaf0304` compacted at 167,418 tokens with
`compact_metadata.trigger: "auto"`, and #1083 measured 19 auto-boundaries across
4 chats. `Settings.autoCompactEnabled` defaults to on, Kanna passes
`settingSources: ["user", "project", "local"]` and sets no compaction setting of
its own, so the CLI's compactor is what actually runs.

Two compactors racing is worse than one: Kanna's threshold
(`effective - 13k`) is *lower* than the CLI's, so it would always win and the
CLI's would never be reached. The switch exists so a user who sets
`autoCompactEnabled: false` in their CLI settings can restore Kanna's.

**A session probe was tried and reverted.** `query.getContextUsage({detail:
"summary"})` returns `isAutoCompactEnabled` + `autoCompactThreshold`, which
would make the gate self-verifying. It cannot work here:
`shouldInjectProactiveCompact` runs inside `sendCommand` **before**
`startTurnForChat` spawns the session, so on a cold chat — every server restart,
which is exactly the `--resume`-a-huge-transcript case #116 was built for —
there is no session to ask. Making it work needs the answer persisted per chat;
that is more machinery than an env switch buys.

**The proactive-compact trigger reads the TAIL, not the transcript.**
`shouldInjectProactiveCompact` runs on every send and needs only the newest
`context_window_updated` / `compact_boundary`; it used to get them from
`store.getMessages`. It now calls `EventStore.getLatestContextWindowUsage`
(`getLatestChatContextWindowUsage` in `event-store-messages.adapter.ts`), which
walks backwards over `readTranscriptTail` windows. Three invariants, each of
which cost a measured regression to find:

- **The scan is TRI-STATE** (`scanLatestContextWindowUsage` in
  `proactive-compact.ts`). `found: false` (nothing decisive in this window) is
  not `found: true, usage: null` (a `compact_boundary` — conclusive). Collapsing
  them makes every chat past a compact widen to BOF on every send, forever.
- **Windows do not overlap.** Each round passes `endOffset = tail.lineOffsets[0]`
  so no byte is read twice. Re-widening from EOF instead re-parses everything
  already seen: measured 644 ms / 791 MB versus the full load's 216 ms / 291 MB
  — slower and heavier than the code it replaced.
- **`USAGE_SCAN_MAX_LOOKBACK_BYTES` (8 MiB) bounds the walk.** MEASURED: 241 of
  264 transcripts contain NO usage marker at all (imported sessions, and the PTY
  sessions Kanna used to run, never emit one), so "scan to BOF" is the common path, not the tail case. A marker
  further back than one turn cannot describe the current context window anyway.

`SendCommandStore.getLatestContextWindowUsage` is **optional by design** and must
be resolved with an explicit `if`, never `??` — `null` is a meaningful, common
answer, so coalescing falls straight back into the full load on exactly the
chats this protects. Optional because the agent-suite store fakes are injected
as `store as never`: a required member typechecks and then fails at runtime,
which is the regression `adr-20260813-transcript-memory-budget` records as
"tried and reverted". See `adr-20260819-context-window-usage-tail-read`.

## Background Task Keep-Alive (Bash + Agent + Workflow — KANNA_CLAUDE_BACKGROUND_TASK_MAX_MS)

Claude-Code background tasks (`Bash(run_in_background: true)`, background
`Agent`/Task-tool runs, workflows) run as children of the claude process. If
the idle reaper (`isClaudeSessionIdle`) fires while one is in flight, the
child dies with the process — silently, since a reap is not an error (this
killed a mid-flight background Agent one second after its commit; see
`adr-20260722-background-agent-keepalive` and, for the original Bash-only fix,
`adr-20260604-adr-20260604-pty-background-task-keepalive` — the doubled prefix
is the real filename, a `c3x add adr` defect, not a typo here).

- **Guard.** `session.isHoldingWork(now)` mirrors `hasLiveWorkflow`:
  consulted by both `isClaudeSessionIdle` and `enforceClaudeSessionBudget`, it
  holds the session warm while the task set is non-empty. Whether the deadline
  is consulted at all depends on the signal — see **Level-sourced** below.
- **Level-sourced (SDK) — the deadline does not apply**
  (`adr-20260808-background-task-level-signal-authoritative`). The first
  `background_tasks_changed` snapshot calls `session.applyLevelSnapshot(...)`,
  which sets the sticky level-sourced flag. From that point SET MEMBERSHIP is
  authoritative: `session.isHoldingWork(now)` is true for any non-empty set
  and `session.guardExpired(now)` is always false, so the wake ladder is
  unreachable. This is what the SDK prescribes (`sdk.d.ts`
  `SDKBackgroundTasksChangedMessage`). Required because *silence is not death*:
  a `vite dev` server prints its banner and goes quiet for hours — in chat
  1ed924dd the task's output file last grew at 12:45:04 and the watchdog woke
  the user at 13:14:39, so an output-growth probe would have fired too. The
  flag is sticky across an emptied set but starts `false` at every spawn,
  matching the SDK's per-process reset rule. The launch regex must NEVER call
  `applyLevelSnapshot` — it is a fallback, not the level signal. Note the two
  predicates therefore no longer partition `size > 0`.
- **Primary signal.** The SDK's `system/background_tasks_changed`
  LEVEL event — the full set of live background tasks after every membership
  change, REPLACE semantics (a missed edge bookend can never wedge a stale
  set). Normalized to a hidden `status` entry carrying
  `backgroundTaskIdsSnapshot`; the runner swaps `session.backgroundTaskIds`
  for each snapshot. `in_process_teammate` tasks are filtered (long-lived by
  design; claude-code gh-30008 excludes them from its own wait loop too).
  `system/task_notification` remains the per-task edge clear.
- **Fallback detection.** The stream consumer parses each `tool_result`
  (`backgroundTaskIdsFromToolResult`) for BashTool's
  `Command running in background with ID: <id>` line AND AgentTool's
  `Async agent launched successfully… agentId: <id>` launch text (marker-gated
  so incidental "agentId:" strings never arm). It is the version-skew fallback
  for a CLI that sends no `background_tasks_changed`: it arms the guard but never
  calls `session.applyLevelSnapshot(...)`, so the guard stays **deadline-based**
  until a real snapshot arrives. Duplicate arms vs the level signal are harmless
  (Set).
- **Stream activity bump.** The runner refreshes `session.lastUsedAt` on every
  appended transcript entry, so task-notification self-wake turns (which start
  no Kanna turn) never count as idle — mirrors claude-code's own invariant
  that the idle timer starts only after its run loop exits.
- **Clear.** Pending ids are removed ONLY by settle edges and level snapshots.
  A real user `chat.send` (NOT auto-continue / agent wakes, which bypass `send`)
  **re-arms** the guard — it refreshes the deadline and restores the wake budget,
  it does not release anything (`claude-send-command.ts`). Clearing on send is
  what let the reaper silently kill a healthy long-running watch ~10 min after
  any user message; `adr-20260801` inverted it.
- **Bound.** `KANNA_CLAUDE_BACKGROUND_TASK_MAX_MS` (default 1_800_000 = 30 min,
  via `positiveIntegerFromEnv`; the former name `KANNA_PTY_BACKGROUND_TASK_MAX_MS`
  is still read when the new one is unset) caps how long a hung/never-completing
  task can pin a process — but ONLY for a session with no level signal (old CLI /
  pre-first-snapshot). There is deliberately no ceiling on a level-sourced
  session: the SDK imposes no time limit on background tasks either, so a task
  in the set holds its session until the SDK retracts it. The residual risk is a
  live stream whose upstream task list wedges, which pins that session until
  server restart; a crashed transport still releases via the runner's `finally`.
- **Self-wake status + task list UI
  (adr-20260802-background-selfwake-status-ui).** Task-notification self-wake
  turns stream entries with NO ActiveTurn, so the turn-event fold alone left
  the chat "idle" while the model worked (observed: 70+ min of post-turn work
  with a static composer arrow). `ClaudeSessionState.selfWakeActive` tracks
  the live wake window — armed by the runner on model-activity entries
  (assistant_text / assistant_thinking / tool_call / tool_result) with no
  active turn, disarmed on the wake turn's `result`, dead with the session —
  and `getActiveStatuses` overlays it as status `"running"` (pure live
  overlay; event-sourced turn timings untouched). `cancelChat` gained a
  no-active-turn branch: when `selfWakeActive`, it appends `interrupted`,
  interrupts the session stream in-band,
  and suppresses the interrupt tail result via `cancelledResultPending`.
  The guard set was upgraded `backgroundTaskIds: Set<string>` →
  `backgroundTasks: Map<string, SessionBackgroundTask>` (single source;
  `taskType`/`description` from the `background_tasks_changed` snapshot —
  the normalizer now emits `backgroundTasksSnapshot` meta alongside the ids —
  with the launch-regex fallback enriched from the launching tool_call's
  description via `session.recentToolDescriptions`). Per-chat task lists
  flow `getBackgroundTasksByChatId` → `deriveChatSnapshot` →
  `ChatRuntime.backgroundTasks` → `BackgroundTasksSection` (chat footer,
  /tasks-style: type icon + description + id + live elapsed).
  `deriveChatSnapshot` also appends every running top-level Kanna subagent run (`subagentBackgroundTasks`, taskType `subagent`) so a `delegate_subagent({run_in_background: true})` run is visible in the footer after the turn ends; the sidebar row shows the agent count instead of the age via `formatBackgroundWork`. Neither touches `isChatBusy` or `getActiveStatuses` — a background Kanna run must not flip the composer to Stop. Budget
  eviction skips `selfWakeActive` sessions; the idle reaper still keys on
  `lastUsedAt`, so a wedged flag cannot pin a session forever.

## Workflow Status Panel (disk-watch, read-only)

Surfaces Claude Code's native `Workflow` tool (dynamic multi-agent
orchestration) in the UI: a per-chat panel listing every run with live status +
drill-in progress, plus an inline transcript card on the launch. **Read-only.**
Since the move to notification-driven loop orchestration the
model handles workflow harvest via `delegate_subagent({run_in_background: true})`
status-check spawns; this panel *displays* the workflow.

**Registration.** `AgentCoordinator.maybeRegisterSdkWorkflowsDir` derives
`<projectDir>/<session-uuid>/workflows` (via `computeWorkflowsDir`) from the
SDK's first `session_token` HarnessEvent and calls `workflowRegistry.register`
once per session; `closeClaudeSession` unregisters.

**Why disk-watch, not the event stream.** The panel was built when the PTY
driver — whose only event source was the on-disk transcript JSONL, which carries
the `Workflow` tool_use launch but **no** `task_started`/`task_updated`/
`tool_progress` lifecycle lines — had to show workflow progress too. Claude
writes a complete, self-updating sidecar per run, so the disk-watch read-model
stayed when the PTY driver was removed:
`~/.claude/projects/<encoded-cwd>/<session-uuid>/workflows/wf_<runId>.json`
(`runId`, `taskId`, `workflowName`, `status`, `agentCount`, `totalTokens`,
`phases[]`, `workflowProgress[]` per-agent tree, `result`/`error`/`summary`).
`taskId` joins a run to the transcript's `Task ID: X` launch text.

**Independent read-model.** The watcher feeds a sibling
read-model, never the transcript/turn event pipeline (same spirit as reading
subagent files). See `adr-20260603-workflow-disk-watch-read-model`.

- **Adapter** `src/server/workflow-watch-io.adapter.ts` — the only IO; lists +
  reads `wf_*.json`, `fs.watch` with ~250 ms debounce, and **re-arms via the
  nearest existing ancestor** when `workflows/` doesn't exist yet (Claude
  creates it lazily on the first Workflow call, after registration).
- **Registry** `src/server/workflow-registry.ts` — per-chat watch + parse
  (one defensive choke-point `parseWorkflowRunFile`) + `snapshot()` (light,
  heavy fields stripped) + `getRun()` (full) + `subscribe()`. IO injected
  (side-effect seal). **Re-run masking
  (no ADR — the decision is recorded only here and in `workflow-registry.ts`):**
  Claude embeds the `runId` in the
  persisted workflow script filename, so a fix-and-relaunch via `scriptPath`
  reuses the same `runId` (new `taskId`) and pours agents into the same live
  dir WITHOUT rewriting the prior sidecar. A no-op **crash sidecar**
  (`isStaleCrashSidecar`: `status=failed && agentCount===0 && agents:[]`) is
  therefore the ONLY terminal status `snapshot()`/`getRun()` will override —
  and only when the live `journal.jsonl` proves a re-run (≥1 agent), surfacing
  a synthetic `running` row that carries the crash sidecar's `taskId`/
  `workflowName` so the launch card binds. The discriminator is content-based
  (agentCount 0 vs non-empty journal), NOT mtime ordering (clock-racy, fails
  under concurrency). `completed`/`killed`/`failed-with-agents` sidecars win
  unconditionally; a true crash (empty journal) stays `failed`. Re-run over a
  completed/killed run is out of scope (the synthetic row has no `taskId` from
  disk, and reading the transcript taskId would couple this read-model to the
  transcript pipeline it is deliberately independent of).
- **Transport** WS topic `{type:"workflows", chatId}` → `workflowRunsUpdated`
  snapshot push; `workflows.getRun` command for the heavy drill-in payload.
- **Client** `workflowsStore` (stable `EMPTY` ref), `WorkflowsSection` panel
  (mirrors `SubagentsSection`), `WorkflowMessage` transcript card (live pill
  joined by `taskId` once `chatId` is threaded through the transcript rows).

Out of scope: global cross-chat view, stop/relaunch.
