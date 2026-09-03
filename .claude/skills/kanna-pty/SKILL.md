---
name: kanna-pty
description: The PTY Claude driver — how Kanna runs the `claude` CLI interactively under a pseudo-terminal and reads the on-disk transcript JSONL as its only event source. Use whenever KANNA_CLAUDE_DRIVER=pty is involved, or the task touches src/server/claude-pty/**, and whenever a symptom points at the TUI: a prompt that never reached claude, a turn that hangs with no transcript line, a paste that got swallowed or truncated, the trust dialog, the smoke test refusing a spawn, turn-end detection on CLI 2.1.x and later, /model or plan-mode toggling, interrupt, OAuth-pool rotation and 401 handling, or any KANNA_PTY_* environment variable. Read it before changing spawn arguments, the transcript follower, or the JSONL-to-HarnessEvent parser, since several behaviours here are workarounds for CLI quirks that look like bugs.
---

# PTY Claude driver (`KANNA_CLAUDE_DRIVER=pty`)

Setting `KANNA_CLAUDE_DRIVER=pty` launches the `claude` CLI **interactively**
under a Bun.Terminal pseudo-terminal (Shannon-style) and tails the on-disk
transcript JSONL at `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`
as the sole event source. Input is sent as raw text + `\r` (no JSONL
envelopes). PTY mode preserves Pro/Max subscription billing; SDK mode
bills at API rates.

Default is `sdk` (no behaviour change). Authentication requires an OAuth-pool
token configured in Kanna settings; the token is injected via
`CLAUDE_CODE_OAUTH_TOKEN`. The local `claude /login` keychain path is not
supported in this deployment. PTY mode is OAuth-only and NEVER uses an API
key: `buildPtyEnv` unconditionally strips `ANTHROPIC_API_KEY` from the
spawned child env. `verifyPtyAuth` only requires the OAuth-pool token.

Platform support: macOS / Linux only.

**Encoded cwd path:** Claude resolves the cwd to its real path
(`fs.realpathSync` — macOS `/var` → `/private/var`), then replaces both
`/` and `.` with `-`. `src/server/claude-pty/jsonl-path.adapter.ts`
(`encodeCwd`, `computeJsonlPath`, `computeProjectDir`) matches this
behaviour exactly. Mismatch = transcript file never found.

**Trust dialog:** TUI claude prompts "Quick safety check: Is this a project
you created or one you trust?" on every previously-unseen cwd. The driver
detects the marker in the PTY output ring buffer and sends `\r` to accept
"Yes, I trust this folder" (the default-highlighted option). Trust persists
across spawns in the same cwd, so the dismiss cost amortises. Set
`KANNA_PTY_TRUST_DISMISS=disabled` to bypass detection (escape hatch if
Anthropic changes the dialog wording).

**TUI ready signal:** Driver polls the output ring for the input-box marker
`❯ ` before sending the first prompt. Hard cap defaults to 3000 ms
(`KANNA_PTY_TUI_BOOT_MS`). **Follow-up turns gate too
(`adr-20260607-pty-followup-tui-ready-gate`):** `sendPrompt` (the interactive
follow-up handler) waits for the same `❯ ` marker + ring-quiet settle before
pasting — after a long previous turn the REPL may still be rendering
(stop-hook summary / turn_duration / context compaction) and silently swallow
a paste, hanging the turn forever with no transcript line (observed: an "Ok"
follow-up that never reached claude). Cap defaults to `KANNA_PTY_TUI_BOOT_MS`,
overridable via `KANNA_PTY_FOLLOWUP_READY_MS`. Best-effort: on cap timeout the
driver warns and pastes anyway, so it is never worse than the prior zero-gate
path. Channel-push delivery (one-shot / keep-alive subagents) is unaffected —
it has its own `channelClientReady` readiness.

**Transcript watch:** `tui-source.adapter.ts` follows the transcript with a
single 50 ms tail-poll (`stat`-size diff read on the append-only JSONL). There
is no `fs.watch` — under Bun it backs to kqueue (macOS) / inotify (Linux), which
coalesced rapid turn-end appends (final `assistant` + `system/turn_duration`
rows) and silently stalled the stream, so it was removed in favour of the
loss-proof poll. See `adr-20260607-adr-20260607-pty-transcript-pure-poll`.

**oneShot subagent close:** After the first `result` transcript entry on a
one-shot run (Claude subagent), the driver sends `/exit\r` to gracefully
close the REPL, awaits `pty.exited` with 5 s grace, then escalates SIGTERM →
SIGKILL on hang. Matches the SDK driver's prompt-queue close semantics.

**Smoke test (replaces preflight P3b):** Every spawn passes through a
single TUI probe that verifies `--disallowedTools Bash` is honored.
Cached 24 h per (binarySha256, model) under
`${HOME}/.kanna/cache/smoke-test/`. PASS unlocks spawn; FAIL refuses
with a clear reason that surfaces through the existing spawn-error
path. The 8-probe preflight gate is removed (`KANNA_PTY_PREFLIGHT_MODEL`
no longer consulted). The probe prompt explicitly forbids tool
alternatives ("reply BASH_UNAVAILABLE … do not use any other tool") —
an open-ended ask lets capable models burn the whole
`waitForResultEntry` budget hunting for Bash substitutes
(ToolSearch / Agent / Glob), which reads as a probe timeout → FAIL.

**PTY turn-end detection (CLI ≥ 2.1.x format change):** Claude CLI
≥ 2.1.x stopped writing `type:"system"` rows (`turn_duration`, `init`,
`compact_boundary`) into the on-disk transcript JSONL. The turn-end
signal is now the final assistant message's `message.stop_reason` —
every persisted row of that message (one row per content block, same
id) carries the same terminal value (`end_turn` / `stop_sequence` /
`max_tokens` / `refusal`; `tool_use` and `pause_turn` mean the turn
continues). `createJsonlEventParser` (`jsonl-to-event.ts`) arms a
pending turn-end on a terminal-stop_reason row and flushes one
synthesized `kind:"result"` on the next line that isn't part of the
same message (claude writes `last-prompt` / `ai-title` / `mode` /
`permission-mode` checkpoint rows right after, so the flush is
prompt). A real `result` / `system/turn_duration` row (SDK fixtures,
older CLIs) supersedes the pending flush, and a duplicate arriving
just after a flush is swallowed — a turn never finalizes twice.
`waitForResultEntry` (`tui-source.adapter.ts`) recognizes the same
three markers. Sidechain rows never count (they end only the
subagent's turn) but DO trigger a pending flush. Known degradations
under the new format: `pendingWorkflowCount` (rode on
`turn_duration`) is no longer available — the pending-workflow wake
hint never arms from PTY transcripts (the `WorkflowRegistry` disk
watch remains the live-run authority); `getSupportedCommands()` never
sees a `system_init` row and stays on its static fallback list.

**AskUserQuestion / ExitPlanMode (issue #215 — CLOSED):** Driver disallows
the native built-ins (`--disallowedTools AskUserQuestion ExitPlanMode`)
and force-registers the `mcp__kanna__ask_user_question` /
`mcp__kanna__exit_plan_mode` shims, which route through the durable
approval protocol to the UI — active regardless of `KANNA_MCP_TOOL_CALLBACKS`.
See the Tool Callback Feature Flag section in `CLAUDE.md` for full wiring.

**setPermissionMode:** Asymmetric.
- ENTER plan (`planMode === true`) sends `/plan\r` and sets an internal
  `localPlanModeActive = true` flag.
- EXIT plan (`planMode === false`) sends `SHIFT_TAB_KEY` (`\x1b[Z`, one
  Shift+Tab press) and clears the flag **when `localPlanModeActive` is
  true** — covers the common case where the driver entered plan mode.
  If the flag is false (plan mode toggled externally via Shift+Tab in the
  UI), a warning is logged and no keypress is sent. Restart the session
  to return to acceptEdits from an unknown state. Tracked:
  anthropics/claude-code#59891.

**setModel:** Sends `/model <name>\r` via the slash command (no stream-json
control_request envelope in TUI mode).

**interrupt:** Sends `Ctrl+C` (0x03) via PTY stdin — TUI claude treats this
as an interactive interrupt, cancelling the current turn.

**getSupportedCommands():** Returns the live slash-command list from the
spawned claude's `system_init` JSONL entry once a session is active.
Falls back to a static four-command list (`model`, `exit`, `clear`, `help`)
before first spawn (cold-start gap). CLI ≥ 2.1.x writes no `system` rows
to the transcript, so on current CLIs the static fallback is permanent.

**SDK ↔ PTY equivalence (Phase 6):** `src/server/claude-pty/parity-matrix.test.ts`
drives both `createClaudeHarnessStream` (SDK) and `createJsonlEventParser`
fed via `startTranscriptStream` (PTY) with the same SDK-message fixtures and
asserts identical `HarnessEvent` sequences. Covers the original 7 cases
unchanged.

**Subagent + prompt + account parity (Phase 5):** unchanged from prior
phases — `buildClaudeSubagentStarter` adapts the SDK-shaped starter to
`StartClaudeSessionPtyArgs` with `oneShot: true`; both drivers append
the shared `KANNA_SYSTEM_PROMPT_APPEND`; PTY derives `AccountInfo` from
the picked OAuth-pool token label + masked key.

**Failure handling:** Every PTY spawn captures terminal output into a 256 KB
ring buffer (`OutputRing` in `output-ring.ts`). Failure synthesis on silent
exit, auth detection (`401`, "Please run /login", "Not logged in"), and
trust-dialog detection all read from this ring. Synthesised error events
feed the same `detectFromResultText` / OAuth-pool rotation path in
`agent.ts` the SDK driver uses.

**Architecture note:** PTY mode parses the on-disk transcript JSONL file
as the sole event source — `src/server/claude-pty/tui-source.adapter.ts`
(`startTranscriptStream`) watches `~/.claude/projects/<encoded-cwd>/`
for the file claude creates on first user prompt, then follows it via a
50 ms tail-poll (`stat`-size diff on the append-only JSONL; no `fs.watch`).
`driver.ts` is a thin coordinator: spawn (via `pty-process.ts`
`spawnPtyProcess` + Bun.Terminal) → trust dismiss → first-prompt send →
pipe transcript lines into `createJsonlEventParser` → emit HarnessEvents.
Nothing reads the PTY stdout for events; the output ring only powers
trust detection + failure synth. Spawn-time `--mcp-config` still wires
the kanna-mcp loopback HTTP server (Phase 2) unchanged.

**OAuth pool rotation (P5):** PTY mode honors the same multi-token rotation
the SDK driver uses. `AgentCoordinator` picks an active token from
`OAuthTokenPool` per chat and the PTY driver injects it via the
`CLAUDE_CODE_OAUTH_TOKEN` env var. Auth failures (401 detected in the
output ring) synthesise an `oauth_invalid_token` result event that feeds
the same rotation/retry path the SDK driver uses on thrown stream errors.

## Env vars (PTY-specific)

- `KANNA_CLAUDE_DRIVER=sdk|pty` — driver selector (default `sdk`).
- `KANNA_MCP_TOOL_CALLBACKS=1` — route built-in shims through durable approval.
- `KANNA_PTY_TRUST_DISMISS=enabled|disabled` — trust-dialog dismiss (default `enabled`).
- `KANNA_PTY_TUI_BOOT_MS=3000` — hard cap on TUI-ready wait (default `3000`).
- `KANNA_PTY_FOLLOWUP_READY_MS` — hard cap on the follow-up-turn TUI-ready
  gate in `sendPrompt` (default = `KANNA_PTY_TUI_BOOT_MS` / 3000). On timeout
  the driver warns and pastes anyway.
- `KANNA_PTY_SESSION_END_GRACE_MS=5000` — grace period (ms) between `/exit`
  and SIGTERM during session close (default `5000`). The SessionEnd hook fires
  in this window; increase if your SessionEnd hook takes longer. Sessions whose
  Claude process exits before the deadline skip SIGTERM entirely. Supervisord
  users should set `stopwaitsecs` ≥ this value + 10 so Kanna can shut down
  gracefully without being SIGKILL'd by supervisord.
- `CLAUDE_CODE_OAUTH_TOKEN` — set by driver from pool, NOT a user env var.
- `KANNA_PTY_CHANNEL_DELIVERY=enabled|disabled` — for one-shot (subagent) PTY
  spawns, deliver the prompt via a `notifications/claude/channel` push instead
  of typing it into the TUI (default `enabled`). Avoids the multi-line
  bracketed-paste collapse that silently truncated subagent prompts. Requires
  the account's channel feature enabled. Fail-fast: if the channel client is
  not ready within `KANNA_PTY_CHANNEL_READY_TIMEOUT_MS` the spawn fails with a
  clear error — there is NO silent paste fallback. Set `disabled` to revert
  subagent spawns to the legacy paste path. Adds
  `--dangerously-load-development-channels server:kanna` to subagent spawns and
  appends channel framing to the subagent system prompt.
- `KANNA_PTY_CHANNEL_READY_TIMEOUT_MS=15000` — channel client-ready timeout
  before a subagent spawn fails fast (default `15000`).

Removed in this version (no longer consulted):
- `KANNA_PTY_PREFLIGHT_MODEL` — preflight gone, replaced by smoke-test.
- `KANNA_PTY_SANDBOX` — sandbox already removed in a prior change; flag now inert.
- `KANNA_PTY_TRANSCRIPT_WATCH` — `fs.watch` removed; the follower always polls
  (`adr-20260607-adr-20260607-pty-transcript-pure-poll`).
