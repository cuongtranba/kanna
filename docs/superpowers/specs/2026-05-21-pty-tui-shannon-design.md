# PTY TUI Shannon — Design Spec

**Date:** 2026-05-21
**Branch:** `feat/pty-tui-shannon`
**Status:** Approved (brainstorm phase)
**Reference architecture:** [`dexhorthy/shannon`](https://github.com/dexhorthy/shannon)

## Problem

Kanna's PTY claude driver (`KANNA_CLAUDE_DRIVER=pty`) currently spawns the `claude` CLI with `--print --output-format=stream-json --input-format=stream-json`. The PTY exists only to give claude a TTY; the actual transport is headless stdout-JSONL + stdin-envelope.

This is fragile:

- `--print` is the secondary, less-tested upstream codepath.
- Stream-json input requires per-message envelope encoding.
- Several CLI features only available in interactive mode (slash commands, `/help`, plan-mode exit) are unreachable.
- `setPermissionMode(false)` cannot leave plan mode (issue #59891 dependency).
- The whole architecture diverges from how upstream tests and ships `claude`.

## Goal

Replace the `--print` transport with an interactive-TUI transport that mirrors the [Shannon](https://github.com/dexhorthy/shannon) pattern: spawn `claude` interactively under a PTY, tail the on-disk transcript JSONL at `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` as the event source, send user input as raw text + `\r`.

**Hard cutover.** No legacy `--print` codepath retained.

## Auth model (hard constraint)

Kanna **never** uses an Anthropic API key. The only supported auth path is OAuth via the multi-tenant OAuth pool. The new TUI driver inherits this constraint verbatim:

- Every spawn receives a token picked by `AgentCoordinator` from `OAuthTokenPool`, injected as `CLAUDE_CODE_OAUTH_TOKEN`.
- `ANTHROPIC_API_KEY` is stripped from the spawned env unconditionally (`buildPtyEnv`). A stray API key in the operator's shell does not change behavior.
- `--bare` is forbidden (it requires `ANTHROPIC_API_KEY` per `claude --help`).
- Auth failures (401) trigger pool rotation via the same callback path the SDK driver uses today. No API-key fallback exists.
- Subagent spawns (`buildClaudeSubagentStarter`) honor the same pool — they receive a pre-picked token from the orchestrator at spawn time.
- Preflight smoke-test runs under a pool token too (uses the same `buildPtyEnv`).

## Non-goals (deferred follow-ups)

- F1 — Plan-mode exit gap closure (Shift+Tab cycle + transcript introspection)
- F2 — Live `/help` parser for `getSupportedCommands()`
- F3 — Multi-line prompt input (bracketed-paste / `\\\r` continuation)
- F4 — Warm-pool subagent spawn-ahead
- F5 — Trust-file preseed (eliminate Enter-dismiss latency)
- F6 — `--bare` ephemeral runs (blocked on Anthropic adding OAuth to `--bare`)
- F7 — kanna-side audit of stored encoded-cwd paths under old format
- Anything touching the SDK driver, kanna-mcp tools, sandbox profiles, auth pool, agent.ts orchestration, or frontend.

## Spike A findings (probed 2026-05-21)

Validated on `claude` CLI v2.1.143:

| Probe | Result | Evidence |
|---|---|---|
| `--disallowedTools` enforced in TUI? | **PASS** | Model tried Bash → blocked. No `tool_use` for any disallowed built-in in transcript. |
| `--append-system-prompt` reaches context in TUI? | **PASS** | Marker `XYZZY-APPEND-OK-7421` echoed verbatim. |
| `--mcp-config` + `--strict-mcp-config` wires up in TUI? | **PASS** | stdio MCP server got `initialize` → `tools/list` → `tools/call`. |
| Transcript file timing? | **WORKS** | File appears ~0.3s after first user prompt (NOT at spawn). |

Additional findings:

- **Path encoding**: claude resolves cwd to realpath first (macOS `/var` → `/private/var`), then replaces `/` → `-`, then `.` → `-`. Kanna's current `encodeCwd` (only `/` → `-`) is incomplete.
- **Trust dialog**: TUI prompts "Quick safety check: Is this a project you created or one you trust?" for every previously-unseen cwd. Per `--print` help, this is the documented `--print` skip path. Dialog dismissible with Enter; trust persists across spawns in the same cwd.
- **`--bare` unusable**: per `claude --help`, `--bare` strictly accepts `ANTHROPIC_API_KEY` or `apiKeyHelper` and never reads OAuth or keychain. Forces "API Usage Billing" in the welcome banner. Incompatible with kanna's OAuth-only model — out.
- **Auth env contamination**: `ANTHROPIC_API_KEY` (even empty) in parent env → 401 against the OAuth path. `env -u ANTHROPIC_API_KEY` mandatory. Kanna's `buildPtyEnv` already strips it unconditionally — invariant preserved by the new driver.
- **Timing baseline**: cold spawn → result = ~9-12s (TUI), vs ~2-3s today (`--print`). ~5-9s overhead per spawn. Subagent fanout affected.

## Decisions (brainstorm)

| Q | Decision | Rationale |
|---|---|---|
| Q1 — Migration path | **Hard cutover** | Avoids long-term dual-path debt. Lowest LOC. |
| Q2 — Trust dialog | **Enter-dismiss on detection** | Zero reverse-engineering. Trust persists per-cwd, so cost amortizes. |
| Q3 — Preflight P3b | **Drop, replace with single TUI smoke test** | Probe #1 validated `--disallowedTools` works. 8 probes redundant. Saves ~700 LOC. |
| Q4 — oneShot close | **`/exit` slash command** | Documented user-facing exit. Stable across versions. Lets MCP subprocess + telemetry flush. |
| Q5 — Plan-mode exit gap | **Defer to follow-up** | Independent of transport refactor. Keeps PR scope tight. |

Approach choice: **β — extract `tui-source.ts` + `tui-control.ts`, shrink `driver.ts`**. Surgical replace inside `driver.ts` (α) leaves a 700+ LOC monolith. Parallel directory (γ) contradicts hard-cutover.

## Architecture

### Before

```
agent.ts → driver.ts → spawnPtyProcess (Bun.Terminal)
                       claude --print --output-format=stream-json --input-format=stream-json …
                       PTY stdout → createJsonlEventParser → HarnessEvent stream
                       PTY stdin  ← JSONL prompt envelopes
```

### After

```
agent.ts → driver.ts (coordinator)
            ├── pty-process.ts        ← unchanged Bun.Terminal spawn
            ├── tui-control.ts (NEW)  ← trust-dialog dismiss, prompt-send-as-text, /exit close
            ├── tui-source.ts  (NEW)  ← transcript-file watch, line streaming, first-file discovery
            └── jsonl-to-event.ts     ← unchanged parser, consumes lines from tui-source

          spawn:  claude --model … --permission-mode … --dangerously-skip-permissions
                          --mcp-config … --append-system-prompt … --disallowedTools …
                          (no --print, no --output-format, no --input-format, no --verbose)
          stdin:  text + \r  (no stream-json envelopes)
          source: ~/.claude/projects/<realpath-encoded-cwd>/<session-uuid>.jsonl
```

Invariants preserved:

- Bun.Terminal PTY (no tmux dep)
- **OAuth-only auth.** Kanna never uses an API key. `ANTHROPIC_API_KEY` is unconditionally stripped from spawned env (`buildPtyEnv` already does this — keep). Only `CLAUDE_CODE_OAUTH_TOKEN` is set, sourced from the multi-tenant OAuth pool.
- **Pool rotation honored.** Every TUI spawn obtains its token via `AgentCoordinator.pickToken(chatId)` → `OAuthTokenPool` → `CLAUDE_CODE_OAUTH_TOKEN` env injection — identical wiring to today's PTY driver (P5). Auth-failure detection (see Error Handling) feeds back into the existing rotation/retry path in `agent.ts`.
- sandbox-exec/bwrap wrap unchanged (wraps `claude` binary itself)
- kanna-mcp loopback HTTP server unchanged
- HarnessEvent shape unchanged
- Phase 6 parity-matrix test fixtures still apply (retargeted to `tui-source` stream)

## Components

### `claude-pty/jsonl-path.ts` (EDIT)

Fix `encodeCwd` to match claude CLI's real behavior:

```ts
export function encodeCwd(cwd: string): string {
  const real = fs.realpathSync(cwd)
  const trimmed = real.endsWith("/") && real !== "/" ? real.slice(0, -1) : real
  return trimmed.replace(/\//g, "-").replace(/\./g, "-")
}
```

`computeJsonlPath` signature unchanged. Add `findLatestTranscript(homeDir, cwd)` for first-file discovery (session uuid generated post-spawn).

### `claude-pty/tui-control.ts` (NEW, ~120 LOC)

Helpers around a `PtyProcess`:

- `waitForTuiReady(pty, opts)` — primary signal: poll ringbuf at 50ms for input-box marker `❯ ` (TUI prompt). Fallback hard cap: `KANNA_PTY_TUI_BOOT_MS` (default 3000ms). Whichever fires first.
- `dismissTrustDialogIfPresent(buf, pty)` — scan ringbuf for `"trust this folder"`; if found, send `\r`, wait again.
- `sendUserPrompt(pty, text)` — write `text + \r` to PTY stdin. Single-line only this PR.
- `sendExitCommand(pty)` — write `/exit\r`. Used for oneShot.
- `RingBuffer` — last 64 KB of PTY output. Drives trust detection + failure synthesis.

### `claude-pty/tui-source.ts` (NEW, ~150 LOC)

Transcript-file lifecycle:

- `startTranscriptStream(args)` — `{ homeDir, cwd, sessionId? }` → `ReadableStream<string>` of JSONL lines.
  - Watches `~/.claude/projects/<encoded>/` via `fs.watch` for first `<uuid>.jsonl` appearance.
  - Opens read stream, follows with `fs.watch(file)` + position cursor.
  - Holds partial bytes across writes; emits only complete `\n`-terminated lines.
  - Resolves `actualSessionId` so caller can fork/resume.
- `waitForResultEntry(stream, timeoutMs)` — drains until `"type":"result"` line; resolves with that entry.
- Polling fallback at 50ms when `KANNA_PTY_TRANSCRIPT_WATCH=poll` or auto-detected unreliability (5s zero events post-write).

### `claude-pty/driver.ts` (EDIT, -300 LOC net)

- `buildPtyCliArgs`: delete `--print`, `--output-format`, `--input-format`, `--verbose`, `--include-partial-messages`, `--session-id` (TUI generates).
- Keep `--model`, `--permission-mode`, `--dangerously-skip-permissions`, `--mcp-config`, `--append-system-prompt`, `--add-dir`, `--disallowedTools`, `--resume <token>` (if resuming), `--effort`.
- Replace `pumpStdout` with: spawn → `waitForTuiReady` → `dismissTrustDialogIfPresent` → `sendUserPrompt` → `startTranscriptStream` → pipe lines into `createJsonlEventParser` → emit HarnessEvents.
- oneShot path: caller (`buildClaudeSubagentStarter()` from `src/server/subagent-provider-run.ts`, used by Claude subagent runs) passes `oneShot: true`. After first `result` event, driver sends `/exit\r` via `sendExitCommand`, awaits `pty.exited` with 5s grace, escalates SIGTERM → SIGKILL if hung. Interactive callers (main chat sessions) keep the REPL alive for follow-up `sendInput` cycles.
- Failure synthesis (existing): unchanged — RingBuffer tail on silent exit.

### `claude-pty/preflight/` (DELETE most, ~700 LOC removed)

Delete: `gate.ts`, `suite.ts`, `probe.ts`, `cache.ts`, `types.ts` + tests.
Keep: `binary-fingerprint.ts` (cache key for smoke-test).

### `claude-pty/smoke-test.ts` (NEW, ~80 LOC)

Single TUI probe per `(binarySha256, model)`, 24h cache. Sends one prompt that tries `Bash`. PASS if no `tool_use` for Bash in resulting transcript. Refuses spawn on regression.

### Unchanged

- `resolve-binary.ts`, `settings-writer.ts`, `jsonl-to-event.ts`, `pty-process.ts`, `sandbox/*`.
- `auth.ts` — OAuth-pool token injection logic unchanged. `buildPtyEnv(token)` returns env with `CLAUDE_CODE_OAUTH_TOKEN=<token>` set and `ANTHROPIC_API_KEY` unconditionally deleted. New TUI driver calls it identically. No code path in the new driver ever sets, reads, or accepts `ANTHROPIC_API_KEY`.
- `AgentCoordinator` ↔ `OAuthTokenPool` wiring — TUI driver receives a pre-picked token per spawn from `agent.ts`, same as today's PTY driver. Auth-failure detection (see Error Handling) reports the failed token via the same callback so the pool can mark `limitedUntil` and rotate.

## Data flow

### Cold spawn (no prior session, new cwd)

```
T+0.0s  agent.ts → createClaudePtyHarness(opts)
T+0.0s  driver: buildPtyCliArgs() → TUI args (no --print family)
T+0.0s  driver: spawnPtyProcess(claude, args, cwd, env=buildPtyEnv(token))
T+0.0s  driver: tui-control.startRingBuffer(pty.onOutput)
T-9..0s driver: smoke-test.gate(binary, model) — runs BEFORE spawn. Cached → instant; miss → ~9s separate TUI probe, then proceed. Refusal on regression aborts spawn.
T+3.0s  driver: waitForTuiReady(pty) — usually returns earlier on `❯ ` marker detect; 3s is hard cap
T+3.0s  driver: dismissTrustDialogIfPresent — pty.sendInput("\r") if marker present; +3s
T+6.0s  driver: sendUserPrompt(pty, firstPrompt)
T+6.5s  source: startTranscriptStream → fs.watch parent dir
T+6.7s  source: 'add' event for <uuid>.jsonl → open + follow
T+6.8s  source: emits JSONL lines → createJsonlEventParser → HarnessEvents
T+9-12s source: emits "type":"result" → final HarnessEvent
        oneShot: driver sends "/exit\r"; await pty.exited (5s); SIGTERM/SIGKILL escalation if hung
        interactive: stream stays open for next sendInput
```

### Subsequent prompt (REPL alive)

```
T+0.0s  driver.sendInput(text)
T+0.0s  tui-control.sendUserPrompt(pty, text)
T+0.0s  source: follow-stream emits new lines as claude writes
T+X     source: emits "type":"result" → HarnessEvent
```

### Resume existing session

```
buildPtyCliArgs adds --resume <sessionToken> (no --session-id)
spawn; trust dialog never shown (cwd already trusted)
waitForTuiReady; ringbuf has welcome; no trust to dismiss
sendUserPrompt(text)
source: file path = computeJsonlPath(homeDir, cwd, sessionToken) — direct open
        seek to EOF, fs.watch(file) for new lines
```

### Fork session

```
buildPtyCliArgs adds --session-id <newUuid> --resume <oldToken> --fork-session
flow identical to "resume" but path = computeJsonlPath(…, newUuid)
```

### Cancel

```
agent.ts → driver.close()
driver: sendExitCommand(pty); await pty.exited (1s grace)
        hung → pty.close() (SIGTERM); still alive after 2s → SIGKILL
source: fs.watch handles closed; partial-line buffer discarded
```

## Error handling

| Error | Detection | Action |
|---|---|---|
| Auth failure (401 from OAuth) | Ringbuf scan for `"401 Invalid authentication credentials"`, `"Please run /login"`, or `"Not logged in"` within ~10s post-prompt. (Confirmed strings from spike A.) | Synthesize `{kind:"result", subtype:"error", isError:true, error:"oauth_invalid_token"}` with the offending pool token id. Feeds existing pool rotation in `agent.ts`: mark token `limitedUntil`, pick next, retry. Same rotation path the SDK driver uses on thrown stream errors. Never falls back to API key — kanna has none. |
| Trust dialog never dismissed | After dismiss sleep, ringbuf still has `"trust this folder"` | Synthesize `{…, error:"trust_dialog_stuck"}`. Kill PTY. Fatal spawn error. |
| Transcript file never appears | `fs.watch` on parent dir no `add` event in 20s post-prompt-send | Synthesize `{…, error:"transcript_missing"}` from ringbuf tail. Kill PTY. |
| Child exit without `result` | `pty.exited` resolves before `tui-source` emits result | Existing 256 KB ringbuf-tail synthesis. Unchanged. |
| Partial JSONL line | Buffer holds bytes without trailing `\n` | Hold partial, append next chunk, re-split. Discard partial only on explicit close + 100ms drain. |
| `fs.watch` unreliable | `KANNA_PTY_TRANSCRIPT_WATCH=poll` env OR auto-detect (5s zero events post-write) | Switch to 50ms `fs.stat` polling. Log once. |
| oneShot `/exit` ignored | `pty.exited` not resolved 5s after `sendExitCommand` | Escalate: `pty.close()` → SIGTERM; +2s → `proc.kill(9)`. |
| Cancel mid-turn | `cancelChat` / `cancelRun` chain | `sendExitCommand` is cancel signal; `waitForResultEntry` rejects with AbortError; downstream cascade unchanged. |
| Trust persistence lost (container restart) | Out of scope | New spawn pays one trust-dismiss cost. |

## Testing

### Keep, unchanged

- `jsonl-to-event.test.ts`
- `auth.test.ts`, `resolve-binary.test.ts`, `settings-writer.test.ts`, `pty-process.test.ts`
- `sandbox/*.test.ts`

### Keep, retarget

- `parity-matrix.test.ts` — today drives SDK + `createJsonlEventParser` (PTY stdout) with same fixtures. New: drives SDK + new `tui-source` (file-fed) with same fixtures. Same assertion: identical `HarnessEvent` sequences. Coverage preserved for all 7 fixture cases (simple turn, rate_limit_event, prompt-too-long isError, usage-id dedup, 1M ctx floor, per-message session_token, compact_boundary).

### Delete

- `preflight/gate.test.ts`, `preflight/suite.test.ts`, `preflight/probe.test.ts`, `preflight/types.test.ts`
- `preflight/cache.test.ts` — folded into `smoke-test.test.ts`

### Edit

- `jsonl-path.test.ts` — add realpath + dot-replacement cases, trailing slash, `/` root edge case.
- `driver.test.ts` — drop assertions on `--print`/`--output-format`/`--input-format`/stdin-envelope. Add TUI args + new control flow.

### New

- `tui-control.test.ts` (~150 LOC) — `dismissTrustDialogIfPresent`, `sendUserPrompt`, `sendExitCommand`, ringbuf bound.
- `tui-source.test.ts` (~250 LOC) — `startTranscriptStream` dir watch + first-file pick, line buffering, partial-line hold, `actualSessionId` resolution, `waitForResultEntry` resolve + AbortError, poll-mode fallback, cleanup.
- `smoke-test.test.ts` (~120 LOC) — cache hit/miss, PASS/FAIL paths.

### OAuth-pool integration tests (new)

Add assertions to `driver.test.ts`:

- Spawn receives `CLAUDE_CODE_OAUTH_TOKEN=<pool-token>` env, never `ANTHROPIC_API_KEY`.
- If parent test env sets `ANTHROPIC_API_KEY=garbage`, child spawn env still lacks it (verifies `buildPtyEnv` strip).
- Auth-failure detection: scripted PTY emits `"Please run /login"` → driver synthesizes `oauth_invalid_token` result event with the pool token id attached.
- Pool rotation simulation: after `oauth_invalid_token`, second spawn receives a different pool token id (mock `OAuthTokenPool.pickToken` cycles).

### Integration test (no live claude)

Existing `Bun.spawn` mock pattern in `driver.test.ts`. Fake PTY emits scripted JSONL into a fake transcript file in tmpdir; driver reads via real `tui-source`. End-to-end: spawn → trust-dismiss → prompt-send → transcript-stream → result → exit.

### Live-binary smoke test (CI-skipped)

New `claude-pty/live-tui.smoke.test.ts` — runs only when `KANNA_PTY_LIVE_TESTS=1`. Spawns real claude, sends single prompt, asserts response in transcript.

### Coverage target

Preserve current pty-driver coverage (~85%). New modules ≥80% line coverage. Parity matrix passes for all 7 existing fixture cases.

## Migration

### Deleted (~700 LOC)

- `preflight/{gate,suite,probe,cache,types}.ts` + tests
- All references to `KANNA_PTY_PREFLIGHT_MODEL`
- `--print` / `--output-format` / `--input-format` / `--verbose` / `--include-partial-messages` arg blocks
- stdin JSONL envelope writer
- `pumpStdout`
- stdout-JSONL fixture assertions in `driver.test.ts`
- CLAUDE.md paragraphs on `--print`, preflight gate, stream-json source

### Added (~870 LOC)

- `tui-control.ts` (~120 LOC) + `tui-control.test.ts` (~150 LOC)
- `tui-source.ts` (~150 LOC) + `tui-source.test.ts` (~250 LOC)
- `smoke-test.ts` (~80 LOC) + `smoke-test.test.ts` (~120 LOC)
- `jsonl-path.ts` edits + test additions
- `driver.ts` rewrite (net -300 LOC after deletes)
- `parity-matrix.test.ts` retarget
- This spec
- `.c3/adr/adr-2026-05-21-pty-tui-shannon.md`

Net change: ~+870 new LOC − ~700 deleted preflight LOC − ~300 deleted driver/test LOC ≈ **net −130 LOC** in `claude-pty/` module.

### Doc updates

- `CLAUDE.md` "Claude Driver Flag" section — rewrite for TUI transport, transcript-file source, trust-dismiss, oneShot `/exit`. Keep "PTY exception #215" notes. Note `encodeCwd` realpath behavior.
- `.c3/` — `/c3 change` after impl for component map.
- New ADR with rationale + spike A findings + Shannon reference.

### Env vars

- **Remove**: `KANNA_PTY_PREFLIGHT_MODEL`
- **Add**: `KANNA_PTY_TRANSCRIPT_WATCH=fs|poll` (default `fs`)
- **Add**: `KANNA_PTY_TRUST_DISMISS=enabled|disabled` (default `enabled`)
- **Add**: `KANNA_PTY_TUI_BOOT_MS=3000` (default 3000)
- **Unchanged**: `KANNA_CLAUDE_DRIVER`, `KANNA_PTY_SANDBOX`, `KANNA_MCP_TOOL_CALLBACKS`, `CLAUDE_CODE_OAUTH_TOKEN`, `KANNA_SERVER_SECRET`

### Rollout order (single PR)

1. Spec doc + ADR
2. `jsonl-path.ts` fix + tests (standalone, low risk)
3. `tui-source.ts` + `tui-control.ts` + tests (new modules, no integration)
4. `smoke-test.ts` + tests
5. `driver.ts` rewrite + parity-matrix retarget + smoke-test integration + delete preflight subdir (atomic cutover commit)
6. `CLAUDE.md` + `.c3/` sync

### Backward compatibility

None. Hard cutover. Release notes must call out: `KANNA_CLAUDE_DRIVER=pty` semantics changed; `KANNA_PTY_PREFLIGHT_MODEL` removed; new env vars listed above.

## Risk register

| ID | Likelihood | Risk | Mitigation |
|---|---|---|---|
| R1 | high | Anthropic changes trust dialog wording → dismiss fails | `KANNA_PTY_TRUST_DISMISS=disabled` env escape; smoke-test catches on cache miss |
| R2 | med | `fs.watch` on Linux NFS/CIFS misses events | `KANNA_PTY_TRANSCRIPT_WATCH=poll` documented; auto-detect after 5s zero events |
| R3 | med | TUI boot race — prompt sent before input box ready | 3s boot delay + ringbuf detect `❯ ` prompt marker; 50ms cycle until detected or 10s timeout |
| R4 | low | Multi-line prompts mangled by `text + \r` | First cut single-line; multi-line is F3 follow-up |
| R5 | low | claude version bump changes session-uuid filename format | smoke-test on binary fingerprint change |
| R6 | low | Subagent spawn latency 3-4x today (~3s → ~9-12s) | Keep oneShot tight; F4 warm-pool if measured pain |

## References

- [`dexhorthy/shannon`](https://github.com/dexhorthy/shannon) — reference architecture (tmux + transcript tail)
- `CLAUDE.md` — Claude Driver Flag, Tool Callback Feature Flag, Kanna-MCP Built-in Shims sections
- `src/server/claude-pty/driver.ts:180` `buildPtyCliArgs` — args block being replaced
- `src/server/claude-pty/jsonl-path.ts:3` `encodeCwd` — bug being fixed
- `src/server/claude-pty/preflight/gate.ts` — module being deleted
- Spike A probe harness — `/tmp/probe-harness.sh`, `/tmp/probe-{1,2,3,4}-transcript.jsonl`
- anthropics/claude-code#59891 — plan mode exit gap (deferred F1)
