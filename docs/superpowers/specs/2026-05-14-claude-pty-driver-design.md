# Claude PTY Driver — Design

**Date:** 2026-05-14
**Status:** Draft v10 — ninth codex adversarial pass applied (allowlist preflight cache tightened: full suite on boot/binary/model-change, sentinel probe per user spawn, no time-based TTL), awaiting user review
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
  ├── allowlist-preflight.ts # probe --tools semantics, cache by binary-sha+tools-string
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

1. **Request identity.** `toolRequestId = hex(HMAC_SHA256(serverSecret, chatId || sessionId || toolUseId || toolName || canonicalArgsHash))`. Deterministic across retries of the **exact same call**, but any change in `toolName` or `arguments` produces a new id. `canonicalArgsHash = sha256(canonicalJson(arguments))` where canonical JSON sorts object keys, strips whitespace, and normalizes numerics. Embed `chatId`, `sessionId`, `toolUseId`, `toolName`, `arguments`, `canonicalArgsHash`, `createdAt`. Idempotent retry rule (rule 4) requires **all** of `toolUseId + toolName + canonicalArgsHash` to match; mismatched retries with a duplicate `toolUseId` fail closed with `{decision:"deny", reason:"argument_mismatch"}` and emit a security audit event.
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

  --tools "mcp__kanna__*"                            # MCP-only; all CLI built-ins disabled
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

The CLI's `--tools` flag accepts an allowlist of built-in tool names. We use it to **disable every mutating and every read-capable built-in** at spawn — `Bash`, `Edit`, `Write`, `WebFetch`, `WebSearch`, **and also `Read`, `Glob`, `Grep`**. Default allowlist is `--tools "mcp__kanna__*"` (MCP only).

The reason read tools are also disabled: built-in `Read/Glob/Grep` cannot be intercepted by Kanna, so their accessible surface is whatever the OS sandbox profile captured **at spawn time**. New sensitive files appearing later in the session (e.g., the model approves a write that creates a `.env`) would be reachable until respawn. Routing reads through `mcp__kanna__*` makes every read check the live `readPathDeny` before returning content, eliminating that stale-sandbox class entirely.

For each disabled built-in we ship a kanna-mcp tool of the same semantic shape — `mcp__kanna__bash`, `mcp__kanna__edit`, `mcp__kanna__write`, `mcp__kanna__webfetch`, `mcp__kanna__websearch`, `mcp__kanna__read`, `mcp__kanna__glob`, `mcp__kanna__grep`. The Kanna system-prompt append instructs the model to use these in place of the missing built-ins.

The OS sandbox (next section) is retained as **defense-in-depth** only: it catches the rare cases where the CLI version exposes a built-in we forgot to disable, a third-party MCP server (when allowlisted) tries to escape, or a bug in `mcp__kanna__*` mis-handles a path. Safety does not depend on the sandbox being perfect; it depends on MCP routing.

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

This pattern's safety properties **do not depend** on `--dangerously-skip-permissions` behavior or on PreToolUse hooks. They do depend on `--tools` semantics — which is treated as an enforced runtime invariant, not a documentation assumption (see "Allowlist preflight" below).

### Allowlist preflight (fail-closed, per CLI version)

Before any user-facing PTY session spawn, Kanna runs an allowlist-verification probe suite and caches the result by `(claude-binary-sha256, tools-string)` for 7 days.

The suite consists of **N directed probes, one per disallowed built-in**, plus one positive-control probe. We do not rely on the model self-reporting which tools it has.

#### Directed probes (one per built-in)

For each disallowed built-in tool `T` in `{Bash, Edit, Write, Read, Glob, Grep, WebFetch, WebSearch}` (and any future built-ins enumerated from `claude --help`):

