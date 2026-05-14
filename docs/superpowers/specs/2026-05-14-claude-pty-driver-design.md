# Claude PTY Driver — Design

**Date:** 2026-05-14
**Status:** Draft — awaiting user review
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
  ├── jsonl-reader.ts      # tail ~/.claude/projects/<cwd>/<uuid>.jsonl
  ├── jsonl-to-event.ts    # JSONL line → HarnessEvent
  ├── frame-parser.ts      # minimal — only slash-cmd ACK detection
  ├── slash-commands.ts    # /model, /permissions, /exit
  ├── auth.ts              # verify OAuth keychain, reject ANTHROPIC_API_KEY
  ├── api-key-helper.ts    # writes helper script for token rotation
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

We control `<session-uuid>` via `--session-id <uuid>`, so we know the exact file path before spawning. We use `fs.watch` (with poll fallback) plus a sliding read offset to tail it append-only.

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

`canUseTool` does not exist in interactive mode. We refactor both tools to live inside `kanna-mcp` (the MCP server Kanna already injects). The MCP tool body posts an internal HTTP request to the local Kanna server (`POST http://127.0.0.1:<port>/internal/tool-request`, authed via per-session token), awaits the user's response, and returns the result as the MCP tool result.

This refactor benefits the SDK driver too — both drivers route these tools through MCP. The SDK's `canUseTool` becomes responsible only for the dangerous-tool deny-list (which is replaced in PTY mode by `--dangerously-skip-permissions`).

## OAuth token rotation

SDK driver rebuilds env per `query()` call via `buildClaudeEnv(oauthToken)`. PTY process env is fixed at spawn.

Solution: write an `apiKeyHelper` script to the chat dir at session start. The helper is a small bash/node script that queries `http://127.0.0.1:<kanna-port>/internal/oauth-token?chat=<id>` (authed by file-system permissions + token in URL) and prints the current token. The CLI invokes the helper every time it needs to refresh auth. Token rotation in `oauthPool` is picked up automatically without restarting the PTY.

Settings injection (via the same `.claude/settings.local.json` written at spawn):

```json
{
  "apiKeyHelper": "/abs/path/to/.kanna-runtime/oauth-helper.sh"
}
```

## Spawn flags

```
claude
  --session-id <uuid>                                # we generate, used to locate JSONL
  --resume <uuid>                                    # only if reattaching to existing
  --fork-session                                     # if user requested fork
  --model <model>
  --effort <low|medium|high|max>
  --permission-mode <bypassPermissions|plan>
  --dangerously-skip-permissions                     # belt-and-suspenders with permission-mode
  --tools <comma-list>                               # CLAUDE_TOOLSET
  --add-dir <dir>...                                 # additionalDirectories
  --append-system-prompt <text>                      # Kanna-specific guidance
  --system-prompt <text>                             # ONLY for subagent (systemPromptOverride)
  --mcp-config <json>                                # kanna-mcp config
  --no-update                                        # never block on updater prompt
```

Env:

- Strip `ANTHROPIC_API_KEY` (would force API billing).
- Keep `TERM=xterm-256color`, `NO_COLOR=0` (colors needed for slash-ACK parsing).
- `KANNA_INTERNAL_PORT=<port>` and per-session auth token for MCP/helper callbacks.

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
| Tool auto-approval enables destructive ops | UI banner when PTY active. Recommend git worktree workflow. Setting toggle visible. |
| Anthropic clarifies ToS to disallow PTY wrapping | Feature flag stays off by default. Documented limitation. Remove if formally disallowed. |
| `--remote-control` becomes an official structured channel | Driver lives behind same `ClaudeSessionHandle` interface — swap implementation, keep contract. |
| Token rotation gap between `apiKeyHelper` invocations | Helper queries token on every CLI auth refresh; oauthPool fresh-fetch happens server-side. No PTY restart needed for routine rotation. |
| Lifecycle bugs leak PTY processes (RSS exhaustion) | LRU cap + idle timeout + server shutdown fanout + `ps`-based reaper sweep on startup. |
| Subagent feature uses `initialPrompt` + `systemPromptOverride` | Map to `--system-prompt` + send-prompt-then-exit-on-Stop. Covered by `driver.test.ts`. |

## Rollout

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Throwaway spike: spawn `claude --session-id X`, tail JSONL, log events. Confirm 1:1 fidelity with SDK events on 5 representative chats. | JSONL parity confirmed. |
| 1 | `claude-pty/` module + unit tests + auth guard. Feature flag `KANNA_CLAUDE_DRIVER=pty`. Default stays `sdk`. | Unit tests pass. Manual smoke. |
| 2 | UI: driver toggle + status badges + auto-approval banner + lifecycle settings. | Manual QA: driver switch creates new session, no crash. Cold→warm→active→idle→cooling cycle observed. |
| 3 | Integration test gated by `KANNA_PTY_E2E=1`. Public docs page explaining tradeoffs, ToS caveat, single-user-only. | Docs reviewed. |
| 4 | Default flip considered only after Anthropic SDK pricing announcement lands and PTY mode has ≥2 weeks soak in real use. | n/a |

## Open questions

1. **`/permissions` slash command interactivity.** Need a spike to confirm whether it can be driven with line input or requires arrow-key TUI nav. If interactive, restart-on-toggle is the only path.
2. **`--remote-control` protocol.** Worth a spike to see if it offers a clean structured control channel that could replace the PTY entirely. Out of scope for v1.
3. **Plugins / hooks parity.** SDK driver runs the user's `~/.claude/settings.json` hooks via `settingSources: ["user","project","local"]`. CLI does the same natively — but verify behavior matches end-to-end.
4. **Image attachment fallback.** `@path` works for files Kanna already saves to disk. Need to verify CLI accepts the path syntax for image files and renders them to the model.

## Spec self-review notes

- No placeholders / TODOs remain.
- Internal consistency: control plane methods match audit table match testing matrix.
- Scope: focused on one driver swap + lifecycle. Subagent + MCP tool refactor are required dependencies, called out as such.
- Ambiguity: `interrupt()` semantics around single vs double Esc are flagged as needing implementation-phase verification, not left for the reader to guess.
