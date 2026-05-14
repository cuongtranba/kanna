# Claude PTY Driver — Design

**Date:** 2026-05-14
**Status:** Draft v3 — second codex adversarial pass applied (no bearer credential, MCP-routed gating), awaiting user review
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
  ├── auth.ts              # verify ~/.claude credentials present, reject ANTHROPIC_API_KEY
  ├── runtime-dir.ts       # per-session 0700 dir, cleanup on COOLING
  ├── uds-server.ts        # Unix-domain socket: kanna-mcp + optional hook callbacks
  ├── pretooluse-hook.ts   # OPTIONAL hook script (belt-and-suspenders)
  ├── permission-gate.ts   # policy.evaluate + deny/allow lists + durable ToolRequest store
  ├── tool-callback.ts     # unified durable approval protocol
  ├── lifecycle.ts         # ClaudeSessionLifecycle (lazy spawn, idle stop, LRU)
  └── *.test.ts

src/server/kanna-mcp/                              # extended
  ├── tools/bash.ts        # mcp__kanna__bash (replaces CLI Bash)
  ├── tools/edit.ts        # mcp__kanna__edit
  ├── tools/write.ts       # mcp__kanna__write
  ├── tools/webfetch.ts    # mcp__kanna__webfetch
  ├── tools/websearch.ts   # mcp__kanna__websearch
  ├── tools/ask-user-question.ts
  ├── tools/exit-plan-mode.ts
  └── tools/*.test.ts
```

Note: the new `mcp__kanna__bash/edit/write/...` MCP tools are usable by **both drivers**. The SDK driver also routes through them once the refactor lands. `canUseTool` in the SDK driver becomes a thin pass-through to `policy.evaluate` over the same `permission-gate.ts`. Single source of truth.

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

1. **Request identity.** `toolRequestId = hex(HMAC_SHA256(serverSecret, chatId || sessionId || toolUseId))`. Deterministic across retries of the same `toolUseId`, opaque to the model. (Not a UUID.) Embed `chatId`, `sessionId`, `toolUseId`, `toolName`, `arguments`, `createdAt`.
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

## OAuth / subscription auth (no helper, no bearer)

**Design choice:** PTY driver does **not** ship an `apiKeyHelper`. There is no Kanna-controlled bearer token, no Unix-domain socket for credential delivery, and nothing for model-executed subprocesses to exfiltrate.

Rationale: any FD or file the helper can read is reachable from `Bash` subprocesses of the same `claude` process (they inherit FDs unless `FD_CLOEXEC` is set, and they run as the same uid). The only way to avoid that exfiltration class is to remove Kanna-mediated credentials from the PTY entirely.

How auth works:

1. User runs `claude /login` (or `claude setup-token`) once — this is the standard subscription onboarding. OAuth tokens live in macOS Keychain / libsecret / Windows DPAPI, gated by the OS user account.
2. PTY driver spawns `claude` with `ANTHROPIC_API_KEY` **unset** in env. `claude` reads its own keychain entry, attaches its own tokens, and rotates them via its built-in OAuth refresh.
3. Kanna `oauthPool` is **not used** by the PTY driver. Pool stays for the SDK driver.
4. On startup, PTY driver pre-flights: invoke `claude --print --output-format json "noop"` once in a scratch dir? No — that costs API credits. Instead, check that `~/.claude/.credentials.json` (or platform equivalent) exists and is recent. If missing, fail spawn with a clear "Please run `claude /login` first" error surfaced to the UI.

Trade-offs:

| What we lose | Why acceptable |
|---|---|
| Multi-token rotation in `oauthPool` (rate-limit balancing across subscription tokens) | PTY mode is single-subscription single-user by definition. Pool was a SDK-only optimization. |
| Centralized token revocation from Kanna | User can revoke via `claude /logout` natively. |
| Knowledge of remaining quota in Kanna UI | Surfaceable via JSONL `system` events Anthropic includes (rate limit / remaining usage). |

Settings injection (`.claude/settings.local.json` in per-session runtime dir, mode `0600`):

```json
{
  "tui": "default",
  "syntaxHighlightingDisabled": true,
  "showThinkingSummaries": true,
  "spinnerTipsEnabled": false,
  "showTurnDuration": false,
  "hooks": { "PreToolUse": [/* see Permission enforcement, only if hook approach selected */] }
}
```

No `apiKeyHelper` key. No oauth socket. Nothing for Bash to point at.

### Why the UDS / runtime dir still exists

For **tool callbacks only** — `ask_user_question`, `exit_plan_mode`, and (if hook gate selected) `PreToolUse` approvals. That socket carries no credentials, only request/response JSON for tool routing. Authentication is by `SO_PEERCRED` / `LOCAL_PEERCRED` peer-pid plus a request-bound nonce, not a long-lived bearer.

## Spawn flags

```
claude
  --session-id <uuid>                                # we generate, used to locate JSONL
  --resume <uuid>                                    # only if reattaching to existing
  --fork-session                                     # if user requested fork
  --model <model>
  --effort <low|medium|high|max>

  --permission-mode bypassPermissions                # we manage gating, not the CLI
  --dangerously-skip-permissions                     # avoid TUI prompts; kanna-mcp gates instead

  --tools "Read Glob Grep mcp__kanna__*"             # disable risky built-ins; keep read-only + MCP
  --add-dir <dir>...                                 # additionalDirectories
  --append-system-prompt <text>                      # Kanna guidance: "use mcp__kanna__bash/edit/write"
  --system-prompt <text>                             # ONLY for subagent (systemPromptOverride)
  --mcp-config <runtimeDir>/mcp-config.json          # kanna-mcp config (UDS endpoint, no creds)
  --settings <runtimeDir>/settings.local.json        # tui mode, optional PreToolUse hook
  --no-update                                        # never block on updater prompt