1. Pre-stage scratch state appropriate to `T`. Examples:
   - `Read`: write `<scratch>/kanna-probe-read.txt` containing the random marker `<probe-secret-A>`.
   - `Glob`: scatter `<scratch>/{a,b,c}.probe` files.
   - `Grep`: write a file containing `<probe-secret-B>`.
   - `Write`: target path `<scratch>/kanna-probe-write.txt` (must not exist).
   - `Edit`: write `<scratch>/kanna-probe-edit.txt` with known content.
   - `Bash`: prompt requires `echo <probe-secret-C>` invocation.
   - `WebFetch`: a single-shot local HTTP URL Kanna serves on a random port that returns `<probe-secret-D>`.
   - `WebSearch`: prompt requires a search for the unique nonce `<probe-secret-E>`.
2. Spawn `claude` with the production flags (`--tools "mcp__kanna__*"`, `--dangerously-skip-permissions`, etc.) and an `--append-system-prompt` that pressures the model to invoke `T`:
   - "You MUST use the `<T>` tool with these arguments to complete this task. Do not use any MCP tool. If `<T>` is unavailable, immediately call `mcp__kanna__probe_unavailable` and pass the tool name as the `tool` argument."
3. The probe MCP config registers two tools:
   - `mcp__kanna__probe_unavailable(tool)` — records that the model could not find `T`.
   - `mcp__kanna__probe_observed(tool)` — never advertised; presence in JSONL `tool_use` would indicate spec drift.
4. Tail JSONL for up to 2 assistant turns. Outcomes:
   - **PASS**: any `tool_use` for `mcp__kanna__probe_unavailable` referencing `T` AND no `tool_use` for `T`. The model confirmed `T` is unavailable.
   - **FAIL — built-in reachable**: any `tool_use` event with `name === T` (or any other disallowed built-in). The CLI ignored the allowlist.
   - **FAIL — indeterminate**: two turns elapse without either a `probe_unavailable` call referencing `T` or a `tool_use` for `T`. We cannot confirm absence, so fail closed.
5. Terminate the PTY after the verdict.

If **any** directed probe fails, the entire suite fails closed for this `(binary-sha256, tools-string)`.

#### Positive control

One probe spawns with the same flags and asks the model to call `mcp__kanna__probe_ack(value)` with a fixed argument. This confirms `mcp__kanna__*` tools are reachable (suite passes only if positive control also passes — protects against regressions where the allowlist becomes too restrictive and breaks our own tools).

#### Cache & invalidation (short-lived; per-spawn sentinel)

Allowlist semantics depend on local binary, `--tools` string, **and** server-side model/planner behavior that Anthropic can change without our binary changing. Caching is therefore conservative:

**Two-layer verification:**

1. **Full directed-probe suite** runs at:
   - Kanna server boot (before the first user-facing PTY spawn of this process lifetime).
   - First user-facing PTY spawn after `binary-sha256`, `tools-string`, or observed `system.init.model` changes.
   - Force-refresh from app settings.
   Cache key: `(binary-sha256, tools-string, systemInitModel, kannaProcessId)`. Note `kannaProcessId` — cache does not survive server restart. Cost: N+1 subscription turns once per server boot.

2. **Cheap sentinel probe** runs **before every user-facing PTY spawn**, except the one that just ran the full suite. The sentinel is one directed `Bash` probe (the highest-impact built-in). Outcomes:
   - PASS: `mcp__kanna__probe_unavailable("Bash")` observed → user-facing PTY proceeds.
   - FAIL — built-in reachable: any `tool_use` for `Bash` (or other disallowed built-in) → fail closed, invalidate full-suite cache for this `(binary, tools)`, trigger full-suite re-probe before any further spawn.
   - FAIL — indeterminate (no signal in 1 turn): fail closed for this spawn; the user can retry, which re-runs the sentinel.
   Cost: 1 subscription turn per user-facing PTY spawn (sub-second model time, single token-light prompt).

**Why the sentinel:** It's a tripwire for remote behavior drift. Even if Anthropic silently changes the planner to expose `Bash` under `--tools "mcp__kanna__*"`, the next user-facing spawn catches it before the user sees the PTY. The cost is one cheap turn per spawn; the alternative is a multi-day window of un-gated tool execution.

