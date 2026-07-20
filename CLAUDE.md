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

Hard lint gate (`RENDER_LOOP_SYNTAX` in `eslint.config.js`): passing an
inline function/arrow as `useWebSocket`'s url argument is a
`no-restricted-syntax` **error** — react-use-websocket's reconnect effect
keys on the url, so a fresh ref every render tears down + reopens the
socket in a flushSync loop (React #185, PR #561). Hoist the url or wrap
it in `useMemo`/`useCallback`.

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

# Orchestration Core (Plan A — engine only)

`OrchestrationQueue` in `src/server/orchestration-queue.ts` drives durable, multi-task, multi-phase coding runs. It is a sibling of `SubagentOrchestrator` inside `AgentCoordinator`'s dependency tree.

- **Run lifecycle:** `createRun(config)` provisions N git worktrees at branches `orch/<runId>/wt-<i>`, seeds all tasks as `orch_task_queued`, then returns a `runId`. `waitForRun(runId)` resolves to `OrchRunSnapshot` when the run reaches a terminal state.

- **Phase pipeline (F4):** Each task runs through an ordered list of `OrchPhaseSpec` entries (implement → review × 2 → fix). Each phase spawns a fresh worker via the injected `StartWorker`. `{{TASK}}`, `{{DIFF}}`, `{{PRIOR}}` template vars carry context forward across phases. `contextPrompt` is prepended to every worker prompt; `scopePaths` is injected only into implement-kind phases.

- **Event sourcing:** Every state transition appends one of 18 `OrchestrationEvent` variants to the existing event store at **sourceIndex 8** (`orch.jsonl`). Orchestration events are **NOT folded into snapshot.json** — state is reconstructed from pure replay on boot. `orchRunsById` is a read model derived at replay time.

- **Worktree pool (F13):** `heldByTaskId` is preserved on requeue (progress not lost); cleared only on commit or fail. `ensureWorktree` is idempotent — safe to call during `recoverOnStartup`.

- **Permit pool (F3):** `rt.permits` counter per run, separate from `SubagentOrchestrator`'s pool. The `heldPermit` boolean in `runTask` prevents a permit leak on the gate-resume path: it starts `false` in the resume branch, is set to `true` only after `awaitGate` returns, and `finally` releases only `if (heldPermit)`.

- **Gate protocol (F5):** Hard gates (`kind:"hard"`) pause the task in `gated` state until `resolveGate(runId, taskId, true)`. Soft gates emit events and continue without blocking.

- **Verify step (F12):** After all phases, `config.verify.command` is run. Non-zero exit re-runs the fix phase with the command output as `{{PRIOR}}`; exhausted retries → `failed`.

- **Restart recovery (`recoverOnStartup`):** (1) Requeue all `nonTerminalOrchTasks()` events. (2) Rebuild pool via `ensureWorktree` (idempotent). (3) Re-arm gated tasks by calling `runTask` in the resume path. (4) `schedule()` deferred via `setTimeout(0)` — lets boot-time callers observe clean state first.

- **Cancel (AG1):** `cancelRun` is the ONLY abort path: sets `rt.cancelled`, aborts all per-phase `AbortController`s, resolves all pending gate `Promise` resolvers, appends `orch_run_cancelled`.

- **Adapters:** `orchestration-git.adapter.ts` owns `commitAll` + `diffAgainstBase`; `orchestration-worktree.adapter.ts` owns `ensureWorktree`, `resetHard`, `removeWorktree`. Both are IO-leaf `.adapter.ts` files exempt from the side-effect seal. `src/shared/orchestration-types.ts` contains pure types only.

- **Scope overlap detection:** `detectScopeOverlap(tasks)` is an exported pure function that returns `{ taskIds, paths } | null` for caller-side validation before `createRun`.

- **Tests:** `orchestration-queue.test.ts` (32 cases: scheduling, phase pipeline, hand-back, gates, scope overlap, restart, verify, cancel), `orchestration-worktree.adapter.test.ts` (5 real-git cases), `orchestration-e2e.test.ts` (1 acceptance test: 4 tasks × 3 phases, real worktrees). All run with `bun test --conditions production`.

- **WS wiring (not yet landed):** `createRun` / `cancelRun` / `resolveGate` / `waitForRun` will be exposed as `ws-router` commands in a follow-on PR.

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
  / NUL byte / oversize inputs. Returns a flat error list (does not
  fail-fast); the tool surfaces the list as `isError`.
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
  `END THIS TURN`, and `/clear`. Future edits to the template that drop
  any of these fail validation.

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

# Background Bash Task Keep-Alive (KANNA_PTY_BACKGROUND_TASK_MAX_MS)

Claude-Code background Bash tasks (`Bash(run_in_background: true)`, e.g. a
`gh pr checks` CI poll) run as children of the PTY `claude` process and report
completion via a `<task-notification>` transcript line. That line is
`type=user` with `isMeta != true`, so the `jsonl-to-event.ts` auto-wake filter
does NOT drop it — the continuous transcript tail (`runClaudeSession` stream
loop in `agent.ts`) re-enters it as a real turn. The ONLY failure was the idle
reaper: a turn ends with a background task still running, no `activeTurn` /
`pendingPromptSeq` / live workflow keeps the session busy, so
`isClaudeSessionIdle` reaped the PTY exactly one idle window
(`DEFAULT_CLAUDE_SESSION_IDLE_MS`, 10 min) later — killing the child before it
could notify. See `adr-20260604-pty-background-task-keepalive`.

- **Guard.** `hasPendingBackgroundTask(session, now)` mirrors `hasLiveWorkflow`:
  consulted by both `isClaudeSessionIdle` and `enforceClaudeSessionBudget`, it
  holds the session warm while a launched task is within its keep-alive window.
- **Detection.** The stream consumer parses each `tool_result` for Claude Code's
  exact `Command running in background with ID: <id>` line
  (`backgroundTaskIdsFromToolResult`), records the id, and arms
  `backgroundTaskDeadlineAt = now + KANNA_PTY_BACKGROUND_TASK_MAX_MS`. The later
  `<task-notification>` produces no Kanna entry, so the guard is **deadline-based**
  (no per-id completion signal), matching the workflow guard's "eventually
  reaps" model. The deadline lazily clears once passed.
- **Clear.** A real user `chat.send` (NOT auto-continue / agent wakes, which
  bypass `send`) releases the guard so the session reaps normally afterward.
- **Bound.** `KANNA_PTY_BACKGROUND_TASK_MAX_MS` (default 1_800_000 = 30 min,
  via `positiveIntegerFromEnv`) caps how long a hung/never-completing task can
  pin a process. Trade-off: a quick task still holds the session warm up to the
  max (no early-clear) — acceptable and bounded; raise/lower per deployment.

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