```

The `--dangerously-skip-permissions` flag is safe to use here because Kanna has removed every CLI tool that could mutate state from the allowlist. The only risky tools remaining are MCP tools, which Kanna gates synchronously before execution.

Env:

- Strip `ANTHROPIC_API_KEY` (forces API billing).
- Keep `TERM=xterm-256color`, `NO_COLOR=0`.
- `KANNA_PTY_SESSION=<sessionId>` for `kanna-mcp` to identify which chat it serves.

No bearer token. No FD-passed credentials. See "OAuth / subscription auth".

## Permission enforcement (fail-closed, MCP-primary)

`canUseTool` does not exist in interactive mode. PTY mode replaces it with a **routing-based** gate, not a hook-based gate. Hooks are optional belt-and-suspenders.

### Primary gate: replace built-ins with kanna-mcp shims

The CLI's `--tools` flag accepts an allowlist of built-in tool names. We use it to **disable** the risky built-ins (`Bash`, `Edit`, `Write`, `WebFetch`, `WebSearch`) at spawn. Read-only tools (`Read`, `Glob`, `Grep`) stay enabled — they cannot mutate state and gating them adds latency without safety value.

For each disabled built-in we ship a kanna-mcp tool of the same semantic shape — `mcp__kanna__bash`, `mcp__kanna__edit`, `mcp__kanna__write`, `mcp__kanna__webfetch`, `mcp__kanna__websearch`. The Kanna system-prompt append instructs the model to use these in place of the missing built-ins.

Because every mutating tool now flows through `kanna-mcp` (Kanna code), Kanna gets **synchronous pre-execution** veto power on every call, with full structured arguments (not regex-stripped). The same durable callback protocol used for `ask_user_question` extends here — every gated tool call becomes a `ToolRequest` in `EventStore` with id, timeout, cancel, replay, idempotency semantics (see "Callback protocol").

```
                       ┌─────────────────────┐
                       │  claude (PTY)       │
                       │  --tools allowlist  │
                       │  (no Bash, Edit,    │
                       │   Write, WebFetch)  │
                       └──────────┬──────────┘
                                  │ tool_use mcp__kanna__bash {...}
                                  ▼
                       ┌─────────────────────┐
                       │  kanna-mcp          │
                       │  (Kanna process)    │
                       │                     │
                       │  policy.allow(...)? │──no──▶ return { error: "denied" }
                       │       │             │
                       │      yes            │
                       │       ▼             │
                       │  emit ToolRequest   │──── UI awaits user
                       │  await durable      │              │
                       │  resolution         │◀─── allow ───┘
                       │       │             │
                       │       ▼             │
                       │  execute via        │
                       │  Bun.spawn / fs / … │
                       └─────────────────────┘
