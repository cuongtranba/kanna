# Claude PTY Driver — Design

**Date:** 2026-05-14
**Status:** Draft v2 — codex adversarial review applied, awaiting user review
**Author:** session-collaborative
**Related code:** `src/server/agent.ts`, `src/server/terminal-manager.ts`, `src/server/harness-types.ts`, `src/server/kanna-mcp.ts`

## Motivation

Anthropic is moving the `@anthropic-ai/claude-agent-sdk` and `claude -p` (print mode) to API-metered pricing. Kanna currently uses `query()` from the SDK, which means existing Pro/Max subscribers will be billed per token instead of their flat subscription rate.

Only the interactive `claude` CLI session (running with OAuth keychain auth, no `ANTHROPIC_API_KEY`) continues to use subscription billing.

This spec describes adding a second driver behind Kanna's existing `ClaudeSessionHandle` interface that spawns `claude` interactively over a pseudo-terminal (PTY), reads the structured session transcript from disk, and exposes the same event stream the SDK driver produces.

## Goals

- Drop-in replacement for the SDK driver. Same `ClaudeSessionHandle` contract.
- Preserve Pro/Max subscription billing for users on those plans.
- Maintain feature parity with current SDK-driven flow (model switching, plan mode, MCP tools, subagents, attachments, slash commands, resume, fork).
- Lazy lifecycle: idle sessions stop, focused chats spawn or wake.

## Non-goals

- Replace the SDK driver. Both drivers live behind a feature flag (`KANNA_CLAUDE_DRIVER=sdk|pty`, default `sdk`).
- 100% byte-identical event streams. Some details (precise spinner state, partial-token streaming cadence) may differ.
- Multi-tenant subscription sharing. Designed for single-user-on-own-machine, matching Anthropic Max ToS.
- Codex provider port — a separate spec if needed.

## Architecture

### Driver selection

```
ws-router → AgentCoordinator
              │
              ▼
       startClaudeSession (injected fn, returns ClaudeSessionHandle)
              │
       ┌──────┴──────────────┐
       │                     │
  startClaudeSDK (existing)  startClaudeSessionPTY (new)
                                   │
                            ┌──────┼────────────────────┐
                            ▼      ▼                    ▼
                    Bun.Terminal   JSONL tail      Slash/control
                    (input + TTY)  (~/.claude/...) (model, perm, exit)
                            │      │                    │
                            └──────┴────────────────────┘
                                       claude process
                                       (OAuth, --session-id, --dangerously-skip-permissions)
```

### Module layout (new files)

```
src/server/claude-pty/
  ├── driver.ts            # startClaudeSessionPTY → ClaudeSessionHandle
  ├── pty-process.ts       # Bun.Terminal + Bun.spawn wrapper
  ├── jsonl-reader.ts      # tail w/ (byteOffset,lastEventId) bookmark + dedupe
  ├── jsonl-to-event.ts    # JSONL line → HarnessEvent
  ├── frame-parser.ts      # minimal — only slash-cmd ACK detection
  ├── slash-commands.ts    # /model, /permissions, /exit
  ├── auth.ts              # verify OAuth keychain, reject ANTHROPIC_API_KEY
  ├── runtime-dir.ts       # per-session 0700 dir, cleanup on COOLING
  ├── uds-server.ts        # Unix-domain socket: helper + hook + MCP callbacks
  ├── api-key-helper.ts    # writes helper script (FD-passed token, POST over UDS)
  ├── pretooluse-hook.ts   # writes hook script for permission gate
  ├── permission-gate.ts   # per-chat unsafe state + deny-list policy
  ├── tool-callback.ts     # durable ask_user_question/exit_plan_mode protocol
  ├── lifecycle.ts         # ClaudeSessionLifecycle (lazy spawn, idle stop, LRU)
  └── *.test.ts
```

`AgentCoordinator` and `ws-router` are unchanged. Only the injected factory differs.

### Output path: JSONL transcript tail (primary)

Claude Code writes every event for an interactive session to:

```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
```

Each line is a JSON object. Types:

