# Architecture

This project uses C3 docs in `.c3/`.

**MANDATORY for Claude Code AND Codex:**
1. **Before coding** — run `/c3 query <topic>` (or `c3x lookup <file>`) to load
   component context, refs, and rules. Do NOT skip even for "small" edits.
   Skipping = stale assumptions = wrong patches.
2. **After coding** — if change touches component boundaries, refs, public
   contracts, or rules, run `/c3 change` (or `/c3 sweep` for audit) to update
   `.c3/` docs in the SAME PR. Code-doc drift is a blocker.
3. **Architecture questions, audits, file→component lookup** — always `/c3`.

Operations: query, audit, change, ref, sweep.
File lookup: `c3x lookup <file-or-glob>` maps files/directories to components + refs.
Skill: `c3-skill:c3` (auto-triggers on `/c3` or architecture phrases).

**`c3x repair` rewrites unrelated docs — do not commit that churn.** It
re-canonicalizes every fact it loads and strips inline-code backticks from
markdown TABLE CELLS (`\`bun run lint\`` → `bun run lint`), then re-seals the
file. On this repo that touches ~5 docs and ~43 rows that the current change
never went near. It is formatting-only — no text, globs, or emphasis are lost —
but it buries a real diff in noise. `.c3/c3.db` is gitignored, so the canonical
markdown is the source of truth: after `repair`, `git checkout --` any doc your
change did not intend to touch. Upstream fix belongs in the c3 skill's table
serializer.

# Pull Requests

This is a fork. `origin` = `cuongtranba/kanna` (mine), `upstream` = `jakemor/kanna`.
PRs MUST target `cuongtranba/kanna`, never `jakemor/kanna`.
`gh repo set-default cuongtranba/kanna` is set; always pass `--repo cuongtranba/kanna`
or `--base main --head <branch>` to `gh pr create` to make the target explicit.

# TypeScript (dual install: TS7 compiler + TS6 API for tooling)

Type checking runs on **TypeScript 7** (native compiler). typescript-eslint
has no TS7-compatible release yet (TS7 dropped the compiler JS API from
`require('typescript')` — it now exports only `{version}`; the API moved to
`typescript/unstable/*`), so two TypeScript packages are installed:

- `"typescript": "6.0.3"` — classic TS6 with the full legacy JS API
  (`createProgram`, `ModuleKind`, …) that typescript-eslint's parser loads
  via `require('typescript')`. Peer range `<6.1.0` is satisfied.
- `"typescript-7": "npm:typescript@^7.0.2"` — the real TS7 compiler used for
  the actual type check.

Both packages ship a `tsc` bin, so **never** rely on bare `tsc` / `bunx tsc`
(the `.bin/tsc` link is ambiguous). The `typecheck` script invokes TS7 by
explicit path (`node_modules/typescript-7/bin/tsc --noEmit`); CI's Type-check
step and the local `check` script both call `bun run typecheck`. When
typescript-eslint ships TS7 support, collapse back to a single `typescript`
dep and restore `bunx tsc`.

# Lint

`bun run lint` runs ESLint on `src/` with `--max-warnings=0`. CI runs it
before tests; merges blocked on lint errors AND on any warning count above
the cap. The cap is a ratchet: when warnings drop, lower the cap in the
same PR so they cannot creep back up. Plugin `react-hooks` (set 7+) enforces
React 19 rules: `rules-of-hooks`, `purity`, `globals` are errors;
`set-state-in-effect`, `refs`, `immutability`, `preserve-manual-memoization`,
`exhaustive-deps` are warnings.

# Side-Effect Lint (ports-and-adapters seal)

Side effects (`node:fs`, `chokidar`, `bun:sqlite`/`better-sqlite3`/`pg`,
`node:child_process`, `node:http`/`https`, `Bun.spawn`/`Bun.$`/`Bun.file`,
`new Database`, `process.exit`, `process.env`) are **sealed at `error`
across both `src/shared/**` + `src/client/**` AND `src/server/**`
production code**.

`no-restricted-imports` + `no-restricted-globals` + `no-restricted-syntax`
in `eslint.config.js` make every flagged import / global / call fail
`bun run lint`. Browser-native `fetch` is intentionally allowed in
shared/client. There is no escape valve; do not add `eslint-disable`
comments.

**Server layer exempt globs** (where direct IO is allowed):
`src/server/**/*.test.ts(x)`, `src/server/__fixtures__/**`,
`src/server/test-helpers/**`, `src/server/adapters/**`, and any file
matching `src/server/**/*.adapter.ts`.

**`.adapter.ts` filename convention.** Any file whose single
responsibility is to perform the side effect on behalf of a port
interface MUST be suffixed `.adapter.ts` and colocated next to its
port. Mixed-concern modules (domain logic + IO) extract their IO into
a sibling `*-io.adapter.ts` instead of renaming the parent.

**Adding new IO.** New IO requires either (1) putting the call in a
file matching one of the exempt globs above, or (2) injecting the
operation through a typed parameter / port interface. Adapter files
are leaf modules — they wrap one node/Bun primitive and have no
domain logic, so they are safe to import from anywhere that needs
the operation.

Authored across PRs #283 (pure-layer seal), #285 (paths-config
purify), #286 (call-site selectors), #287 (ratchet infrastructure),
#288–#302 (burn-down 90 → 0), and the final flip (server override
moved to `error` + ratchet tooling deleted).

# Design System (MANDATORY)

`DESIGN.md` (repo root) is the single source of truth for Kanna's visual
system — the warm rose-tinted OKLCH palette (hue ~13°), the Body / Bricolage
Grotesque / Roboto Mono type pairing, and all named rules. Live tokens are
defined in `src/index.css` and consumed as Tailwind theme vars
(`bg-background`, `text-foreground`, `text-destructive`, `bg-warning`, …).
**Load `DESIGN.md` before any `src/client/**` UI work.**

**Hard gate (enforced, `bun run lint --max-warnings=0`).** `eslint.config.js`
`DESIGN_GATE_SYNTAX` (applied to `src/shared/** + src/client/**` via
`no-restricted-syntax`) bans:

1. **Arbitrary hex Tailwind utilities** (`bg-[#…]`, `text-[#…]`, `border-[#…]`,
   …) — use a token class instead.
2. **Raw hex color literals** — 6/8-digit (`#rrggbb`, `#rrggbbaa`) plus the
   pure black/white family (`#000`/`#fff`/`#000000`/`#ffffff`). 3-digit hex is
   NOT banned generally (it collides with issue refs like `#333` inside string
   literals); only the black/white forms are. Use CSS vars / token classes.
3. **`backdrop-blur` / `backdrop-filter`** (No-Glassmorphism Rule) — use a solid
   `bg-background` surface.
4. **Native `title` on intrinsic elements** — use the project Tooltip
   (`src/client/components/ui/tooltip.tsx`) via the `TruncatedText` /
   `HoverHint` helpers in `src/client/components/ui/truncated-text.tsx`.
   `iframe` is excluded (its `title` is the WCAG accessibility name, not a
   tooltip); PascalCase component props named `title` are not matched.