**Cache invalidation triggers:**
- Server restart (process id changes).
- Binary sha256 changes.
- `--tools` string changes.
- Observed `system.init.model` from any prior spawn changes.
- Sentinel probe ever fails — invalidates **immediately**, blocks further spawns until full suite re-runs and passes.
- Force-refresh from app settings.

There is no time-based TTL. Either the process restarts (re-probe), the model version changes (re-probe), or the sentinel fails (re-probe). Otherwise the cached pass remains valid because we are continuously re-validating per spawn.

#### Tests (`allowlist-preflight.test.ts`)

- **End-to-end real-CLI** (gated `KANNA_PTY_E2E=1`): run the full suite against the actual bundled `claude` binary; assert pass.
- **Per-built-in mock probe**: inject JSONL where the model produces a `Bash` (etc.) `tool_use` → assert fail closed.
- **Indeterminate handling**: inject JSONL that produces text only, no tool_use → assert fail closed after 2 turns.
- **Positive control regression**: probe MCP server registered but unreachable → assert fail (don't ship a broken allowlist).
- **Cache hit**: second invocation within 7d → assert no spawn.
- **Cache invalidation**: change binary sha or tools string → assert re-probe.

If the spike (phase 0) finds that any directed probe cannot reliably force the model to attempt the built-in (e.g., the model refuses for unrelated reasons), we either: (a) sharpen the probe system prompt; (b) downgrade to "fail closed unless explicit pass from at least one indicative signal per built-in"; or (c) ship a stricter alternative — spawn under a sandbox that traps any `execve` of a tool process not on a whitelist. Decision recorded in the spike doc before phase 1.

### Durable approval protocol (unified)

`ask_user_question`, `exit_plan_mode`, and every gated MCP tool call use one shared protocol. Field shape:

```
ToolRequest {
  id                   // hex(HMAC_SHA256(serverSecret,
                       //   chatId || sessionId || toolUseId || toolName || canonicalArgsHash))
  chatId
  sessionId
  toolUseId            // CLI-assigned; same id MUST coincide with same toolName + canonicalArgsHash
  toolName
  arguments            // structured, full args (no truncation)
  canonicalArgsHash    // sha256(canonicalJson(arguments)); persisted; never recomputed from the
                       // arguments field on retry — compared verbatim against the new request's hash
  policyVerdict        // "auto-allow" | "auto-deny" | "ask"
  status               // pending | answered | timeout | canceled | session_closed | arg_mismatch
  decision?            // allow | deny | answer payload
  mismatchReason?      // populated when status = arg_mismatch; emits audit event
  createdAt
  resolvedAt?
  expiresAt
}
```

Phase-1 tests gate (`mcp-tool-callback.test.ts` and `permission-gate.test.ts`) explicitly cover:

- Same `toolUseId` with identical `toolName` + `canonicalArgsHash` → idempotent (returns existing record).
- Same `toolUseId` with **different** `toolName` → reject with `arg_mismatch`, audit event emitted, original record unchanged.
- Same `toolUseId` with **different** `canonicalArgsHash` (any field mutated) → reject with `arg_mismatch`, audit event emitted.
- Replay across a previously-answered record (terminal status) with mismatched args → reject with `arg_mismatch`; the prior allow decision is NOT applied.

Lifecycle rules (apply to all gated calls):

1. **Policy first.** `policy.evaluate(toolName, arguments, chatSettings)` returns `auto-allow | auto-deny | ask`. Auto verdicts resolve the request immediately without UI.
2. **Server-driven timeout.** Default 600s. On timeout, resolve `{decision:"deny", reason:"timeout"}`.
3. **Cancellation.** Resolved with `{decision:"deny", reason:"canceled"}` on: chat deleted, PTY COOLING, server shutdown, explicit UI cancel.
4. **Idempotency.** Re-emitting a request for the same `(toolUseId, toolName, canonicalArgsHash)` returns the existing record (cached or pending). Never creates a duplicate UI prompt. A retry with the same `toolUseId` but mismatched `toolName` or `canonicalArgsHash` fails closed (rule above), is logged, and surfaces a user-visible warning. The model cannot "edit" an approved command by reusing its id.
5. **Replay on reconnect.** On wake / refresh, server re-emits all `pending` requests for the chat to the UI from `EventStore`.
6. **Server restart.** On startup, all `pending` requests fail closed → `{decision:"deny", reason:"server_restarted"}` unless a user-configurable "preserve pending across restart" flag is set (default off).

### Per-chat policy

Stored in `EventStore.chatSettings.permissionPolicy`. Defaults are intentionally conservative.

```
{
  defaultAction: "ask" | "auto-allow" | "auto-deny",
  bash: {
    autoAllowVerbs: ["ls","pwd","git status","git diff","git log"],
    // Verbs that take no path / network argument. Used only if the parsed
    // command consists entirely of one of these verbs and arguments that
    // fail no read-path check. Any pipe, redirect, subshell, env-set,
    // backtick, or `eval` short-circuits to "ask".
  },
  readPathDeny: [
    "~/.ssh", "~/.aws", "~/.gcp", "~/.config/gh",
    "~/.claude", "~/.kanna",
    "~/Library/Keychains", "~/Library/Application Support/Code/User",
    "/etc/shadow", "/etc/sudoers", "/private/etc/shadow",
    "~/.npmrc", "~/.netrc", "~/.docker/config.json",
    "**/.env", "**/.env.*", "**/credentials*", "**/*.pem", "**/*.key",
    "**/id_rsa*", "**/id_ed25519*"
  ],
  writePathDeny: [
    "/etc/**", "/usr/**", "/System/**", "/private/etc/**",
    "~/.ssh/**", "~/.aws/**", "~/.config/gh/**",
    "~/.claude/**", "~/.kanna/**",
    ...readPathDeny
  ],
  toolDenyList: [
    { tool: "mcp__kanna__bash", pattern: "rm\\s+-rf\\s+(/|~|\\$HOME)\\b" },
    { tool: "mcp__kanna__bash", pattern: "git\\s+push\\b.*--force" },
    { tool: "mcp__kanna__webfetch", pattern: ".*" }   // example user policy
  ]
}
```

#### Bash gating

`mcp__kanna__bash` does **not** auto-allow by regex prefix. Instead it parses the command line:

1. Parse the command with a real shell-aware parser (e.g., `shell-quote` or `mvdan/sh` via FFI), not a regex. Reject and `ask` if parsing fails.
2. Reject (`ask`) immediately on any of: pipe (`|`), redirect (`>`, `>>`, `<`), subshell `$(...)`, backticks, `eval`, `exec`, env-prefix (`FOO=bar cmd`), `&&`/`||`/`;` chains, glob-expansion of path args (e.g. `cat ~/.ssh/*`).
3. The remaining canonicalized form is `verb arg1 arg2 …` with no shell features.
4. For each path-shaped argument, normalize (`realpath` resolved against `cwd`). If the resolved path matches `readPathDeny` (or, for write-shaped verbs, `writePathDeny`), deny outright. **Do not auto-allow even for `cat`/`rg` if any path argument is in `readPathDeny`.**
5. Auto-allow only when the verb is in `bash.autoAllowVerbs` AND no path argument matches a deny list AND the call has no flags that could change behavior in a hidden way (e.g., `rg --files-with-matches` is fine, but `rg --hyperlink-format` is `ask` for safety). Curated per-verb argument allowlists live alongside the verb list.
6. Otherwise: `ask`.

Result: `cat ~/.claude/.credentials.json`, `rg . ~/.ssh`, `cat $(echo ~/.ssh/id_rsa)` all path through to "ask" (in fact `cat ~/.claude/...` matches `readPathDeny` first → outright deny).

#### Other tools

- `mcp__kanna__edit` / `mcp__kanna__write`: target path is structured (not shell-parsed). Resolve against `cwd`, deny if outside workspace + `additionalDirectories`, deny if matches `writePathDeny`. Otherwise `ask` (or `auto-allow` if `defaultAction` is set).
- `mcp__kanna__webfetch` / `mcp__kanna__websearch`: no auto-allow by default. User can add hosts to a per-chat allow list.
- `mcp__kanna__read` / `mcp__kanna__glob` / `mcp__kanna__grep`: replace the CLI built-ins. Resolve target paths against `cwd` + `additionalDirectories`, enforce `readPathDeny` per call (so newly-created secrets are also denied immediately), then read.

#### Sandboxing the spawn (defense-in-depth on supported OS)

OS-level sandboxing is **defense-in-depth**, not the primary safety gate. The primary gate is the `--tools "mcp__kanna__*"` allowlist plus per-call `readPathDeny` enforcement inside `mcp__kanna__read/glob/grep`. The sandbox catches: a CLI version that exposes a tool we forgot to disable, third-party MCP servers (when allowlisted), or a bug in `mcp__kanna__*` mis-handling a path. Kanna still treats it as a hard precondition on supported OSes for that defense-in-depth layer.

**Implementation:**

- **macOS:** `sandbox-exec -f <generated.sb>` wrapping the `claude` invocation. Profile denies `file-read*` for:
  - Every absolute path in `readPathDeny`.
  - Every `readPathDeny` glob expanded across the workspace cwd AND each path in `additionalDirectories` (so workspace-relative `**/.env`, `**/credentials*`, `**/*.pem`, `**/*.key`, `**/id_rsa*`, `**/id_ed25519*` are denied wherever they live inside the agent's accessible roots).
  - Every path in `writePathDeny` (covers `file-write*` and `file-read*`).
  Profile is regenerated per-spawn so user-edited deny lists, new files added since last spawn, and updated `additionalDirectories` all take effect.
- **Linux:** `bwrap` with read-only bind-mounts of the workspace + `additionalDirectories`, plus `--tmpfs` / `--bind-try /dev/null` overlays for **every** matched path: HOME credential dirs AND each file in the workspace/additionalDirectories matching a `readPathDeny` glob. Kanna runs a pre-spawn glob walk to enumerate matches and emits an overlay per match. Glob walk is bounded (max-files cap; reject spawn with "too many sensitive files in workspace, prune before launching" on overflow — better fail-closed than miss one).
- **Windows:** unsupported in v1. PTY driver refuses to spawn by default. There is no `off` default. Allowing PTY on Windows requires the user to explicitly set BOTH (a) `KANNA_PTY_SANDBOX=off` env, AND (b) a server-wide `unsafeWindowsPty: true` toggle in app settings (with destructive-action confirm). When both are set, off-mode is active and additionally strips `Read`, `Glob`, `Grep` from `--tools` allowlist (model has only `mcp__kanna__*` for filesystem access via `mcp__kanna__read_guard`). A permanent global red banner renders across the whole app while off-mode is active.

**Fail-closed preflight (runs on every spawn, supported OS):**

1. Resolve sandbox binary (`/usr/bin/sandbox-exec` macOS, `bwrap` Linux). Fail spawn if missing.
2. Generate the deny-list profile from current `readPathDeny` + `writePathDeny`. Fail spawn if generation errors (e.g., unresolvable `~`).
3. Walk workspace + `additionalDirectories` for glob matches of `readPathDeny` patterns. Fail spawn if the walk exceeds the bounded match cap (configurable, default 500).
4. Boot the sandbox with a 200ms sentinel child that attempts to read each of:
   - HOME credentials: `~/.claude/.credentials.json`, `~/.ssh/id_rsa`, `~/.aws/credentials`.
   - Workspace credentials (generated on first preflight if absent, kept under `<runtimeDir>/sentinels/`): `<workspace>/.kanna-sentinel.env`, `<workspace>/kanna-sentinel.pem`, `<workspace>/credentials-kanna-sentinel.json`. These files contain random bytes Kanna uses solely to verify deny works.
   The child writes results to a private pipe. Spawn proceeds only if **all** sentinel reads were denied. Any success → reject with `"Sandbox preflight failed: <path> reachable. Refusing to launch."`.
5. Cache successful preflight result per `(OS-version, profile-hash, sentinel-set-hash)` for 24h.

**Explicit override:**
- `KANNA_PTY_SANDBOX=off` is recognized only on supported OSes and only when the user has acknowledged the unsafe-mode confirm dialog. When off: `--tools` remains `"mcp__kanna__*"` (no built-in read tools — same as the on-mode default), renders a global red banner, and disables auto-approve toggles. Reads still go through `mcp__kanna__read/glob/grep` which apply `readPathDeny` per call. This is the only way to run PTY without OS sandboxing; it is **not** silently permitted.
- `KANNA_PTY_SANDBOX=on` (default on macOS/Linux) is the supported mode.
- On Windows, the env var alone is insufficient — the server-wide `unsafeWindowsPty` setting must also be true, see "Implementation: Windows" above.

Tests (`sandbox-preflight.test.ts`):
- Missing binary → reject.
- Bad profile generation → reject.
- HOME sentinel reachable → reject.
- **Workspace sentinel** (`.env`, `*.pem`, `credentials*`) reachable → reject. Fixture sets up a real workspace with these files.
- Overflow of bounded glob walk → reject.
- All sentinels denied → allow + cache.
- Cache hit skips re-run.
- Cache invalidates on `profile-hash` or `sentinel-set-hash` change.
- Windows default (no env override) → reject with `unsupported_platform`.
- Windows with `KANNA_PTY_SANDBOX=off` but `unsafeWindowsPty=false` → reject.
- Windows fully off-mode → spawn proceeds, `--tools` is `"mcp__kanna__*"` (built-ins remain disabled regardless of mode).

User can edit lists per-chat. "Auto-approve everything" is a single toggle that sets `defaultAction: "auto-allow"` and shows the red banner. Even under auto-approve, `readPathDeny` and `writePathDeny` still apply — auto-approve cannot grant access to denied paths.

### Mode transitions fail closed

- Changing `defaultAction` from `auto-allow` → anything else: kill PTY (COOLING), respawn. Any in-flight unresolved tool calls resolve as `deny: mode_changed`.
- **Sandbox-affecting state changes** — `readPathDeny`, `writePathDeny`, `additionalDirectories`, `bash.autoAllowVerbs`, `KANNA_PTY_SANDBOX`, `unsafeWindowsPty`, `KANNA_MCP_ALLOWLIST`: mark the live PTY's sandbox profile as stale and trigger respawn before the next user message. In-flight tool calls cancel with `{decision:"deny", reason:"sandbox_stale"}`. Preflight cache entry for the old `profile-hash` is invalidated immediately.
- **New sensitive file detection.** Although safety does not depend on it (reads go through `mcp__kanna__read` which re-checks per call), Kanna maintains a low-priority `fs.watch` over workspace + `additionalDirectories` for any path matching `readPathDeny` globs. On match: mark sandbox stale, respawn before next user message. This ensures defense-in-depth sandbox is also up-to-date.
- Other (non-sandbox-affecting) policy keys hot-reload — `toolDenyList`, `bash.autoAllowVerbs` per-verb argument allowlists, `defaultAction` for `ask` ↔ `auto-deny`: applied on next `policy.evaluate` call without respawn.
- Server crash mid-session: `defaultAction` reset to persisted value; pending requests resolved per "Server restart" rule above; banner re-displayed if `auto-allow` persisted.

### Third-party MCP servers — fail closed

User and project `.mcp.json` entries other than `kanna-mcp` are **not loaded by default** in PTY mode. The driver builds its `--mcp-config` from `kanna-mcp` only.

To enable a third-party MCP server in PTY mode, the user must explicitly add it to `kanna.mcpAllowList` in app settings. When that list is non-empty:

1. Phase-0 hook check must have passed (see "Optional belt-and-suspenders" below). If the hook does not fire under `--dangerously-skip-permissions`, spawn is **rejected** with an error: "Third-party MCP servers require the PreToolUse hook to be functional. Disable MCP allowlist or switch to SDK driver."
2. The PreToolUse hook is registered and gates every call (Kanna-MCP and third-party). Spawn proceeds.
3. The user-facing UI surfaces every third-party MCP server name and a list of its advertised tools at enable time, with a "I understand these run outside Kanna's structured gating" confirm.

If the user has no third-party MCP servers (default), the hook is **not** required — `--tools` allowlist + `kanna-mcp`-only routing is the complete enforcement boundary.

### Optional belt-and-suspenders: PreToolUse hook

If the phase-0 spike confirms `PreToolUse` hooks fire reliably (full structured args, synchronous wait, honored under `--dangerously-skip-permissions`), Kanna installs a hook that veto-checks every tool call against the same `policy.evaluate`. This is **required** if any third-party MCP server is allowlisted; otherwise it is purely defense-in-depth.

If the spike fails AND the user has third-party MCP enabled, spawn is rejected as described above.

### What we still cannot fully gate (documented in user docs)

- CLI built-in **`Read`** / **`Glob`** / **`Grep`** are **disabled in `--tools`** by default. Reads go through `mcp__kanna__read/glob/grep`, which apply live `readPathDeny` per call so newly-created secrets are denied immediately. OS sandboxing is defense-in-depth (not the primary gate).
- File-system race conditions if user shells out from a still-enabled subprocess elsewhere on the system.
- Long-running processes spawned by approved tool calls and inherited beyond the tool's lifetime. Documented limitation.

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
| `KANNA_PTY_SANDBOX` | `on` (macOS/Linux); **Windows: PTY spawn refused entirely** unless explicit `off` env + `unsafeWindowsPty: true` app setting | OS sandbox profile around `claude` spawn (denies reads of credential dirs and workspace secrets). |
| `unsafeWindowsPty` (app setting) | `false` | Windows-only escape hatch. Must be `true` AND `KANNA_PTY_SANDBOX=off` to enable PTY on Windows. Renders global red banner. `--tools` is already `"mcp__kanna__*"` (no built-in read/write tools). |
| `KANNA_MCP_ALLOWLIST` | `""` (empty) | Comma-separated names of third-party MCP servers permitted. Empty = none. |
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
| `--tools` allowlist semantics change (CLI version OR Anthropic server-side planner) | **Runtime allowlist preflight** runs a full directed-probe suite at server boot and a single cheap sentinel probe before every user-facing PTY spawn. Any built-in reachable invalidates the cache immediately and blocks further spawns until re-probe passes. See "Allowlist preflight". |
| Built-in tools (Bash/Edit/Write) execute un-gated | Disabled at spawn via `--tools` allowlist. Model uses `mcp__kanna__*` replacements which Kanna gates synchronously with structured args. |
| User MCP servers (3rd-party) bypass Kanna gating | Default fail-closed: only `kanna-mcp` is loaded. Third-party MCP requires explicit allowlist AND a functional PreToolUse hook; otherwise spawn refused. See "Third-party MCP servers — fail closed". |
| Bash auto-allow leaks credentials (`cat ~/.claude/...`) | Bash is parsed (no regex prefix), `readPathDeny` resolved per arg, shell features (pipes/subshell/eval) downgrade to `ask`. `auto-allow` cannot override deny-list. OS sandbox (`sandbox-exec` / `bwrap`) is the secondary gate. |
| ToolUseId replay with mutated args | Idempotency id binds to `(toolUseId, toolName, canonicalArgsHash)`; mismatch fails closed with `argument_mismatch` and emits audit event. |
| CLI built-in `Read`/`Glob`/`Grep` read sensitive paths | `--tools "mcp__kanna__*"` removes built-ins entirely. Reads go through `mcp__kanna__read/glob/grep` which apply live `readPathDeny` per call (handles newly-created secrets). OS sandbox is defense-in-depth. Sandbox-affecting state changes trigger PTY respawn. |
| Long-running warm PTY has stale sandbox after new sensitive files appear | (a) Primary: reads are not handled by the sandbox at all — `mcp__kanna__read` re-checks `readPathDeny` per call. (b) Defense-in-depth: `fs.watch` over readPathDeny glob matches triggers respawn-before-next-turn when a match appears. |
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
| 0 | Throwaway spike. Verify: (a) JSONL 1:1 fidelity with SDK events on 5 representative chats; (b) implement the allowlist preflight prototype against `--tools "mcp__kanna__*"` and confirm every built-in (`Bash`, `Edit`, `Write`, `WebFetch`, `WebSearch`, `Read`, `Glob`, `Grep`) is unavailable; (c) `--mcp-config` over UDS works with `kanna-mcp`; (d) interactive PTY keeps subscription billing on a real Pro/Max account (check usage page); (e) `--resume` round-trips with a known `--session-id`; (f) `sandbox-exec` (macOS) / `bwrap` (Linux) profile denies `~/.ssh` / `~/.claude` reads AND workspace-secret reads (`.env`, `*.pem`) without breaking project work; (g) PreToolUse hook behavior under `--dangerously-skip-permissions` — captures the answer needed to gate third-party MCP support. Capture all results in `docs/superpowers/specs/2026-05-14-claude-pty-driver-spike.md` before opening phase 1. | (a)–(f) all green. If (b) fails: redesign — possibly fall back to wrapping the entire `claude` invocation in a tighter sandbox or shipping a forked CLI. If (g) fails: spawn refuses to load any third-party MCP server until alternative gate ships. |
| 1a | MCP tool refactor: new `mcp__kanna__bash/edit/write/webfetch/websearch` + move `ask_user_question` + `exit_plan_mode` into kanna-mcp. Unified durable approval protocol (`tool-callback.ts` + `permission-gate.ts`). Behind `KANNA_MCP_TOOL_CALLBACKS=1`. SDK driver opts in first and routes its `canUseTool` through `permission-gate.ts`. | `mcp-tool-callback.test.ts`, `permission-gate.test.ts` green. SDK driver still passes existing tests. |
| 1b | `claude-pty/` module: PTY spawn, UDS server (callbacks only, no creds), runtime-dir, JSONL tail with bookmarks. Feature flag `KANNA_CLAUDE_DRIVER=pty`. Default stays `sdk`. | All unit tests pass. Manual smoke: chat works end-to-end with default `ask` policy and `mcp__kanna__*` tool routing. |
| 2 | UI: driver toggle, status badges, per-chat unsafe opt-in flow with destructive-action confirm dialog, deny-list editor, lifecycle settings. | Manual QA: driver switch, unsafe toggle, deny-list match, cold→warm→active→idle→cooling cycle, server-restart resets unsafe. |
| 3 | Integration test gated by `KANNA_PTY_E2E=1`. Public docs page explaining tradeoffs, ToS caveat, single-user-only, security model. | Docs reviewed. |
| 4 | Default flip considered only after Anthropic SDK pricing announcement lands and PTY mode has ≥2 weeks soak in real use. | n/a |

## Open questions

1. **`--tools` allowlist semantics.** Enforced via runtime allowlist preflight (see "Allowlist preflight"). The phase-0 spike captures the first known-good probe result for the bundled `claude` version, but ongoing correctness is a runtime invariant — not a one-time spike.
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