- `{ type: "system", subtype: "init", session_id, model, ... }`
- `{ type: "user", message: { content: [...] } }`
- `{ type: "assistant", message: { content: [{type:"text"|"tool_use"|"thinking"}] } }`
- `{ type: "tool_result", tool_use_id, content }`

We control `<session-uuid>` via `--session-id <uuid>`, so we know the exact file path before spawning.

### Tail semantics (cold-wake-safe)

Naive "watch and read from EOF" is wrong: cold-resume must observe the new `system.init` line but must **not** re-emit historical messages already persisted in `EventStore`. Naive "read from byte 0" floods the UI with duplicates.

Contract:

1. **Per-session bookmark.** `EventStore` keeps a record per `sessionId` containing `{ filePath, byteOffset, lastEventId, lastEventHash }`. Updated transactionally after every successful emit.
2. **Event ID source.** Each JSONL line carries a `uuid` / `message.id` (CLI standard). For lines lacking an ID (rare — `system` subtypes), we derive `lineHash = sha256(rawBytes)`. The pair `(byteOffset, eventId|lineHash)` is the dedupe key.
3. **Spawn-then-tail order.** Before `Bun.spawn`, we record the bookmark we plan to start from (offset + lastEventId from prior session or `null` for new). After spawn, the reader stats the file:
   - If file does not exist yet → poll up to `KANNA_PTY_WARM_TIMEOUT_MS` for creation.
   - If size < `byteOffset` → file was truncated/rotated. Re-scan from byte 0 in dedupe mode (emit only events whose ID is not in `EventStore`).
   - Otherwise → seek to `byteOffset`, read forward.
4. **Init event handling.** On every spawn we expect exactly one `system.init`. The reader treats it as a control event (updates `accountInfo`, `sessionToken`) without producing a duplicate transcript entry — its idempotency is checked by `sessionId + spawnEpoch` (not by ID, since the CLI may regenerate it on `--resume`).
5. **Atomic emit + bookmark advance.** Each event is appended to `EventStore` and the bookmark advanced in the same transaction. Crash between emit and advance is handled by the dedupe pass on next start.
6. **Fork handling.** `--fork-session` creates a new JSONL with a new UUID. New bookmark row created; old row archived but kept for back-reference. `EventStore.forkChat` (already exists, see commit `7f76ac9`) is extended to copy bookmark state.
7. **Reader lifetime.** Lives for the whole `IDLE+ACTIVE` window. Continues watching during prompt sends. Tears down on `COOLING`, persisting final bookmark before exit.
8. **Race: spawn writes init before watcher registers.** Reader pre-registers the watcher and pre-stats the file before sending the first PTY byte. If the file appears between pre-stat and watch registration, the next read covers it.
9. **Tests.** `jsonl-tail.test.ts` covers: cold wake (no duplicates), spawn from empty bookmark, mid-stream crash recovery, file truncation, file rotation, init replay on resume, fork copy, watcher race.

Each parsed line maps to an existing `HarnessEvent` (`transcript` / `session_token` / `rate_limit`) and is yielded into the `AsyncIterable<HarnessEvent>` consumed by `AgentCoordinator`.

### PTY role: input + TTY presence

The PTY is used only for:

1. Holding a real TTY open so `claude` runs in interactive mode and uses subscription billing.
2. Sending user prompts (`proc.write(text + "\r")`).
3. Sending slash commands (`/model`, `/permissions`, `/exit`).
4. Sending Esc to interrupt.

Output bytes from the PTY are fed to a `@xterm/headless` instance for minimal slash-command-ACK detection only. We do **not** scrape assistant text or tool calls from the TUI — that all comes from JSONL.

### Settings file written per session

At spawn we write `.claude/settings.local.json` in the chat's working dir:

```json
{
  "tui": "default",
  "syntaxHighlightingDisabled": true,
  "showThinkingSummaries": true,
  "spinnerTipsEnabled": false,
  "showTurnDuration": false
}
```

This switches the TUI to main-screen append mode (simpler PTY parsing for ACKs) and suppresses cosmetic noise.

## Control plane