**Sanctioned chokepoint:** `src/client/components/chat-ui/TerminalPane.tsx` is
exempt from rule 2 only (xterm's `ITheme` API takes hex strings, not CSS vars).
No other exemptions; do not add `eslint-disable` comments.

**Guidance-only (NOT linted — semantic, would false-positive).** Follow by
hand:
- No pulse/glow on status **dots** (`animate-pulse` is fine for skeletons/
  typeaheads).
- Kanna Coral on ≤10% of a screen; brand mark + destructive intent only.
- `tabular-nums` on every duration / count / age / pid / live ticker.
- Flat by default; depth via contrast + 1px soft edge, not shadow.
- Pair color with icon / label / weight; color alone never communicates.

The `impeccable` PostToolUse design hook also flags off-ramp font sizes and
other heuristics; those are advisory, not part of this lint gate.

# Render-loop regression checks

When introducing a new `use*Store` selector or any React hook that derives
collections, the selector MUST return a stable reference. Inline `?? []` or
`?? {}` produces fresh refs each call and triggers React error #185
(`Maximum update depth exceeded`). Pattern to use:

```ts
const EMPTY: Subagent[] = []
useStore((state) => state.list ?? EMPTY)
// or
useStore(useShallow((state) => state.list ?? []))
```

Tests can mount a component with effects and assert no loop warnings via
`renderForLoopCheck` in `src/client/lib/testing/`.

**Hard AST gate (ast-grep, wired into CI via `bun run lint:usestate`).**
Two rule pairs in `rules/` (tsx + `-ts` typescript variants, tests in
`rule-tests/`, run `bunx ast-grep test`) ban the React #185 class at
`severity: error`:

- `no-unstable-hook-fn-arg` — an inline arrow/function passed as a
  direct argument to ANY custom hook (`use[A-Z]...`). A hook that keys
  an internal effect on that argument re-runs the effect every render
  (react-use-websocket's reconnect effect on its url arg caused PR
  #561's flushSync loop). Bind with `useCallback`/`useMemo` or hoist.
  Safe-list (exempt): React built-ins that ref-stash or read the arg
  once (`useMemo`/`useCallback`/`useEffect`/`useLayoutEffect`/
  `useInsertionEffect`/`useImperativeHandle`/`useState`/`useReducer`/
  `useRef`), `useShallow`, and zustand `use*Store` selectors.
  `useSyncExternalStore` stays FLAGGED (inline subscribe resubscribes
  every render). A hook proven to ref-stash its callbacks may be added
  to the safe-list regex in both rule variants, in the same PR.
- `no-unstable-selector-fallback` — a `use*Store` selector returning
  inline `?? []` / `?? {}` (or `|| []` / `|| {}`) without `useShallow`.

Two further rules keep state TRANSITIONS in the store (ADR
`adr-20260802-ban-jsx-inline-state-logic`, `rule-zustand-store`). Both are
**tsx-only on purpose** — `jsx_attribute` does not exist in the typescript
grammar, so a `-ts` twin is impossible, not merely redundant; do not "fix"
the missing pair:

- `no-jsx-inline-state-updater` — a functional updater (`setX((prev) => …)`)
  passed to a `set*` call inside a JSX attribute. Replace the updater-shaped
  setter with a named action that derives the previous value INSIDE the
  store, then delete the setter from the state interface.
- `no-jsx-inline-state-logic` — an inline JSX-attribute arrow that calls a
  mutation-shaped identifier and is more than a single call (a block body
  with 2+ statements, or a lone `if_statement`). Two remedies, chosen by
  what the handler closes over: a PURE transition becomes one named store
  action; orchestration over props, refs, or async I/O becomes an extracted
  `useCallback` — stores never absorb props, refs, or I/O, and a `useRef`
  stays a `useRef`. The callee regex is deliberately broader than
  `^set[A-Z]` (it covers `toggle|clear|reset|open|close|…`) because migrated
  actions carry those verbs; introducing a NEW action verb means extending
  the regex AND adding a `rule-tests/` case in the same PR. Never silence a
  false positive with an `ignores` entry — extract the handler, or add a
  `not:` clause plus a pinning fixture.

# React Frontend Rules (MANDATORY when touching src/client)

When editing or adding React code under `src/client/**`:

1. **Reference stability first.** Any value passed to a hook that feeds
   effect deps (urls, configs, selectors, derived collections) MUST be
   reference-stable across renders: hoisted constant, module-level
   `EMPTY`, `useMemo`/`useCallback`, or `useShallow`. Never an inline
   arrow/object/array where a library effect-keys on it.
2. **Hook callbacks are gated generically.** `no-unstable-hook-fn-arg`
   already flags inline functions to any custom hook. Never weaken it by
   safe-listing a hook without proof it ref-stashes its callbacks; for a
   NEW anti-pattern shape (not a fn-arg), add a rule pair in `rules/` +
   test in `rule-tests/` in the SAME PR — a doc note alone is not a gate.
3. **Loop-check tests.** Components with effects that write stores should
   be covered by `renderForLoopCheck` (`src/client/lib/testing/`).
4. **Verify before done:** `bunx ast-grep test`, `bun run lint:usestate`,
   `bun run lint`, and for UI behaviour changes open the browser.

# Tool Callback Feature Flag (KANNA_MCP_TOOL_CALLBACKS)

Setting `KANNA_MCP_TOOL_CALLBACKS=1` routes `AskUserQuestion` and
`ExitPlanMode` through the durable approval protocol in
`src/server/tool-callback.ts`. Pending requests survive server restart
(resolved as `session_closed` fail-closed on boot) and are replayed to the
client on reconnect as `pending_tool_request` transcript entries. Default is
off; the SDK driver uses the legacy `canUseTool` → `onToolRequest` path.

**PTY exception (issue #215):** under `KANNA_CLAUDE_DRIVER=pty` the
`ask_user_question` / `exit_plan_mode` shims are **always registered**
regardless of this flag — the PTY driver passes
`forceInteractiveToolCallbacks: true` to `buildKannaMcpTools` because
PTY has no `canUseTool` hook (the durable approval protocol is the only
host path). The PTY CLI args also include
`--disallowedTools AskUserQuestion ExitPlanMode` so the model cannot
pick the native built-ins (which the CLI auto-rejects with
`is_error: "Answer questions?"`, mis-read as a user cancel). The flag
still **exclusively** gates the 8 built-in shims
(`read/glob/grep/bash/edit/write/webfetch/websearch`) and the SDK
driver's `canUseTool` routing — those are never force-enabled under PTY.

## Pending-tool lifecycle (legacy `canUseTool` path — PendingToolSlots)

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

# Claude Driver Flag (KANNA_CLAUDE_DRIVER)

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
`/` and `.` with `-`. `src/server/claude-pty/jsonl-path.ts`
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
(adr-20260607-pty-followup-tui-ready-gate):** `sendPrompt` (the interactive
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
loss-proof poll. See `adr-20260607-pty-transcript-pure-poll`.

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
See the Tool Callback Feature Flag section for full wiring.

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
as the sole event source — `src/server/claude-pty/tui-source.ts`
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

**Env vars (PTY-specific):**
- `KANNA_CLAUDE_DRIVER=sdk|pty` — driver selector (default `sdk`).
- `KANNA_MCP_TOOL_CALLBACKS=1` — route built-in shims through durable approval.
- `KANNA_PTY_TRUST_DISMISS=enabled|disabled` — trust-dialog dismiss (default `enabled`).
- `KANNA_PTY_TUI_BOOT_MS=3000` — hard cap on TUI-ready wait (default `3000`).
- `KANNA_PTY_FOLLOWUP_READY_MS` — hard cap on the follow-up-turn TUI-ready
  gate in `sendPrompt` (default = `KANNA_PTY_TUI_BOOT_MS` / 3000). On timeout
  the driver warns and pastes anyway.
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
  (`adr-20260607-pty-transcript-pure-poll`).

# Builtin slash commands — `/clear` and `/compact [instructions]`

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

## `CompactionTurnKind` — one field, two questions

`ActiveTurn.compactionTurn` is `"proactive" | "user" | "codex_summary"` (it
replaced the boolean `proactiveCompactInjection`). Two predicates read it, and
they are deliberately different:

- `isCliCompactTurn` — gates the PTY `compact_boundary` finalize
  (`adr-20260608-pty-compact-boundary-dequeue-finalize`). Covers `proactive` AND
  `user`: both reach the CLI verbatim, so both go quiet the same way.
- `isProactiveCompactTurn` — gates the `compactFailureCount` circuit breaker and
  the `message.dequeue` refusal. `proactive` only. Both exist to bound Kanna's
  **own** automatic injection; a user-typed `/compact` owns no queued message
  and must not consume that budget.

## History primer is scoped to the last context reset

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
`LocalCatalogService.list` (whose contract stays the disk catalog), and
`commandsForProvider` narrows the list to builtins-only on codex — disk-scanned
Claude Code skills mean nothing to a provider that does not run the claude CLI.
A project-authored `.claude/commands/clear.md` is dropped from the listing
because dispatch intercepts that name first; rename it.

See `adr-20260811-builtin-clear-compact-commands`.

# Mermaid Validation Gate (KANNA_MERMAID_GUARD)

Kanna renders mermaid inline, so a syntax error reaches the user as a broken
diagram. **The model's diagrams are validated against mermaid's real parser
before they can stand.** Two layers, deliberately covering each other:

- **`mcp__kanna__validate_mermaid`** (in-turn, proactive). The model calls it
  with a diagram source and gets back `VALID`, or an `isError` result carrying
  the offending line, mermaid's caret excerpt, and a hint. It self-corrects in
  the same turn — no extra turn, and the user never sees the bad version.
  Registered whenever a `chatId` is present (subagents included); one `tool()`
  call covers both drivers via `kanna-mcp-http.ts`.
- **End-of-turn guard** (`src/server/mermaid-guard.ts`, reactive backstop). At
  the runner's success finalize (`claude-session-runner.ts`, after
  `recordTurnFinished`, **before** `maybeStartNextQueuedMessage` so the drain
  picks up what it enqueues) the server re-reads the turn's `assistant_text`,
  extracts ```mermaid fences and validates them. On a real failure it enqueues
  one correction prompt via `enqueueMessage` with a synthetic
  `autoContinue.scheduleId` — the `wakeBackgroundTaskSession` shape, NOT
  `deliverSubagentToMain`'s: **no `/clear`**, because the model needs the
  diagram still in context to fix it.

**The guard's bounds are load-bearing, not defensive.** It fires only when the
reader would actually see an error — a diagram `repairMermaidSource` saves
renders with the "Corrected …" banner, so spending a turn on it buys nothing.
It asks about a given diagram **exactly once** per chat (bounded memory, 32
sources), because a model that cannot fix its own diagram would otherwise be
asked every turn forever. It stands aside when a user message is queued, skips
errored/cancelled turns, and swallows its own failures — a diagram is cosmetic,
a dead turn is not. `KANNA_MERMAID_GUARD=disabled` turns the backstop off; the
tool stays.

**Server-side mermaid, without a new dependency.**
`src/server/mermaid-parse.adapter.ts` is the only place mermaid loads on the
server. mermaid is a browser library, so the adapter installs a ~20-line
measured-minimum DOM surface **only around `await import("mermaid")`** and
restores it in a `finally` — nothing downstream can sniff `window` and take a
browser code path. `installDomShim` stands down entirely when a real `document`
exists (the happy-dom the test preload registers process-wide). ~9 ms per
parse, every diagram type. Rejected: happy-dom as a prod dep (it swaps
`fetch`/`FormData`/`Blob` — see `scripts/test-preload.ts` undoing exactly that)
and a child process (~200 ms spawn for a 9 ms parse). The adapter's suite
includes a **subprocess test with no happy-dom** — the only thing that proves
the gate works where it runs; without it a broken shim would pass CI and
silently disable validation.

**Layout.** The pure pieces live in `src/shared/`: `mermaid-fences.ts` (the ONE
definition of a fence — the Lexical `MERMAID_FENCE` transformer consumes it, so
the editor and the guard can never disagree about where a diagram ends),
`mermaidError.ts`, `mermaid-hints.ts` (error signature → advice; **advice only,
never a rewrite**), `mermaid-validate.ts`, `mermaid-report.ts` (the wording both
surfaces speak), `mermaidRepair.ts`. `mermaid-validation.ts` holds the contract,
including `MermaidParsePort` — no domain module imports mermaid.

**Prompt drift is a build failure.** `KANNA_SYSTEM_PROMPT_BASE` carries the
same knowledge as the repair table, and the two drifted for four releases (the
prompt named `()` and `[]{}` while the failure users hit was a `/`-leading path
label). `src/shared/mermaid-prompt-drift.test.ts` asserts the prompt mentions
every `LINK_RULES_FOR_PARITY` rule, every character that forces a quoted label,
and the tool name. It gates COVERAGE, not prose — reword freely, but a rule the
repair knows must be one the prompt warns about.

**The grammar fact this all rests on** (mermaid 11.15.0,
`flowDiagram-I6XJVG4X.mjs` rule 116): the only plain-text run inside the `text`
lexer state is `/^(?:[^\[\]\(\)\{\}\|\"]+)/`, so an unquoted label is readable
iff it holds none of `[ ] ( ) { } | "`. Rule 95 (`[/`) longest-match-beats plain
`[` and pushes `trapText`, which closes only on `/]` or `\]` — that is why
`Current[/opt/app/current symlink]` dies. Rule 24 (`"`) is present in every
state, so quoting is the universal escape; a literal `"` is written `#quot;`.

# Kanna-MCP Built-in Shims

When `KANNA_MCP_TOOL_CALLBACKS=1`, kanna-mcp registers 8 additional tools
that mirror Claude's built-ins: `mcp__kanna__{read, glob, grep, bash, edit,
write, webfetch, websearch}`. They route through the durable approval
protocol with the same path-deny rules as the bash tool from P1 (readPathDeny
for `read`/`glob`/`grep`, writePathDeny for `edit`/`write`).

These shims are inert until the PTY driver applies `--tools "mcp__kanna__*"`
(P3b — landing in a follow-up PR). With the SDK driver (default), the model
still uses its native built-ins and these shims sit unused.

`websearch` is a stub that always returns `isError: true` — real web search
needs an external API integration which is out of scope for P3a.

# Custom MCP Servers

Users register MCP servers via Settings → "MCP servers". Entries persist
in `settings.json` under `customMcpServers` (file mode 0600) and are
merged into both Claude drivers at chat spawn time:

- **SDK driver** (`agent.ts`): `buildUserMcpServers` maps each enabled
  entry to the SDK's per-transport config and merges it into the
  `mcpServers` map passed to `query()` alongside `mcp__kanna__*`.
- **PTY driver** (`kanna-mcp-http.ts:buildMcpConfigJson` +
  `claude-pty/driver.ts`): entries serialize into the same
  `mcp-config.json` the driver hands to `--strict-mcp-config`. Kanna
  settings remain the single source of truth; `~/.claude.json` stays
  ignored.

User MCP tool calls auto-allow (`canUseTool` already returns
`{ behavior: "allow" }` for any tool that isn't `AskUserQuestion` /
`ExitPlanMode`, which includes every `mcp__<name>__*` whose `<name>`
isn't `kanna`). Trust model: if the user installed it, they trust it.

Supported transports: `stdio`, `http`, `sse`, `ws`. Reserved name:
`kanna`. Names match `^[a-zA-Z][a-zA-Z0-9_-]{0,31}$` and form the tool
prefix `mcp__<name>__<tool>`.

**Connect-test:** on create/update, `ws-router.ts` fires a fire-and-
forget `validateMcpServer` (`src/server/mcp-validator.ts`, 10s timeout,
list-tools probe) and persists `lastTest` on the entry. The UI shows a
per-row status pill plus a manual "Test" button that drives the
explicit `settings.testMcpServer` RPC.

**Boundary rule:** user MCP server names MUST NOT equal
`KANNA_MCP_SERVER_NAME`. Enforced by both `validateMcpShape`
(`app-settings.ts`) and `buildUserMcpServers` / `buildMcpConfigJson`
filters (belt-and-suspenders).

## Custom MCP Servers → OAuth

OAuth 2.1 (PKCE + DCR + rotating refresh) is supported for `http` and `sse`
transports only. The flow is explicit discovery rather than SDK auto-discovery:
the SDK's `auth.js` `discovery()` helper follows RFC8414
(`<issuer>/.well-known/oauth-authorization-server`) but some servers (e.g.
Anthropic design MCP) serve the AS metadata only at the OpenID path
(`<issuer>/.well-known/openid-configuration`), returning the claude.ai SPA
HTML at the RFC8414 path — breaking auto-discovery. `mcp-oauth.adapter.ts`
probes the OpenID path first, then falls back to RFC8414.

**Two-step paste UX.** Kanna has no redirect server, so after the AS redirects
the browser to `http://localhost:3334/callback?code=…`, the user copies that
URL from the browser address bar and pastes it into the Settings UI. The
`completeMcpOAuth` WS command exchanges the code via PKCE and stores tokens.

**Token lifecycle.** `ensureFreshMcpToken` (called at chat spawn) pre-fetches a
fresh access token if the current one is within 60 s of expiry. Rotating
refresh tokens are persisted back via `persistOAuthState`. The access-token TTL
is determined by the AS (Anthropic design MCP issues 8 h tokens) — but refresh
extends the session indefinitely, so the 8 h is not a re-auth interval.
`completeMcpOAuth` persists the resolved AS `metadata` (`token_endpoint`) onto
`McpOAuthState.metadata`; `ensureFreshMcpToken` uses it
(`metadataByIssuer?.[issuer] ?? oauth.metadata`) so `refreshAuthorization` hits
the cached `token_endpoint` directly and never re-discovers from `issuer` (which
may be a non-resolvable resource URL like `https://claude.ai/v1/design/mcp` —
re-discovery there returns SPA HTML and was the cause of "token refresh failed"
forcing an 8 h re-auth; see adr-20260630-mcp-oauth-refresh-metadata). Entries
authenticated before this fix lack persisted metadata and must re-auth once.

**Storage.** OAuth state (`clientByIssuer`, `tokens`, `issuer`, `metadata`, `flow`) is
stored inside the server entry in `settings.json` (file mode 0600). The
`flow` field is present only mid-flow and cleared on complete or cancel.
DCR results are keyed by AS issuer to avoid re-registering if the same AS
serves multiple servers.

**Bearer injection.** At spawn, `AgentCoordinator.buildOAuthBearers` iterates
enabled network servers, calls `ensureFreshMcpToken` (refresh if needed, then
return the access token), and builds a `ReadonlyMap<serverId, token>`. Both
`buildUserMcpServers` (SDK driver) and `buildMcpConfigJson` (PTY driver) merge
`Authorization: Bearer <token>` into the transport headers for that server.
`validateMcpServer` also accepts an optional `bearer` for the manual "Test"
action on OAuth servers.

# Configurable Model Catalog (customModels)

Claude + Codex models are user-configurable from Settings → "Models" instead
of being hardcoded. Entries persist in `settings.json` under `customModels`
(seeded on first load from the built-in `PROVIDERS` list) and merge into the
effective catalog at read time.

- **Single source of truth.** `PROVIDERS` in `src/shared/types.ts` is the only
  built-in catalog. `src/server/provider-catalog.ts` `SERVER_PROVIDERS` is
  `[...PROVIDERS]` — the former duplicate `HARD_CODED_CODEX_MODELS` was
  removed (it drifted).
- **Merge.** `mergeCustomModels(base, customModels)` (pure, in `types.ts`)
  folds each `CustomModelEntry` over its provider's model list: same `id`
  **overrides** the built-in in place, a new `id` is **appended**. `base`
  built-ins always remain as a fallback, so the catalog is never empty.
- **Seed + revert-to-default.** `normalizeCustomModels` (`app-settings.ts`)
  seeds `customModels` from built-ins (deterministic `createdAt/updatedAt = 0`)
  when the persisted value is absent, making every built-in an editable copy in
  the UI. Deleting a seeded copy removes the override, so the identical
  built-in shows through again (revert-to-default); deleting a purely-custom
  id removes it entirely.
- **CRUD.** `AppSettingsPatch.customModels` carries `create | update | delete`,
  handled by the settings reducer (mirrors `customMcpServers`), validated by
  `validateCustomModelShape` (id regex, non-empty label, provider ∈
  {claude,codex}, dedupe per provider). Rides the existing
  `handleWriteAppSettings` RPC — no new endpoint.
- **Transport.** `deriveChatSnapshot` (`read-models.ts`) emits
  `availableProviders: mergeCustomModels([...SERVER_PROVIDERS], customModels)`
  (customModels threaded from `AppSettingsManager` at the `ws-router.ts` call
  site) — the per-chat snapshot is the single server→client catalog transport.
  `normalizeServerModel(provider, model, customModels)` accepts custom ids at
  turn time. Client: `selectCustomModels` selector (stable `EMPTY` ref) +
  `ModelsSection.tsx` CRUD UI; the Settings-page default-model pickers derive
  `mergeCustomModels([...PROVIDERS], customModels)`. Both `mergeAppSettingsPatch`
  copies (client store + `ws-router` fallback) pin `customModels` so the CRUD
  patch shape never leaks over the array.
- **Scope.** OpenRouter untouched (already dynamic via API). Providers
  themselves are not add/removable — models only.

# Codex Failure Classification (`codexErrorInfo` + `willRetry`)

A failed Codex turn carries a machine-readable reason, not just prose. Kanna
reads both fields the app-server sends and stops guessing from error strings.

**Regenerate the protocol truth, never infer it.** `codex app-server
generate-ts --out <dir>` emits the authoritative bindings; `v2/TurnError.ts`
and `v2/CodexErrorInfo.ts` are the source for
`src/shared/codex-error-classification.ts`. The app-server exposes these in
**camelCase** (`codexErrorInfo`, `serverOverloaded`); the snake_case spellings
in Codex's own rollout JSONL under `~/.codex/sessions/**` are a DIFFERENT,
internal format. Reading the rollout and typing the wire from it produces a
field that never matches — check the generated bindings.

- **One classification table.** `FAILURE_CLASS_BY_TAG` maps every variant to
  `transient | quota | auth | fatal | unknown`; `CodexErrorInfoTag` is derived
  from that table's keys, so a variant cannot be classified without existing.
  An unknown or absent tag classifies `unknown`, **never** `transient` — a
  future variant must not silently earn a retry affordance.
- **Two readers, deliberately asymmetric.** `codexErrorInfoTag` parses the WIRE
  and rejects an object variant spelled as a bare string. `classifyCodexFailure`
  / `isRetryableCodexFailure` / `describeCodexFailure` take
  `CodexFailureInput = CodexErrorInfo | CodexErrorInfoTag`, because they also
  read back the already-flattened tag Kanna persisted itself. Collapsing the two
  makes an object variant (`responseStreamDisconnected`, `httpConnectionFailed`,
  `activeTurnNotSteerable`) classify `unknown` on the round trip.
- **Transport carries facts, UI owns wording.** `handleTurnCompleted` /
  `failContext` put the flattened tag on `ResultEntry.codexErrorInfo` and leave
  `result` as the provider's raw sentence. `ResultMessage` renders
  `describeCodexFailure(...)` and offers **Retry** only when
  `isRetryableCodexFailure`. No description for a tag → the raw sentence still
  shows, so an unmapped variant degrades to today's behaviour.
- **The retry callback must stay reference-stable.** `handleRetryFailedTurn`
  reaches every memoized transcript row and the row comparator checks its
  identity, so it reads `messages` + the submit fn through a ref and keeps `[]`
  deps. Depending on `state.messages` directly re-renders the whole transcript
  on every streamed chunk.

**`willRetry` is load-bearing — do not drop it again.** `ErrorNotification`
carries `{error, willRetry}`. `willRetry: true` means Codex is reconnecting on
its own and the turn is STILL LIVE; `handleNotification` must return without
calling `failContext`. Failing the turn there kills one that would have
recovered — it surfaced to users as a turn dying with the literal text
`Reconnecting... 1/5`. Absent `willRetry` (older app-server) reads as terminal.
Trade-off accepted: a `willRetry: true` never followed by a terminal event
leaves the turn hanging where it previously failed fast; Codex bounds its own
retries and Stop still works.

Not wired: `quota` (`usageLimitExceeded`) does not arm auto-continue —
`CodexErrorInfo` carries no reset timestamp, so that needs Codex's separate
`rate_limits` event. `CodexLimitDetector` still only fires on a THROWN stream
error (`claude-turn-runner.ts` catch branch); a `turn/completed` failure never
reaches it, which is why c3-227's documented precondition ("a Claude or Codex
turn emits a result event with subtype: error") is still only half true.

# Subagent Delegation (Anthropic Task-tool pattern)

The main agent is always in the loop. `@agent/<name>` in chat input is a
**hint**, not server-side routing — it no longer short-circuits the main
turn. The main model decides whether to delegate and calls
`mcp__kanna__delegate_subagent({ subagent_id, prompt })`. The tool blocks
until the run finishes and returns the subagent's final reply as text;
the main model then synthesizes it into its own response.

- **Roster injection:** `buildKannaSystemPromptAppend(subagents)` in
  `src/shared/kanna-system-prompt.ts` builds a dynamic system-prompt
  suffix listing every configured subagent's `name`, `id`, and
  `description`. Computed per-spawn in `agent.ts` and passed to both
  drivers (SDK via `systemPrompt.append`, PTY via
  `--append-system-prompt`). Truncated at 20 entries by `updatedAt`
  descending; remainder surfaced as "(N more subagents omitted ...)".
- **MCP tool:** registered in `kanna-mcp.ts` only when the spawn
  supplies both `subagentOrchestrator` AND `delegationContext`. Main
  spawns supply `depth: 0`, `ancestorSubagentIds: []`, `parentRunId:
  null`. Subagent spawns (sub-spawn-sub) supply the caller's own
  context so cycle / depth checks apply — `LOOP_DETECTED` when the
  target appears in the ancestor chain, `DEPTH_EXCEEDED` when
  `depth > maxChainDepth` (default 1, configurable on the orchestrator).
- **`SubagentOrchestrator.delegateRun(args)`:** public async API that
  awaits a single run and returns `DelegationOutcome` —
  `{status:"completed", text}` or `{status:"failed", errorCode, errorMessage}`.
  Used by the MCP tool; also exposed via
  `AgentCoordinator.getSubagentOrchestrator()` for tests.
- **Cancellation:** `cancelChat` / `cancelRun` cascade through delegated
  runs as before. Each `delegateRun` registers a `RunState` and obeys
  the same permit / timeout / abort wiring as the legacy
  mention-triggered path.
- **Backwards compat:** `parseMentions` still runs inside the normal
  `appendUserPrompt` path so `subagentMentions` metadata stays on
  `user_prompt` entries for UI badges and analytics. The assistant-text
  mention scan and the `chat_send` / dequeue short-circuits are removed.

## Subagent spawn gate — parity with the main chat (adr-20260805-subagent-spawn-gate-parity)

`SubagentOrchestrator` fails a run `AUTH_REQUIRED` when `ProviderRunStart.authReady()`
returns false. For claude that predicate is `claudeAuthReady(pool, chatId)`
(`provider-catalog.ts`), and it is the **single definition of the Claude spawn
gate**:

```ts
if (!pool || !pool.hasAnyToken()) return true  // local claude CLI credentials
return pool.hasUsable(reservedFor)
```

**An OAuth-pool token is required only once the user has configured one.** With
`claudeAuth.tokens: []` the driver falls through to the local `claude` CLI
credentials, exactly as `claude-session-spawner.ts` / `quick-response.ts` do
(their `hasAnyToken() && !picked` refusal is the same condition, kept in that
form because they also need the picked token — TOCTOU-closed per c3-224). A
subagent must never be refused where a main-chat turn would spawn: that
asymmetry gave a working main chat and `AUTH_REQUIRED` on every delegation,
which presents as "the loop won't set up" because the orchestrator disarms after
the failed `delegate_subagent`.

`reservedFor` is the **parent** chat id, so a token already reserved by the
parent counts as usable — subagent runs are sequential under the parent's paused
turn (see `oauth-token-pool` `isEligible`).

**There is no `claudeAuth.authenticated` setting.** `ClaudeAuthSettings` is
`{tokens, concurrencyDefault}`; the flag never existed and was never written, so
a gate that consulted it read every user as unauthenticated. `AppSettingsSnapshot`
deliberately omits `claudeAuth` so re-reading it is a compile error — do not
re-add it.

## Keep-Alive Multi-Turn Subagents (claude SDK + PTY)

`delegate_subagent({ subagent_id, prompt, keep_alive: true })` keeps the
subagent's claude session open after the first `result` instead of tearing it
down. The main agent then drives further turns into the SAME warm session — no
re-spawn, no re-trust, warm cache. Star topology preserved: the main agent is
always the one calling these tools.

- **SDK transport (adr-20260616-sdk-pty-feature-parity):** the SDK driver uses
  its native streaming-input prompt queue — `startClaudeSession({ keepAlive })`
  leaves the `AsyncMessageQueue` open after the initial prompt and exposes the
  handle's `pushChannelPrompt` field backed by a queue push (shared with
  `sendPrompt` via `enqueueUserPrompt`). No channel/dev-channels flag is needed.
- **PTY transport:** as below — a kanna channel push.

- **Transport:** each turn is a kanna channel push (`pushChannelPrompt`, the
  same MCP-notification transport shipped in PR #333) followed by draining
  the persistent `HarnessEvent` stream until the next synthesized
  `kind:"result"` event. Interactive TUI claude never writes a
  `type:"result"` row; the turn-end signal depends on CLI version (see
  **PTY turn-end detection** below). `createJsonlEventParser`
  (`jsonl-to-event.ts`) synthesizes one `kind:"result"` per turn either
  way, so a per-turn drain (`drainOneTurn` in `subagent-provider-run.ts`)
  returns once per turn and leaves the iterator open.
- **Auto-wake filter exemption (do NOT remove):** a channel push lands in the
  transcript as a `user isMeta:true` line at a turn boundary, which the
  `jsonl-to-event.ts` auto-wake filter (added in 216392b to drop CC's own
  `<task-notification>` background wakes) would otherwise eat — dropping the
  synthesized `result` and hanging `drainOneTurn` forever. The parser detects
  the `<channel source="kanna">` tag (`userMessageContainsKannaChannel`) and
  treats those lines as real turns. Genuine `<task-notification>` wakes stay
  filtered. Unit fakes emit `kind:"result"` directly and bypass this path, so
  this invariant is only covered by the parser tests + the real-OAuth e2e.
- **Driver:** `StartClaudeSessionPtyArgs.keepAlive` suppresses
  `oneShotClose()` on the first result and exposes
  `pushChannelPrompt` on the handle (`claude-pty/driver.ts`). Keep-alive
  REQUIRES channel delivery — a keep-alive run with no `pushChannelPrompt`
  fails closed. The subagent system prompt gets the plural channel framing
  (`buildChannelPromptFraming(true)`) so the model expects multiple channel
  messages over the session and does not treat turn 2+ as a suspicious
  interrupt.
- **Provider run:** `runClaudeSubagent` drains turn 1, then returns a
  `LiveTurnSource` (`runTurn(prompt, onChunk, onEntry)` + `close()`) via the
  widened `ProviderRunStart.start(onChunk, onEntry, { keepAlive })`. Codex is
  out of scope — keep-alive is claude-PTY only; the MCP layer rejects
  `keep_alive` for non-claude subagents.
- **Orchestrator:** a `liveSessions` registry (keyed by `runId`) holds each
  warm session. Turn 1 runs through the normal `spawnRun` plumbing (permit,
  RunState, timeout, abort, events) but on completion registers a
  `LiveSession` instead of cleaning up; the RunState stays registered so
  cancel can reach it. Follow-up turns: `sendToLiveRun(runId, prompt)`.
  Teardown: `closeLiveRun(chatId, runId, reason)`.
- **Permit model:** an idle live session holds NO parallel permit. Each
  active turn (`spawnRun` turn 1, and each `sendToLiveRun`) acquires a permit
  for its drain and releases it after. Two orthogonal limits — permits =
  concurrent active turns; `KANNA_SUBAGENT_MAX_LIVE` = live processes.
- **Lifecycle bounds:** idle sessions are auto-closed after
  `KANNA_SUBAGENT_IDLE_TIMEOUT_MS` (default 300000), reset on each turn. Live
  process count is capped per chat by `KANNA_SUBAGENT_MAX_LIVE` (default 5) —
  over cap, `delegate_subagent({keep_alive:true})` fails `CAP_EXCEEDED`
  (no LRU eviction; an LRU session might be in use). `cancelChat` /
  `cancelRun` cascade-close all live sessions for the chat/run.
- **MCP tools** (registered under the same `subagentOrchestrator &&
  delegationContext` guard as `delegate_subagent`):
  - `delegate_subagent({ ..., keep_alive })` — turn 1; on completion appends
    `[run_id: ...]` to the reply so the model learns the handle.
  - `send_subagent_message({ run_id, prompt })` — drives a follow-up turn;
    blocks until that turn finishes; `NO_LIVE_SESSION` if unknown.
  - `close_subagent({ run_id })` — tears down + frees the process.
- **Env vars:** `KANNA_SUBAGENT_MAX_LIVE` (default 5),
  `KANNA_SUBAGENT_IDLE_TIMEOUT_MS` (default 300000) — both wired into the
  orchestrator deps at `AgentCoordinator` construction (`agent.ts`); the
  orchestrator itself reads only its deps (side-effect seal).

# Background Subagents (delegate_subagent run_in_background)

`delegate_subagent({ subagent_id, prompt, run_in_background: true })` launches a
subagent WITHOUT blocking the main turn. The MCP tool returns immediately with
`{status:"async_launched", run_id}`; the subagent's final reply is delivered
back into the main chat as a fresh turn when it finishes. Mutually exclusive
with `keep_alive` (the MCP host rejects both set). Works for any provider
(Claude + Codex) — delivery is provider-agnostic. See
adr-20260616-subagent-run-in-background.

- **Orchestrator:** `delegateRun({background:true})` runs the subagent through
  the normal `spawnRun` plumbing (permit, RunState, timeout, abort,
  event-sourcing) but does NOT await it — it generates the runId up front,
  returns `{status:"async_launched", runId}`, and on terminal fires the
  `onBackgroundRunComplete(chatId, runId, BackgroundRunOutcome)` dep. The active
  background run holds a permit while in flight, so concurrency is bounded by
  the existing permit pool (default 4) + run timeout. No live-session registry
  (background runs are one-shot, not keep-alive).
- **Re-entry (driver-agnostic, always /clears main).** `AgentCoordinator.deliverSubagentToMain`
  is wired as `onBackgroundRunComplete`. On every delivery it (1) wipes the
  chat's Claude `session_token` (main /clear equivalent — same machinery
  `exit_plan_mode`'s clearContext branch uses), (2) appends a `context_cleared`
  transcript entry, (3) emits `auto_continue_accepted { source:
  "subagent_background", delayMs: 0 }` whose prompt is the structured
  `<task-notification>` XML (`buildTaskNotification` in `agent.ts` — same
  format Claude Code's LocalAgentTask uses, so the model parses task
  identity/status natively). Un-armed ad-hoc deliveries include the subagent's
  `<result>` body (truncated at 4k chars) — the /clear per delivery means the
  result rides exactly one fresh prompt, context never accumulates. ARMED loop
  deliveries omit `<result>` (PROGRESS.md stays the loop's only durability
  contract) and append the full loop discipline prompt after the notification.
  `fireAutoContinue` → `enqueueMessage` delivers to both drivers; because
  session_token is null, the next main turn is a FRESH Claude spawn.
- **No wake cap.** Concurrency is bounded by the subagent permit pool + run
  timeout. Every delivery is a real event, never a self-poll — no runaway
  budget is meaningful here.

# Queued messages are released on commit, not on dequeue

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

**`recoverArmedLoopWakes` covers the OTHER lost-wake window** — the wake that
never reached the queue because the loop's background subagent (or its
delivery in `deliverSubagentToMain`, whose four writes are not atomic) died
WITH the server. Observed twice: chat c87ab0ad (OOM killed run fc17bee6 seven
minutes in) and chat 5cea83a7 (OOM landed 118 ms after `loop_run_outcome`,
before `auto_continue_accepted`). The invariant it restores: an ARMED loop
always holds exactly one pending wake — a running subagent, a queued message,
or an active turn. At boot no subagent survives the dead process, so
armed + idle + empty queue proves the wake is lost, and the recovery re-emits
it from the durable `LoopState.prompt`. Runs AFTER `recoverQueuedMessages` on
purpose: a chat whose wake survived to the queue is busy (or still queued) by
then, so the armed-loop pass cannot double-fire it. The busy check goes
through the injected `isChatBusy` (the single predicate), never ad-hoc maps.

See `adr-20260813-queued-message-dequeue-on-commit` and
`adr-20260814-armed-loop-wake-recovery`.

# Observability (OTel traces + metrics, memlog, SIGUSR2 heap snapshot)

Three independent concerns, one adapter (`src/server/otel.adapter.ts` — the
ONLY file that may import the OTel SDK/exporters), initialized once from
`server.ts` boot and shut down in the server stop path:

- **OTel traces + metrics** — `KANNA_OTEL=enabled` registers a
  `NodeTracerProvider` (BatchSpanProcessor → OTLP http) and a `MeterProvider`
  (periodic reader, `KANNA_OTEL_METRIC_INTERVAL_MS`, default 15000). Endpoint
  via the standard `OTEL_EXPORTER_OTLP_ENDPOINT` (default localhost:4318);
  service name via `KANNA_OTEL_SERVICE_NAME` (default `kanna`). Off by
  default — it opens sockets. Init never throws: a broken collector must not
  take the server down.
- **Memory log** — `KANNA_MEMLOG_MS` (default 60000, `0` disables) prints one
  `[kanna/mem] rss=…` line per interval. This is the correlation record for
  the next OOM kill; three OOMs (1.06–2.43 GB) went undiagnosed for lack of
  exactly this.
- **Heap snapshot** — `kill -USR2 <pid>` writes a Chrome-DevTools-loadable
  v8 `.heapsnapshot` under `<dataDir>/heap-snapshots`
  (`KANNA_HEAP_SNAPSHOT=disabled` opts out). The only way to answer "WHAT
  holds the bytes" on a live process.

**Domain code imports `src/server/observability.ts` ONLY** — a pure facade
over `@opentelemetry/api` (`withSpan`, `addCounter`, `recordUpDown`). With no
SDK registered every call is the api package's no-op, so instrumentation
needs no test doubles and costs nothing when disabled. Never import the
adapter from domain code; never import SDK packages outside the adapter.

Instrumented so far: `kanna.turn.start` (spawn pipeline), `kanna.subagent.run`
(whole run, the loop's unit of work), `kanna.loop.wake.deliver`, counters
`kanna.subagent.run.finished`, `kanna.autocontinue.fired`,
`kanna.queued_message.recovered`, `kanna.loop.wake.recovered`, and
process-memory gauges. Spans nest via AsyncLocalStorage — add depth with a
one-line `withSpan` at the call site, no handle threading.

# Transcript memory is bounded by bytes, and loaded lazily

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

Still unbounded, deliberately out of scope here: `state.subagentRunsByChatId`
and `state.autoContinueEventsByChatId` are evicted only by whole-chat delete.
The latter is MEASURED at 285 KB for one long loop chat, 91% of it the same
rendered loop prompt re-embedded on every wake by `deliverSubagentToMain`.

# Notification-Driven Loop Orchestration (supersedes Agent Self-Scheduled Wake)

Long-horizon autonomous loops (eslint burn-downs, migration sweeps, multi-hour
codemods) run under a notification-driven pattern with per-iteration `/clear`
on the main agent's Claude session. There is no timer-based `schedule_wakeup`
anymore (removed in adr-20260711-notification-driven-loop-orchestration —
which supersedes `adr-20260603-agent-self-scheduled-wake`).

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

**Removed (hard break, per adr-20260711-notification-driven-loop-orchestration):**
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
The server owns the template so the prompt is deterministic. See
`adr-20260711-setup-loop-template`.

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
- **Armed wakes re-inject the full loop prompt** (see Re-entry above), never
  the generic "decide next action" string.

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

# Background Task Keep-Alive (Bash + Agent + Workflow — KANNA_PTY_BACKGROUND_TASK_MAX_MS)

Claude-Code background tasks (`Bash(run_in_background: true)`, background
`Agent`/Task-tool runs, workflows) run as children of the claude process. If
the idle reaper (`isClaudeSessionIdle`) fires while one is in flight, the
child dies with the process — silently, since a reap is not an error (this
killed a mid-flight background Agent one second after its commit; see
`adr-20260722-background-agent-keepalive` and, for the original Bash-only fix,
`adr-20260604-pty-background-task-keepalive`).

- **Guard.** `hasPendingBackgroundTask(session, now)` mirrors `hasLiveWorkflow`:
  consulted by both `isClaudeSessionIdle` and `enforceClaudeSessionBudget`, it
  holds the session warm while the task set is non-empty. Whether the deadline
  is consulted at all depends on the signal — see **Level-sourced** below.
- **Level-sourced (SDK) — the deadline does not apply**
  (`adr-20260808-background-task-level-signal-authoritative`). The first
  `background_tasks_changed` snapshot sets
  `ClaudeSessionState.backgroundTasksLevelSourced`, after which SET MEMBERSHIP
  is authoritative and no clock may expire the guard: `hasPendingBackgroundTask`
  is true for any non-empty set and `backgroundTaskGuardExpired` is always
  false, so the wake ladder is unreachable. This is what the SDK prescribes
  (`sdk.d.ts` `SDKBackgroundTasksChangedMessage`: consumers needing "is
  background work running" should replace their set with each payload). It is
  required because *silence is not death*: a `vite dev` server prints its banner
  and goes quiet for hours — in chat 1ed924dd the task's output file last grew
  at 12:45:04 and the watchdog woke the user at 13:14:39, so an output-growth
  probe would have fired too. The flag is sticky across an emptied set but
  starts `false` at every spawn, matching the SDK's per-process reset rule. The
  launch regex must NEVER set it — it is PTY's only signal. Note the two
  predicates therefore no longer partition `size > 0`.
- **Primary signal (SDK driver).** The SDK's `system/background_tasks_changed`
  LEVEL event — the full set of live background tasks after every membership
  change, REPLACE semantics (a missed edge bookend can never wedge a stale
  set). Normalized to a hidden `status` entry carrying
  `backgroundTaskIdsSnapshot`; the runner swaps `session.backgroundTaskIds`
  for each snapshot. `in_process_teammate` tasks are filtered (long-lived by
  design; claude-code gh-30008 excludes them from its own wait loop too).
  `system/task_notification` remains the per-task edge clear.
- **Fallback / PTY detection.** The stream consumer parses each `tool_result`
  (`backgroundTaskIdsFromToolResult`) for BashTool's
  `Command running in background with ID: <id>` line AND AgentTool's
  `Async agent launched successfully… agentId: <id>` launch text (marker-gated
  so incidental "agentId:" strings never arm). This is the only launch signal
  on the PTY driver (CLI ≥ 2.1.x writes no system rows to the transcript
  JSONL, so `backgroundTasksLevelSourced` is never set there and the guard
  stays **deadline-based**) and a version-skew fallback on SDK. Duplicate arms
  vs the level signal are harmless (Set). Arming through this path must never
  promote a session to level-sourced.
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
- **Bound.** `KANNA_PTY_BACKGROUND_TASK_MAX_MS` (default 1_800_000 = 30 min,
  via `positiveIntegerFromEnv`) caps how long a hung/never-completing task can
  pin a process — but ONLY for a session with no level signal (PTY / old CLI /
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
  interrupts the session stream in-band (SDK; PTY drops the dead session),
  and suppresses the interrupt tail result via `cancelledResultPending`.
  The guard set was upgraded `backgroundTaskIds: Set<string>` →
  `backgroundTasks: Map<string, SessionBackgroundTask>` (single source;
  `taskType`/`description` from the `background_tasks_changed` snapshot —
  the normalizer now emits `backgroundTasksSnapshot` meta alongside the ids —
  with the launch-regex fallback enriched from the launching tool_call's
  description via `session.recentToolDescriptions`). Per-chat task lists
  flow `getBackgroundTasksByChatId` → `deriveChatSnapshot` →
  `ChatRuntime.backgroundTasks` → `BackgroundTasksSection` (chat footer,
  /tasks-style: type icon + description + id + live elapsed). Budget
  eviction skips `selfWakeActive` sessions; the idle reaper still keys on
  `lastUsedAt`, so a wedged flag cannot pin a session forever.

# Workflow Status Panel (disk-watch, read-only — SDK + PTY)

Surfaces Claude Code's native `Workflow` tool (dynamic multi-agent
orchestration) in the UI: a per-chat panel listing every run with live status +
drill-in progress, plus an inline transcript card on the launch. **Read-only,
both drivers.** After adr-20260711-notification-driven-loop-orchestration the model handles workflow harvest via
`delegate_subagent({run_in_background: true})` status-check spawns; this
panel *displays* the workflow.

**SDK driver registration (adr-20260616-sdk-pty-feature-parity).** Claude writes
the `wf_*.json` sidecars regardless of driver, so the SDK reuses the same
disk-watch read-model. `AgentCoordinator.maybeRegisterSdkWorkflowsDir` derives
`<projectDir>/<session-uuid>/workflows` (via `computeWorkflowsDir`) from the
SDK's first `session_token` HarnessEvent and calls `workflowRegistry.register`
once per session; `closeClaudeSession` unregisters. The PTY path keeps its own
transcript-path registration (guarded by driver preference so neither
double-fires).

**Why disk-watch, not the event stream.** The PTY transcript JSONL (PTY's sole
event source) carries the `Workflow` tool_use launch but **no**
`task_started`/`task_updated`/`tool_progress` lifecycle lines — those flow only
through the SDK live stream-json channel, which PTY never reads. Claude instead
writes a complete, self-updating sidecar per run:
`~/.claude/projects/<encoded-cwd>/<session-uuid>/workflows/wf_<runId>.json`
(`runId`, `taskId`, `workflowName`, `status`, `agentCount`, `totalTokens`,
`phases[]`, `workflowProgress[]` per-agent tree, `result`/`error`/`summary`).
`taskId` joins a run to the transcript's `Task ID: X` launch text.

**Independent read-model (does NOT violate c3-225).** The watcher feeds a sibling
read-model, never the transcript/turn event pipeline (same spirit as reading
subagent files). See `adr-20260603-workflow-disk-watch-read-model`.

- **Adapter** `src/server/workflow-watch-io.adapter.ts` — the only IO; lists +
  reads `wf_*.json`, `fs.watch` with ~250 ms debounce, and **re-arms via the
  nearest existing ancestor** when `workflows/` doesn't exist yet (Claude
  creates it lazily on the first Workflow call, after registration).
- **Registry** `src/server/workflow-registry.ts` — per-chat watch + parse
  (one defensive choke-point `parseWorkflowRunFile`) + `snapshot()` (light,
  heavy fields stripped) + `getRun()` (full) + `subscribe()`. Mirrors
  `PtyInstanceRegistry`. IO injected (side-effect seal). **Re-run masking
  (adr-20260604-workflow-rerun-masking):** Claude embeds the `runId` in the
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
  disk, and reading the transcript taskId would breach the c3-225 invariant).
- **Driver** registers `<projectDir>/<claude-uuid>/workflows` derived from the
  resolved `transcriptStream.filePath` basename (Claude mints its OWN session
  UUID and ignores `--session-id` on new sessions, so kanna's `sessionId` is
  NOT the dir name). A `workflowRegistrationCancelled` flag prevents a late
  `register()` after `cleanupResources` `unregister()` on fast-failing spawns.
- **Transport** WS topic `{type:"workflows", chatId}` → `workflowRunsUpdated`
  snapshot push (mirrors `pty-instances`); `workflows.getRun` command for the
  heavy drill-in payload.
- **Client** `workflowsStore` (stable `EMPTY` ref), `WorkflowsSection` panel
  (mirrors `SubagentsSection`), `WorkflowMessage` transcript card (live pill
  joined by `taskId` once `chatId` is threaded through the transcript rows).

Out of scope: global cross-chat view, stop/relaunch.

# Single-Session Import Live-Tail (KANNA_IMPORT_FOLLOW_*)

`FollowedSessionRegistry` (`src/server/followed-session-registry.ts`) stat-polls
a single-session import's source Claude transcript file and re-imports the
delta as the source grows, so an imported chat that is still actively being
written to by Claude Code keeps catching up. Three env vars tune it, all
consumed in `src/server/server.ts`:

- `KANNA_IMPORT_FOLLOW_POLL_MS` — stat-poll tick interval driving
  `followedSessionRegistry.tick()`. Default `2000`.
- `KANNA_IMPORT_FOLLOW_ACTIVE_WINDOW_MS` — a single-session import only
  auto-arms tailing when the source file's mtime is within this window of
  "now" (otherwise the source is treated as already finished). Default
  `600000`.
- `KANNA_IMPORT_FOLLOW_IDLE_MS` — the registry stops following a session
  after this long with no file growth. Default `600000`.

# Kanban Boards — the card's lifecycle

One card is one worktree is one branch is one chat (`board-start-work.ts`).
That chain is what makes three agents on three cards safe: each has its own
checkout, so they cannot touch each other's files.

**A column's behaviour comes from its `semantic`, never its title.**
`ColumnSemantic` is `start | active | review | done`, all optional — a board
that marks none simply does not move cards, and the feature never guesses a
column from what the user called it. Only `active` and `done` drive anything.

**The card moves automatically at exactly two moments, and they are not
symmetric:**

| Moment | Who moves it | Where to |
| --- | --- | --- |
| "Start work" | Kanna (`moveToActiveColumn`) | the `active` column |
| work is finished | **the agent**, via `mcp__kanna__card_move` | `findAdvanceColumn` — one step forward |
| card reaches `done` | only ever the user | — (raises the cleanup question) |

**Why the agent moves its own card and Kanna does not.** There is no turn-end
hook, deliberately: a card takes as many turns as it takes, so "the turn ended"
is not "the work is done" — a host-side move would advance the card the first
time the agent stopped to ask a question. Instead `buildStartWorkPrompt` names
the card id and the destination column id, and asks for the move *when the work
is done and verified*. The card id has to ride the prompt because the agent has
no other way to learn it; without it the agent would have to read the whole
board back and guess which row is its own, which is why `card_move` sat unused
before this. If a deterministic signal is ever wanted, it belongs on an
acceptance oracle (the `run_verify` shape), not on the turn boundary.

**`findAdvanceColumn` picks by ORDER, not semantic** — the next column by rank
(`listColumns` sorts by it). A board names at most one `review` column while it
may hold several stages between `active` and `done`; the built-in Dev pipeline
runs `In progress → Test → QA → Deployment`, so jumping to the `review` column
would skip a stage. One step forward is the only reading that fits every
template.

**`done` is unreachable that way, on purpose.** Reaching it reports the item
CLOSED to a connected tracker (`remoteStateOfColumn`) and raises the worktree
question — merge / discard / leave (`worktree-cleanup.ts`), asked and never
performed, because a column drag is one gesture with no undo and uncommitted
work exists nowhere else. Those are the user's decisions. A board whose only
successor is `done` (the GitHub template's `Open / In progress / Closed`)
advances nothing, and the prompt then says nothing about moving rather than
improvising a destination.

**Agent-origin writes are held back from the tracker.** Every board write
carries a `CardActor`; the MCP tools attribute `{kind:"agent", chatId}`, and
`board-sync.ts` holds such a change with `heldReason: "agent_push_disabled"`
unless that binding set `allowAgentPush`. An agent advancing a card must not
silently close a real issue.

**Agent tools** (`kanna-mcp-boards.ts`, registered only with a `boardRegistry`
+ `chatId` + `projectId`): `board_list`, `board_get`, `card_move`,
`card_create`, `card_comment`. Two disciplines carried over from the
tracking-doc tools: `board_get` returns COUNTS plus a 20-card window and never
a whole board (a 5k-issue import would otherwise blow up one turn), and every
id is resolved against the chat's project before any write, so an agent cannot
reach another project's board by guessing an id.

**C3 has the decisions but not the map.** Five ADRs record why boards are
shaped as they are — `adr-20260810-boards-sqlite-store` (SQLite, not the event
log), `adr-20260811-board-column-semantics-single-source`,
`adr-20260811-board-in-the-workspace`, `adr-20260811-board-owns-its-rendering`,
`adr-20260811-card-start-work` — and they are the first thing to read before
changing this feature. Boards also shipped without a **component** fact; three
now carry it — `c3-310` (boards-domain, `src/shared/boards/**`), `c3-232`
(boards, `src/server/board-*.ts` plus the MCP and WS surfaces), and `c3-119`
(boards-ui, `src/client/**/boards/**`) — each with a `code-map.yaml` block.

**`c3x lookup` is non-functional in this repo today, for every file — not just
boards.** `c3x lookup src/server/read-models.ts` returns `matches[0]` although
`code-map.yaml` has listed it under `c3-207` all along. Never read an empty
`lookup` as "this file has no component": read the component directly
(`c3x read c3-232`) or grep `code-map.yaml`. The `/c3 query` gate still works —
`c3x search` and `c3x read` both resolve.

# Tests

`bun run test` MUST pass locally before any push or PR. CI (`.github/workflows/test.yml`)
runs `bun test --conditions production` on every push to `main` and every PR; merges are blocked on failure.
Always use `--conditions production` (or `bun run test`) — Lexical 0.45 dev ESM builds
have a circular-dep TDZ that crashes bare `bun test`. For fast iteration on a single
suite: `bun test --conditions production src/server/<file>.test.ts`.
When a test spawns `git` or other subprocesses, ensure the spawn sets
`stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0` so a hung credential prompt
cannot exhaust the test timeout. Also give it an explicit timeout
(`test(name, fn, 30_000)`) — the 5s Bun default is too tight for CI runners.

## Every React root a test mounts must be unmounted (enforced)

happy-dom gives the whole Bun process ONE document, so `scripts/test-preload.ts`
wipes `document.body` after each test. The wipe cannot reach the React root that
owned those nodes: a test that calls `container.remove()` but never
`root.unmount()` leaves a live root — and any portal it opened (Radix
Dialog/Popover/Select, `createPortal`) had `document.body` ITSELF as its
container. When that root next commits, React removes a node the wipe already
took and happy-dom throws `removeChild: The node to be removed is not a child of
this node`, blaming **whichever test is running at that moment** — a different
test, in a different file. File order is the filesystem's, so it reproduces on
CI's ext4 and not on APFS (PR #646: `SharePopover` crashed `CardDrawer` two files
later; the full suite, CI's exact file order, bun 1.3.11, and Linux under Docker
were all green locally).

The same `afterEach` now FAILS the test that leaked, naming the nodes. It reports
only REACT-OWNED leftovers — Lexical's typeahead plugin appends a menu straight
to `document.body` even under `renderToStaticMarkup`, and nothing holds a
reference that could commit against it later.

`renderForLoopCheck` unmounts roots whose callers never called the `cleanup` it
returns, via the teardown registry the preload publishes on
`globalThis.__kannaDomTeardowns`. It cannot own an `afterEach` for that: bun runs
hooks in registration order and the preload registers first, so a helper-owned
hook fires after the sweep has already failed the test.

# Wiki

Public docs site lives in `wiki/` (Astro Starlight) and is deployed to
https://kanna-wiki.lowbit.link on every push to `main` that touches `wiki/**`.

Regenerate screenshots:

```bash
bash wiki/scripts/capture-all.sh
```

This spawns a seeded demo Kanna under a tmpdir `KANNA_HOME`, captures all
~32 PNGs via Playwright, and writes them to `wiki/public/screenshots/`.
Commit the PNGs.

Regenerate env-var reference table:

```bash
cd wiki && bun run scripts/extract-env-vars.ts
```

Wiki is isolated from the main repo build — its own `package.json`, own
`node_modules`. `bun run lint` and `bun test` at the repo root do NOT touch
`wiki/`.