```

This pattern's safety properties **do not depend** on `--dangerously-skip-permissions` behavior, on PreToolUse hooks, or on any CLI version-specific assumption. The CLI cannot execute a tool we have not enabled.

### Durable approval protocol (unified)

`ask_user_question`, `exit_plan_mode`, and every gated MCP tool call use one shared protocol. Field shape:

```
ToolRequest {
  id              // HMAC_SHA256(serverSecret, chatId || sessionId || toolUseId)
  chatId
  sessionId
  toolUseId       // CLI-assigned, identical across retries
  toolName
  arguments       // structured, full args (no truncation)
  policyVerdict   // "auto-allow" | "auto-deny" | "ask"
  status          // pending | answered | timeout | canceled | session_closed
  decision?       // allow | deny | answer payload
  createdAt
  resolvedAt?
  expiresAt
}
```

Lifecycle rules (apply to all gated calls):

1. **Policy first.** `policy.evaluate(toolName, arguments, chatSettings)` returns `auto-allow | auto-deny | ask`. Auto verdicts resolve the request immediately without UI.
2. **Server-driven timeout.** Default 600s. On timeout, resolve `{decision:"deny", reason:"timeout"}`.
3. **Cancellation.** Resolved with `{decision:"deny", reason:"canceled"}` on: chat deleted, PTY COOLING, server shutdown, explicit UI cancel.
4. **Idempotency.** Re-emitting a request for the same `toolUseId` returns the existing record (cached or pending). Never creates a duplicate UI prompt.
5. **Replay on reconnect.** On wake / refresh, server re-emits all `pending` requests for the chat to the UI from `EventStore`.
6. **Server restart.** On startup, all `pending` requests fail closed → `{decision:"deny", reason:"server_restarted"}` unless a user-configurable "preserve pending across restart" flag is set (default off).

### Per-chat policy

Stored in `EventStore.chatSettings.permissionPolicy`:

```
{
  defaultAction: "ask" | "auto-allow" | "auto-deny",
  denyList: [
    { tool: "mcp__kanna__bash", pattern: "rm -rf|git push.*--force" },
    { tool: "mcp__kanna__write", pattern: "^/etc/|^/usr/|^/System/" },
    { tool: "mcp__kanna__webfetch", pattern: ".*" }   // user could block all egress
  ],
  allowList: [
    { tool: "mcp__kanna__bash", pattern: "^(ls|cat|rg|git status|git diff).*" }
  ]
}
```

Defaults shipped:
- `defaultAction: "ask"` — every mutating call prompts the user.
- Built-in denyList: `rm -rf /`, `git push -f` to non-fork remotes, writes to `/etc`, `/usr`, `/System`, `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.claude` (avoid wrapping breaking own auth).
- Built-in allowList: read-only git commands, `ls`, `cat`, `pwd`, etc.

User can edit lists per-chat. "Auto-approve everything" is a single toggle that sets `defaultAction: "auto-allow"` and shows the red banner.

### Mode transitions fail closed

- Changing `defaultAction` from `auto-allow` → anything else: kill PTY (COOLING), respawn. Any in-flight unresolved tool calls resolve as `deny: mode_changed`.
- Changing other policy keys: hot-reload (no respawn) since policy is consulted per request.
- Server crash mid-session: `defaultAction` reset to persisted value; pending requests resolved per "Server restart" rule above; banner re-displayed if `auto-allow` persisted.

### Optional belt-and-suspenders: PreToolUse hook

If the phase-0 spike confirms `PreToolUse` hooks fire reliably (with full structured args, synchronous wait) in interactive mode, we additionally install a hook that veto-checks every tool call against the same `policy.evaluate`. This catches:

- Tools we forgot to disable in `--tools` allowlist
- User MCP servers (third-party) whose calls we want to gate
- A future CLI version that re-enables a tool we thought we'd disabled

If the spike fails, we ship without the hook. The MCP-routing gate is sufficient — the hook is purely defense-in-depth.

### What we still cannot fully gate (documented in user docs)

- Tools added by **user-installed MCP servers** other than `kanna-mcp`. Without the hook, those run un-gated. Recommend: review `.mcp.json` before enabling PTY mode.
- `Read`, `Glob`, `Grep`: read-only built-ins that stay enabled. Information disclosure within the project working dir is in-scope for an agent.
- File-system race conditions if user shells out from a still-enabled subprocess elsewhere on the system.

### Tests

`permission-gate.test.ts` covers: policy `auto-allow` / `auto-deny` / `ask`, denyList match, allowList match, timeout → deny, cancel-on-shutdown → deny, idempotent retry, server-restart fail-closed, mode change → kill + cancel pending, MCP server-side enforcement when CLI tries disabled built-in (assert tool call returns "not enabled").

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
| OAuth credential exfil via FD inheritance to Bash subprocesses | **No Kanna bearer exists.** PTY uses `claude`'s native keychain auth. No `apiKeyHelper`, no FD-passed token, no UDS oauth endpoint. See "OAuth / subscription auth". |
| MCP tool callback deadlock turns | Durable per-tool-request state in `EventStore`, server-driven timeout, cancel on close/shutdown/respawn, idempotent retry by HMAC-SHA256 deterministic id. See "Callback protocol" + "Durable approval protocol (unified)". |
| JSONL replay duplicates or skips events on cold wake | Per-session `(byteOffset, lastEventId)` bookmark in `EventStore`, dedupe scan on truncation/rotation, atomic emit+advance, init event treated as control not transcript. See "Tail semantics". |
| Permission gate depends on unproven hook behavior | Primary gate is `--tools` allowlist + kanna-mcp routing — no hook dependency. Hook is optional belt-and-suspenders. CLI cannot execute a tool we have not enabled. See "Permission enforcement". |
| Built-in tools (Bash/Edit/Write) execute un-gated | Disabled at spawn via `--tools` allowlist. Model uses `mcp__kanna__*` replacements which Kanna gates synchronously with structured args. |
| User MCP servers (3rd-party) bypass Kanna gating | Documented limitation. UI warns when third-party MCP server is configured in `.mcp.json`. Optional PreToolUse hook (if spike confirms it works) catches these. |
| Lifecycle bugs leak PTY processes (RSS exhaustion) | LRU cap + idle timeout + server shutdown fanout + `ps`-based reaper sweep on startup. Runtime dir cleanup on COOLING. |
| Subagent feature uses `initialPrompt` + `systemPromptOverride` | Map to `--system-prompt` + send-prompt-then-exit-on-Stop. Covered by `driver.test.ts`. |
| Loss of `oauthPool` multi-token rotation in PTY mode | Documented tradeoff. Pool still serves SDK driver. PTY = single subscription. |
| Anthropic clarifies ToS to disallow PTY wrapping | Feature flag stays off by default. Documented limitation. Remove if formally disallowed. |
| `--remote-control` becomes an official structured channel | Driver lives behind same `ClaudeSessionHandle` interface — swap implementation, keep contract. |
| `claude` JSONL schema changes between versions | Pin minimum `claude` version. Version-probe at spawn. Fail loud on unknown line types (log + skip line). |
| Slash command names change | Same: version pin + integration test runs on supported versions. |

## Rollout

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Throwaway spike. Verify: (a) JSONL 1:1 fidelity with SDK events on 5 representative chats; (b) `--tools "Read Glob Grep mcp__kanna__*"` actually disables `Bash/Edit/Write` (assistant cannot invoke them); (c) `--mcp-config` over UDS works with `kanna-mcp`; (d) interactive PTY keeps subscription billing on a real Pro/Max account (check usage page); (e) `--resume` round-trips with a known `--session-id`. **Optional checks (do not block phase 1):** PreToolUse hook fires under `--dangerously-skip-permissions`; `SO_PEERCRED`/`LOCAL_PEERCRED` available under Bun. Capture results in `docs/superpowers/specs/2026-05-14-claude-pty-driver-spike.md` before opening phase 1. | (a)–(e) all green. If (b) fails: redesign — possibly fall back to wrapping the entire `claude` invocation in a sandbox. |
| 1a | MCP tool refactor: new `mcp__kanna__bash/edit/write/webfetch/websearch` + move `ask_user_question` + `exit_plan_mode` into kanna-mcp. Unified durable approval protocol (`tool-callback.ts` + `permission-gate.ts`). Behind `KANNA_MCP_TOOL_CALLBACKS=1`. SDK driver opts in first and routes its `canUseTool` through `permission-gate.ts`. | `mcp-tool-callback.test.ts`, `permission-gate.test.ts` green. SDK driver still passes existing tests. |
| 1b | `claude-pty/` module: PTY spawn, UDS server (callbacks only, no creds), runtime-dir, JSONL tail with bookmarks. Feature flag `KANNA_CLAUDE_DRIVER=pty`. Default stays `sdk`. | All unit tests pass. Manual smoke: chat works end-to-end with default `ask` policy and `mcp__kanna__*` tool routing. |
| 2 | UI: driver toggle, status badges, per-chat unsafe opt-in flow with destructive-action confirm dialog, deny-list editor, lifecycle settings. | Manual QA: driver switch, unsafe toggle, deny-list match, cold→warm→active→idle→cooling cycle, server-restart resets unsafe. |
| 3 | Integration test gated by `KANNA_PTY_E2E=1`. Public docs page explaining tradeoffs, ToS caveat, single-user-only, security model. | Docs reviewed. |
| 4 | Default flip considered only after Anthropic SDK pricing announcement lands and PTY mode has ≥2 weeks soak in real use. | n/a |

## Open questions

1. **`--tools` allowlist semantics.** Confirm that `--tools "Read Glob Grep mcp__kanna__*"` truly removes `Bash/Edit/Write` from the assistant's available toolset (not just deprioritizes them). Spike-blocking.
2. **`/permissions` slash command interactivity.** Need a spike to confirm whether it can be driven by line input or requires arrow-key TUI nav. Since policy is now per-chat in `EventStore`, runtime changes mostly don't need to touch the CLI's mode — but verify for completeness.
3. **`--remote-control` protocol.** Worth a spike to see if it offers a clean structured control channel that could replace the PTY entirely. Out of scope for v1.
4. **Plugins / hooks parity.** SDK driver runs the user's `~/.claude/settings.json` hooks via `settingSources: ["user","project","local"]`. CLI does the same natively — verify end-to-end. PreToolUse-under-bypass is only required for the optional belt-and-suspenders gate; not gating.
5. **Image attachment fallback.** `@path` works for files Kanna already saves to disk. Verify CLI accepts the path syntax for image files and renders them to the model.
6. **`mcp__kanna__bash` shell semantics.** Decide: implement via `Bun.spawn` with the same env/cwd as the PTY's working directory? Stream stdout to UI live? Match Claude Code's built-in `Bash` exactly so the model doesn't notice the swap. Spike output capture cadence (line-buffered vs frame-debounced) and stdin handling.

## Spec self-review notes

- No placeholders / TODOs remain.
- Internal consistency: control plane methods match audit table match testing matrix.
- Scope: focused on one driver swap + lifecycle. Subagent + MCP tool refactor are required dependencies, called out as such.
- Ambiguity: `interrupt()` semantics around single vs double Esc are flagged as needing implementation-phase verification, not left for the reader to guess.