| `ClaudeSessionHandle` method | PTY action | Wait condition |
|---|---|---|
| `sendPrompt(text)` | `proc.write(text + "\r")` — relies on CLI's built-in input queue if turn in progress | new `user` line in JSONL |
| `interrupt()` | `proc.write("\x1b")` (Esc). Second Esc within 1s if still busy. | next assistant Stop in JSONL or 2s timeout |
| `setModel(m)` | `proc.write("/model " + m + "\r")` | TUI scrapes "Model:" confirmation OR next JSONL `system` event |
| `setPermissionMode(planMode)` | If toggling: restart PTY with `--permission-mode plan` / `bypassPermissions` and `--resume`. Slash flow `/permissions` is interactive and not reliably scriptable. | new session_init JSONL event |
| `getAccountInfo()` | Return cached value parsed from JSONL `system.init` at startup | n/a |
| `getSupportedCommands()` | Scrape `/help` output once at startup, cache. Static fallback list if scrape fails. | startup |
| `close()` | `proc.write("/exit\r")`, kill after 2s if still running | proc exit |

### Prompt queueing

`claude` CLI has a built-in input queue: typing while the assistant is working enqueues the next message for delivery at turn end. We rely on this — `sendPrompt` always writes immediately, no server-side queue.

Server tracks "queued" status by comparing prompt-send time against the last JSONL Stop event. UI shows a "queued" badge until the matching `user` line appears in JSONL.

### Steered messages (mid-turn)

Current SDK behavior wraps mid-turn user messages in `STEERED_MESSAGE_PREFIX`. In PTY mode the CLI's built-in queue delivers them after the current turn ends — there is no mid-turn injection. This is documented as a tradeoff; in practice the delay is sub-second to seconds depending on turn length.

### Attachments

- Text and file attachments: existing `buildPromptText` injection works unchanged.
- File paths: prefer `@path` syntax (CLI native) when path exists on disk; fall back to the existing `<kanna-attachments>` hint block.
- Image attachments: image saved to chat dir by Kanna (already happens), referenced via `@path`. No clipboard paste over PTY.

## Special-case tools: `ask_user_question` and `exit_plan_mode`

These two tools are intercepted in the SDK driver via `canUseTool`, which routes them through `HarnessToolRequest` to the Kanna UI for user response.

`canUseTool` does not exist in interactive mode. We refactor both tools to live inside `kanna-mcp` (the MCP server Kanna already injects). The same MCP-routed implementation is used by the SDK driver — the SDK's `canUseTool` continues only to enforce the dangerous-tool deny-list (in PTY mode that role is taken by the per-chat unsafe gate; see "Permission enforcement").

### Callback protocol (durable, idempotent, fail-closed)

The MCP tool implementation does **not** simply HTTP-POST and await. The contract is:

1. **Request identity.** Generate `toolRequestId = uuidv7()` deterministically derivable from `(sessionId, toolUseId)` so identical retries dedupe. Embed `chatId`, `sessionId`, `toolUseId`, `toolName`, `arguments`, `createdAt`.
2. **Durable storage.** Persist the request to `EventStore` (same store that survives server restart) under key `pendingToolRequests[chatId][toolRequestId]` with status `pending`. The MCP tool body waits on a server-side promise keyed by `toolRequestId`.
3. **Server-side state machine.** Server promotes the request through `pending → answered | timeout | canceled | session_closed`. Each terminal transition stores the final answer or reason and resolves all waiters with that result.
4. **Timeout.** Default 600s (configurable). On timeout the request resolves with `{ error: "timeout" }`, MCP tool returns that to the model, model retries or proceeds. Timeout is **server-driven** — never depends on PTY responsiveness.
5. **Cancellation.** Server cancels the request and resolves with `{ error: "canceled" }` on: chat deleted, PTY shutdown (any state transition to COOLING), explicit user cancel from UI, server shutdown (cancellations flushed before exit).
6. **Idempotency.** If the model retries `tool_use` with the same `toolUseId`, MCP body computes the same `toolRequestId`. If a stored terminal answer exists, return it without re-prompting the UI. If `pending`, attach a new waiter to the existing promise.
7. **Reconnect / resume.** On wake from COLD, server re-emits pending requests to the UI from `EventStore` so the user sees "still waiting on this tool". The MCP-side waiter on the new PTY's `toolUseId` resolves from the same store key once the user answers (resume preserves toolUseId via `--resume`).
8. **Auth.** MCP→server callbacks go over a **Unix-domain socket** (`<runtimeDir>/kanna-mcp.sock`, mode `0600`) — not a TCP port. Per-PTY ephemeral token (32-byte random, in-memory only, rotated each spawn) bound to `(chatId, sessionId, pid)` is sent in a request header. Server validates header + accepts that connecting peer's pid via `SO_PEERCRED` (Linux) / `LOCAL_PEERCRED` (macOS).
9. **UI surface.** Pending tool requests render in the chat thread as a blocking card with cancel button. Status badge on chat row shows ⏸ until resolved.
10. **Tests.** `mcp-tool-callback.test.ts` covers: timeout, cancel-on-close, cancel-on-shutdown, idempotent retry, resume-with-pending, duplicate toolUseId.

This refactor lands behind feature flag `KANNA_MCP_TOOL_CALLBACKS=1` and is shipped **before** PTY driver phase 1 so both drivers exercise it.

## OAuth token rotation (apiKeyHelper)

SDK driver rebuilds env per `query()` call via `buildClaudeEnv(oauthToken)`. PTY process env is fixed at spawn.

Solution: write an `apiKeyHelper` script that talks to Kanna over the same Unix-domain socket used for MCP callbacks. CLI invokes the helper when it needs fresh credentials; rotation in `oauthPool` is picked up automatically without restarting the PTY.

### Security requirements (hardened)

- **No TCP, no URLs with credentials.** Helper communicates over `<runtimeDir>/kanna-mcp.sock` (mode `0600`).
- **Runtime directory layout.** Per-spawn directory `<XDG_RUNTIME_DIR or ~/.kanna/runtime>/pty/<sessionId>/`, created mode `0700`. Contains: `oauth-helper.sh` (mode `0500`, no world/group read), `settings.local.json`, `mcp-config.json`. Directory and contents wiped on session COOLING.
- **Helper body.** Reads a per-spawn bearer token from an FD inherited from the parent (Bun.spawn writes the token to a private pipe FD, helper reads `/dev/fd/<n>` once on first call and caches in memory of helper process tree). The token never appears on disk, in argv, or in env vars passed to other processes.
- **POST not GET.** Helper does `POST /internal/oauth-token` over UDS; chat/session IDs in body. Server logs are scrubbed of the token by middleware.
- **Peer verification.** Server checks `SO_PEERCRED` / `LOCAL_PEERCRED`. Connecting PID must match `pidof <claude>` (the spawned process tree). Reject otherwise.
- **Short lifetime.** Token is bound to one PTY spawn. New spawn → new token. Server invalidates the previous token immediately. Tokens are not persisted.
- **Revocation.** On session COOLING, server unbinds the token, removes the socket entry for that session, deletes the runtime directory.
- **macOS keychain fallback.** If UDS support is degraded on the host (e.g., very old macOS), helper falls back to **stdin-piped token** — Bun.spawn passes the token via a dedicated read-only FD on each helper invocation by re-execing the helper. No file-backed credential ever.
- **No URL credentials.** Explicit rule: never `http://...&token=...`. Static analyzer / lint test enforces this in `auth.test.ts`.

Settings injection (via the same `.claude/settings.local.json` written at spawn):

```json
{
  "apiKeyHelper": "<runtimeDir>/pty/<sessionId>/oauth-helper.sh"
}
```

The settings file itself is `0600` and lives in the per-session runtime dir, not the project tree.

## Spawn flags

Flags depend on the per-chat `unsafeAutoApprove` state (see "Permission enforcement"):

```
claude
  --session-id <uuid>                                # we generate, used to locate JSONL
  --resume <uuid>                                    # only if reattaching to existing
  --fork-session                                     # if user requested fork
  --model <model>
  --effort <low|medium|high|max>

  # safe mode (default):
  --permission-mode plan                             # blocks edits until user approves
  #   (no --dangerously-skip-permissions)
  #   PreToolUse hook (settings.local.json) intercepts every tool call → server verdict

  # unsafe opt-in mode (per-chat toggle, red banner):
  --permission-mode bypassPermissions
  --dangerously-skip-permissions
  #   PreToolUse hook still runs, applies deny-list

  --tools <comma-list>                               # CLAUDE_TOOLSET
  --add-dir <dir>...                                 # additionalDirectories
  --append-system-prompt <text>                      # Kanna-specific guidance
  --system-prompt <text>                             # ONLY for subagent (systemPromptOverride)
  --mcp-config <runtimeDir>/mcp-config.json          # kanna-mcp config (UDS endpoint)
  --settings <runtimeDir>/settings.local.json        # apiKeyHelper, hooks, tui mode
  --no-update                                        # never block on updater prompt
```

Env:

- Strip `ANTHROPIC_API_KEY` (would force API billing).
- Keep `TERM=xterm-256color`, `NO_COLOR=0` (colors needed for slash-ACK parsing).
- `KANNA_PTY_SESSION=<sessionId>` (used by helper + hook to identify themselves on UDS).
- Per-spawn bearer token passed via inherited FD (read-once pipe), **never** via env or argv. See "Security requirements" under OAuth helper.

## Permission enforcement (fail-closed)

`canUseTool` does not exist in interactive mode. `--dangerously-skip-permissions` bypasses **all** CLI permission prompts. The SDK driver currently gates tool execution via `canUseTool` (Bash, Edit, Write, MCP tools all flow through it). PTY mode loses that gate at the CLI level. Mitigation must be enforceable, not advisory.

### Boundary model

| Tool class | Gateable in PTY mode? | How |
|---|---|---|
| MCP tools (`kanna-mcp` and any user MCP server) | **Yes** | MCP server is Kanna code — server-side per-tool deny/allow policy applied before the tool body runs. Rejected calls return `{ error: "denied" }`. |
| CLI built-in tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch) | **No** at CLI level | `--dangerously-skip-permissions` short-circuits. Server can only deny **after** observation via JSONL `tool_result`. |
| Hooks (`PreToolUse` from `.claude/settings.json`) | **Yes** | Kanna writes a `PreToolUse` hook into `.claude/settings.local.json` at spawn. Hook is a small script that posts to the UDS callback endpoint with the tool name + args, awaits a server allow/deny verdict (sync), exits `0` for allow, non-zero for deny. The CLI honors hook exit codes even with `--dangerously-skip-permissions`. **This restores a real pre-execution gate for built-in tools.** Verified during phase-0 spike. |

### Per-chat opt-in unsafe gate

PTY driver does **not** automatically unlock built-in tools. The `--dangerously-skip-permissions` flag is conditional on a per-chat **unsafe** state which:

1. Defaults to `false` for every chat, regardless of `KANNA_CLAUDE_DRIVER=pty`.
2. Requires explicit user opt-in via UI ("Enable auto-approve for this chat" toggle with red destructive-action confirm dialog).
3. Is persisted per-chat in `EventStore.chatSettings.unsafeAutoApprove`.
4. Renders a permanent (non-dismissable) red banner at top of chat while active: "Auto-approve ON — tools execute without confirmation."
5. Sidebar chat row shows red dot when `unsafe=true`.

If `unsafeAutoApprove=false` (default) the PTY spawns with `--permission-mode plan` and **without** `--dangerously-skip-permissions`. Built-in tool calls trigger the CLI's normal permission prompt, which renders in the TUI. The `PreToolUse` hook intercepts those and routes the prompt to the Kanna UI via the MCP-callback channel (same protocol as `ask_user_question`).

When `unsafeAutoApprove=true`, the hook still runs and still consults the per-chat **deny-list** (Bash regex blocklist, write paths blocklist) — these are user-editable in settings. Hook returns deny → CLI aborts tool. Hook returns allow → CLI runs the tool. Auto-approve only changes the *default* when the deny-list does not match.

### Mode transitions fail closed

- Toggling `unsafeAutoApprove` from `true` → `false`: kill PTY (COOLING), respawn without skip-perms. Pending tool calls cancel with `{error:"canceled"}`.
- Toggling `false` → `true`: respawn with skip-perms. UI shows confirm dialog before respawn.
- Server crash mid-session: on restart, all chats reset to `unsafeAutoApprove=false` unless persisted true; banner re-displayed; PTY cold until user reopens.

### Tools that cannot be fully gated

Documented in user-facing docs:
- `Bash` — gateable by `PreToolUse` hook but command obfuscation (variables, eval) limits static deny-list effectiveness. Recommend worktree.
- `WebFetch`, `WebSearch` — egress; deny-list by URL pattern only.
- Long-running subprocesses started by Bash — outside scope.

### Tests

`permission-gate.test.ts` covers: opt-in default false, hook deny path, deny-list match, toggle fail-closed respawn, server-restart reset, MCP server-side deny.

## Lifecycle

Each PTY costs ~150MB RSS. We lazy-spawn and idle-stop.

### State machine (per chat)

- **COLD**: no process. Conversation history rendered from JSONL on disk plus Kanna's `EventStore`.
- **WARMING**: spawn in flight.
- **IDLE**: process running, no active turn, no queued prompts. Idle timer counting down.
- **ACTIVE**: turn in flight or queue non-empty.
- **COOLING**: `/exit` sent, awaiting proc exit. Force kill after 2s.

### Transitions

| Trigger | Transition |
|---|---|
| User focuses chat tab | COLD → WARMING (pre-spawn) |
| User navigates away within `KANNA_PTY_PREWARM_GRACE_MS` | WARMING canceled → COLD |
| `WARMING` exceeds `KANNA_PTY_WARM_TIMEOUT_MS` | WARMING → COLD (error surfaced) |
| User sends message | COLD → WARMING → ACTIVE, or IDLE → ACTIVE |
| JSONL Stop + queue empty | ACTIVE → IDLE, idle timer starts |
| Idle timer fires (`KANNA_PTY_IDLE_TIMEOUT_MS`, default 600000) | IDLE → COOLING |
| LRU cap exceeded (`KANNA_PTY_MAX_CONCURRENT`, default 5) | oldest IDLE → COOLING |
| Chat deleted | any → COOLING |
| Server shutdown | all → COOLING (parallel) |

### Wake = `--resume <stored-uuid>`

When transitioning COLD → WARMING for an existing chat, we pass `--session-id <stored-uuid>` and `--resume <stored-uuid>`. Full conversation context is restored from on-disk JSONL. Cold start cost ~1-2s.

### UI surfacing

- Sidebar chat row badge: ● active (green), ○ idle (gray), ◐ warming (spinner), unfilled = cold.
- Tooltip on cold rows: "Session paused — opens when you click."
- Settings panel: "Auto-stop idle sessions after N min" slider; "Max concurrent sessions" input.
- Banner when driver = pty: "Tools are auto-approved in PTY mode — use a worktree for risky tasks."

### `ClaudeSessionLifecycle` module

```ts
class ClaudeSessionLifecycle {
  private states: Map<string, LifecycleState>
  constructor(args: {
    spawn: (chatId: string) => Promise<ClaudeSessionHandle>
    maxConcurrent: number
    idleTimeoutMs: number
    prewarmGraceMs: number
    warmTimeoutMs: number
  })
  onFocus(chatId: string): void
  onBlur(chatId: string): void
  onPromptSent(chatId: string): void
  onTurnComplete(chatId: string): void
  getOrSpawn(chatId: string): Promise<ClaudeSessionHandle>
  shutdown(chatId: string, reason: string): Promise<void>
  // tick() called every 30s to enforce idle/LRU rules
}
```

The lifecycle wrapper is mounted between `AgentCoordinator` and the raw `startClaudeSessionPTY` factory. The SDK driver does not need it (SDK calls are stateless and cheap), but the same wrapper can be used optionally for symmetry.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `KANNA_CLAUDE_DRIVER` | `sdk` | `sdk` or `pty` |
| `KANNA_PTY_MAX_CONCURRENT` | `5` | LRU cap |
| `KANNA_PTY_IDLE_TIMEOUT_MS` | `600000` | 10 min idle → stop |
| `KANNA_PTY_PREWARM_GRACE_MS` | `2000` | Cancel pre-warm if user moves on |
| `KANNA_PTY_WARM_TIMEOUT_MS` | `30000` | Spawn timeout |
| `CLAUDE_EXECUTABLE` | (auto) | Existing — path to `claude` binary |

Also exposed in Kanna app settings UI (writes to user settings JSON).

## Testing

### Unit (no real `claude` spawn)

| Suite | Coverage |
|---|---|
| `jsonl-reader.test.ts` | tail reader: append handling, file rotation, partial line buffering |
| `jsonl-to-event.test.ts` | each JSONL type → correct `HarnessEvent` |
| `frame-parser.test.ts` | slash ACK detection (model switch, rate-limit banner) |
| `pty-process.test.ts` | mock `Bun.Terminal`, assert write sequences for each method |
| `driver.test.ts` | wire mocked PTY + mocked JSONL tail → assert `ClaudeSessionHandle` contract |
| `auth.test.ts` | env-without-key + keychain present → ok; env-with-key → throws |
| `lifecycle.test.ts` | state transitions, idle timer, LRU eviction, pre-warm cancellation |
| `api-key-helper.test.ts` | helper script generation + endpoint contract |

Fixtures: captured JSONL from a real session in `test/fixtures/claude-pty/*.jsonl`. Replayed deterministically, no Anthropic network calls.

### Integration (gated, `KANNA_PTY_E2E=1`, local only)

Spawn real `claude` in scratch dir. Send 3 prompts (text, Read tool, Bash tool). Assert event stream over WebSocket matches expected shape. Skipped in CI (no OAuth keychain).

### Regression coverage

Existing `agent.test.ts` / `ws-router.test.ts` cover coordinator-level invariants by injecting the PTY factory in place of the SDK factory.

### Render-loop check

Any new UI surface (badges, banners, settings toggle) is verified via `renderForLoopCheck` per `CLAUDE.md` to avoid React error #185.

## Risks

| Risk | Mitigation |
|---|---|
| `claude` JSONL schema changes between versions | Pin minimum `claude` version. Version-probe at spawn. Fail loud on unknown line types (log + skip line). |
| Slash command names change | Same: version pin + integration test runs on supported versions. |
| Tool auto-approval enables destructive ops | Per-chat opt-in with red banner. `PreToolUse` hook restores enforceable gate. Deny-list applies in both modes. See "Permission enforcement". |
| Anthropic clarifies ToS to disallow PTY wrapping | Feature flag stays off by default. Documented limitation. Remove if formally disallowed. |
| `--remote-control` becomes an official structured channel | Driver lives behind same `ClaudeSessionHandle` interface — swap implementation, keep contract. |
| OAuth helper exposes token via URL / readable script | Token over Unix-domain socket (mode 0600), POST body, FD-passed bearer, `SO_PEERCRED` peer check, per-spawn rotation, no on-disk credential. See "Security requirements". |
| MCP tool callback deadlock turns | Durable per-tool-request state in `EventStore`, server-driven timeout, cancel on close/shutdown/respawn, idempotent retry by deterministic request id. See "Callback protocol". |
| JSONL replay duplicates or skips events on cold wake | Per-session `(byteOffset, lastEventId)` bookmark in `EventStore`, dedupe scan on truncation/rotation, atomic emit+advance, init event treated as control not transcript. See "Tail semantics". |
| Token rotation gap between `apiKeyHelper` invocations | Helper queries token on every CLI auth refresh; oauthPool fresh-fetch happens server-side. No PTY restart needed for routine rotation. Previous bearer invalidated on each new spawn. |
| Lifecycle bugs leak PTY processes (RSS exhaustion) | LRU cap + idle timeout + server shutdown fanout + `ps`-based reaper sweep on startup. Runtime dir cleanup on COOLING. |
| Subagent feature uses `initialPrompt` + `systemPromptOverride` | Map to `--system-prompt` + send-prompt-then-exit-on-Stop. Covered by `driver.test.ts`. |
| `PreToolUse` hook does not actually fire under `--dangerously-skip-permissions` | Verified in phase-0 spike. If hook does not run, unsafe mode loses deny-list enforcement — block phase 1 until alternative gate confirmed (e.g., MCP wrap of Bash via project-level slash command). |

## Rollout

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Throwaway spike. Verify: (a) JSONL 1:1 fidelity with SDK events on 5 representative chats; (b) `PreToolUse` hook fires under `--dangerously-skip-permissions`; (c) `--mcp-config` over UDS works; (d) `Bun.spawn` FD inheritance for token passing; (e) `SO_PEERCRED`/`LOCAL_PEERCRED` available. | All five checks pass. If (b) fails: block phase 1, redesign permission gate. |
| 1a | MCP tool callback refactor (`tool-callback.ts`): `ask_user_question` + `exit_plan_mode` move to kanna-mcp with durable request protocol. Behind `KANNA_MCP_TOOL_CALLBACKS=1`. SDK driver opts in first. | `mcp-tool-callback.test.ts` green. SDK driver still passes its existing tests. |
| 1b | `claude-pty/` module: PTY spawn, UDS server, runtime-dir, auth helper, hook, JSONL tail with bookmarks, permission-gate. Feature flag `KANNA_CLAUDE_DRIVER=pty`. Default stays `sdk`. | All unit tests pass. Manual smoke: one chat works end-to-end in safe mode (default). |
| 2 | UI: driver toggle, status badges, per-chat unsafe opt-in flow with destructive-action confirm dialog, deny-list editor, lifecycle settings. | Manual QA: driver switch, unsafe toggle, deny-list match, cold→warm→active→idle→cooling cycle, server-restart resets unsafe. |
| 3 | Integration test gated by `KANNA_PTY_E2E=1`. Public docs page explaining tradeoffs, ToS caveat, single-user-only, security model. | Docs reviewed. |
| 4 | Default flip considered only after Anthropic SDK pricing announcement lands and PTY mode has ≥2 weeks soak in real use. | n/a |

## Open questions

1. **`/permissions` slash command interactivity.** Need a spike to confirm whether it can be driven with line input or requires arrow-key TUI nav. If interactive, restart-on-toggle is the only path.
2. **`--remote-control` protocol.** Worth a spike to see if it offers a clean structured control channel that could replace the PTY entirely. Out of scope for v1.
3. **Plugins / hooks parity.** SDK driver runs the user's `~/.claude/settings.json` hooks via `settingSources: ["user","project","local"]`. CLI does the same natively — verify end-to-end. **Phase-0 spike must confirm `PreToolUse` hook fires under `--dangerously-skip-permissions`** (entire enforcement model depends on this).
4. **Image attachment fallback.** `@path` works for files Kanna already saves to disk. Need to verify CLI accepts the path syntax for image files and renders them to the model.
5. **`SO_PEERCRED` / `LOCAL_PEERCRED` availability under Bun.** Bun's UDS API may not expose peer credentials directly — fallback is `lsof` or `/proc/<pid>/fd` correlation by socket inode. Verify in phase-0.
6. **FD-passing for bearer token under Bun.spawn.** Confirm `Bun.spawn` exposes arbitrary additional file descriptors beyond stdin/stdout/stderr; otherwise fall back to a Unix-domain-socket initial handshake to receive the token.

## Spec self-review notes

- No placeholders / TODOs remain.
- Internal consistency: control plane methods match audit table match testing matrix.
- Scope: focused on one driver swap + lifecycle. Subagent + MCP tool refactor are required dependencies, called out as such.
- Ambiguity: `interrupt()` semantics around single vs double Esc are flagged as needing implementation-phase verification, not left for the reader to guess.
