# Plan: replace Kanna's hand-built agent code with Claude Agent SDK built-ins

## Context

Kanna (`/Users/cuong/Desktop/repo/kanna`, `@anthropic-ai/claude-agent-sdk` 0.3.280, which is also the latest version) uses about 12 of the SDK's roughly 70 `query()` options and 7 of its roughly 35 `Query` methods. It builds the rest by hand: parsing text with regexes to detect errors, rate limits and background tasks; its own copies of the SDK's message types; a copy of the CLI's compaction formula; and a PTY driver that duplicates the MCP server, event parsing and tests.

The user confirmed the PTY driver is deprecated and should be removed. The audit also found real bugs:
- **Session cost is counted more than once.** The SDK's `total_cost_usd` is a running total, but Kanna adds it up per turn, and a resumed session adds the whole prior total again.
- **The chat permission policy is never enforced on SDK sessions.**
- **Subagents restricted to a folder have no file tools.** Their native tools are removed, and the MCP stand-ins that should replace them are never registered.

Goal: fix the bugs, delete PTY, and move each hand-built piece onto the SDK built-in. Kanna keeps what it needs to support multiple providers (Codex and OpenRouter): its own transcript store, the durable message queue, the subagent orchestrator, cron, loops and boards.

**Decisions from the user**
1. Enforce the chat policy and folder restrictions with a **PreToolUse hook** on the native tools, and delete the `mcp__kanna__*` stand-in tools.
2. **Enforce denies only.** An `ask` verdict falls back to today's behaviour, so no new approval prompts appear.
3. For the cost fix, **store the SDK's running total** on each result entry so the correct baseline survives a resume, a restart or a fork.

**Decisions I made (can be revised)**
- Session import stays hand-built. The SDK's `getSessionMessages` doesn't return per-message timestamps or `toolUseResult`, and the importer needs both.
- `type: "ws"` for MCP servers is **not** a bug. The bundled CLI accepts it; only the SDK's `.d.ts` leaves it out. The only change is to type it.
- The PTY removal commit will not use `!` / `BREAKING CHANGE`, to avoid a 2.0 release-please bump. The removed setting is noted in the commit body instead.

## Workflow (every PR)

- **Git setup:**
  - Leave the main worktree alone: it's on `fix/plugin-build-subprocess` with an untracked `enter-probe.mjs`.
  - Run `git fetch origin`.
  - For each PR, run `git worktree add ../kanna-sdk-<slug> -b <branch> origin/main`, then `bun install`. This matches the repo's existing worktree pattern (`kanna-claude-md`, `kanna-ui-audit`).
- **Repo rules from CLAUDE.md and the kanna skill:**
  - Run `c3x lookup <file>` before editing, and `/c3 change` in the same PR when a contract changes, then `c3x check`.
  - Put the failing test and the fix in **two separate commits**.
  - No code comments (`bun run lint:comments`).
  - Use conventional commits (`bun run check:commits --range origin/main..HEAD`).
  - Use `bun run test`, never plain `bun test`.
  - Lower the architecture and complexity pins whenever a count drops (`bun run check:arch`, `bun run lint:limits`).
- **Gate before each PR:** `bun run check && bun run test && bun run check:arch && bun run lint:limits`.
- **Then:** push the branch and open a PR with `gh pr create`.
- **Tests:** only through public seams:
  - the output of the `createClaudeHarnessStream` generator
  - `startClaudeSession`'s captured `query()` options, using the existing `mock.module` pattern in `claude-session-start.test.ts:1-35`
  - the coordinator, using `AsyncEventQueue` / `waitFor` from `src/server/test-helpers/`
  - the store's read models

  Name regression tests after the bug they cover.
- **Plan document:** commit it in the repo as `PLAN-agent-sdk-builtins.md`, plus `PROGRESS-agent-sdk-builtins.md`, matching the existing `PLAN-*/PROGRESS-*` convention. Do this in PR 1 and update it in each later PR.

---

## PR 1 — `fix(claude): report per-turn cost from the SDK's running total` (START HERE)

**Branch:** `fix/claude-cost-running-total`

1. **Add a field to the shared contract.** Add an optional `cumulativeCostUsd?: number` to `ResultEntry` in `src/shared/transcript-types.ts`. It holds the raw SDK running total. `costUsd` keeps its meaning of this turn's cost. Record this with `/c3 change` on the shared component.
2. **Compute per-turn cost in `src/server/claude-harness-stream.ts`, `createClaudeHarnessStream`.**
   - Add a 4th parameter, `costBaselineUsd?: number`, and hold `lastCumulative = costBaselineUsd ?? 0` for the lifetime of the generator, which is one `query()` process.
   - On a result with a numeric `total_cost_usd`:
     - `delta = total >= lastCumulative ? total - lastCumulative : total`. A drop means the total was reset or the resume didn't restore it.
     - Emit `costUsd: delta` and `cumulativeCostUsd: total` on the result entry, and use `delta` in the `usageWithCost` snapshot (lines 80-137).
     - Set `lastCumulative = total`.
   - On a `context_cleared` entry, set `lastCumulative = 0`.
   - Leave the `resolveTurnPrice` fallback (86-98) alone; it is already per-turn.
   - Cancelled turns emit no result, so `lastCumulative` doesn't advance and their spend rolls into the next turn.
3. **Make the harness the only source of cost.** Delete `costUsd: message.total_cost_usd` in `src/server/claude-message-normalizer.ts:331`.
4. **Read the baseline.**
   - Add a read in `src/server/event-store-messages.adapter.ts`, next to the existing `getLatestContextWindowUsage` scan: the `cumulativeCostUsd` of the last Claude `result` entry after the chat's last `context_cleared`. Return `undefined` if there is none.
   - Pass it through `startClaudeSession` args (`claude-session-start.ts:116-156`) into the harness, only when `resume` / `sessionToken` is set.
   - Wire it where the spawner builds the args (`claude-session-spawner.ts`).
   - A fork copies the transcript (`forkChat`), so it inherits the right baseline automatically.
5. **Keep-alive subagents.** `event-store-subagent.ts:58-66` currently overwrites `run.usage` on every result. Change it to add the per-turn tokens and cost together.
6. **Pass the new parameters through `startClaudeSession`** (`claude-session-start.ts:265-269`).
7. **Tests** (add a failing-test commit first):
   - `claude-harness-stream.test.ts`: "second result in one session reports only that turn's cost (double-count regression)", "resumed session subtracts the stored baseline", "a running total below the baseline is treated as a reset", "result carries the raw cumulativeCostUsd". Update "result with total_cost_usd attaches costUsd…".
   - `claude-message-normalizer.test.ts:149-153`: update it, since cost now comes from the harness.
   - `event-store-subagent.test.ts`: "keep-alive run accumulates usage across turns".
   - `contextWindow.test.ts` needs no change: the browser keeps adding up per-turn costs.
8. **Known limitation:** result entries created before this fix have no `cumulativeCostUsd`, so their totals stay inflated. Say so in the PR description.
9. **Also in this PR:** commit `PLAN-agent-sdk-builtins.md` and `PROGRESS-agent-sdk-builtins.md`.

## PR 2 — `fix(loop): block edits with a PreToolUse hook instead of canUseTool`

**Branch:** `fix/loop-guard-pretooluse`

**Why:** `canUseTool` is skipped for calls that `acceptEdits` auto-approves. `MultiEdit` and `NotebookEdit` aren't in `CLAUDE_TOOLSET`, and `Task` may reach `canUseTool` as `Agent`. So the guard in `claude-spawn-helpers.ts:33-42` only fires in rare cases.

1. In `claude-session-start.ts`, build the hooks through one composer. It merges the existing `buildCompactionHooks` (59-86) with a new PreToolUse loop guard.
2. **The guard:** when `isLoopArmed()` is true at call time, return `hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: <current message> }`.
   - It covers `Edit|Write|NotebookEdit|Task|Agent`. Check the subagent tool's name against `CLAUDE_TOOLSET` and `sdk-tools.d.ts` before choosing.
   - This also closes the window before the respawn.
3. Remove the loop branch from `buildCanUseTool`.
4. Keep `LOOP_BLOCKED_NATIVE_TOOLS` for `disallowedTools`, pruned to the tools that really exist (remove `MultiEdit`).
5. **Tests:**
   - Replace the direct-call tests in `claude-spawn-helpers.test.ts:29-65` and `agent.test.ts` (~5378, "buildCanUseTool — loop-armed tool-block") with `claude-session-start.test.ts` cases. They call the captured `options.hooks.PreToolUse` and check: "armed loop denies Edit", "unarmed loop allows Edit", "Read is never blocked".

## PR 3 — `refactor(claude): remove the deprecated PTY driver`

**Branch:** `refactor/remove-pty-driver`

Follow the removal map found during exploration:

- **Delete**
  - Everything in `src/server/claude-pty/**` except two relocated files (below).
  - `kanna-mcp-http.ts`, `mcp-zod-compat.adapter.ts` and `http-server.adapter.ts`, with their tests.
  - `agent.pty-rotation.test.ts` and `shared/pty-instance.ts`.
  - On the client: `PtyInstancesIndicator.tsx`, `PtyInstanceRow.store.ts` and `stores/ptyInstancesStore.ts`, with tests.
  - The skill folder `.claude/skills/kanna-pty/`.
  - The redundant `kanna-mcp-tools/{ask-user-question,exit-plan-mode}.ts` stand-ins, the `forceInteractiveToolCallbacks` flag and the `interactiveEnabled` block in `kanna-mcp.ts` (1047-1086). Native `AskUserQuestion` / `ExitPlanMode` already go through `canUseTool` to the durable `toolCallback`.
- **Relocate**
  - `claude-pty/jsonl-path.adapter.ts` → `src/server/claude-projects-path.adapter.ts`, keeping `encodeCwd`, `computeProjectDir` and `computeWorkflowsDir`, and dropping `computeJsonlPath`.
  - `claude-pty/output-ring.ts` → `src/server/output-ring.ts`.
  - Move their tests too. Move the SDK-only cases in `parity-matrix.test.ts:289-437` into `claude-harness-stream.test.ts`.
- **Remove the driver-specific code in these files:**
  - Server: `agent-coordinator.ts`, `agent-coordinator-types.ts`, `claude-session-spawner.ts`, `claude-subagent-wiring.ts`, `subagent-provider-run.ts`, `claude-session-lifecycle.ts`, `claude-cancel-handler.ts`, `claude-turn-starter.ts` (+types), `claude-session-runner.ts` (the compact-finalize block at 293-314), `claude-session-config-helpers.ts`, `server.ts`, `ws-router*.ts`, `events.ts` (make `TurnRunConfig.driver` optional).
  - Client: `SettingsPage.tsx` (remove the driver setting; keep the two lifecycle rows, reworded), `App.tsx` (the warning banner), `useAppGlobalState.ts`, `ChatNavbar.tsx`, `ChatTabContent.tsx`, `appSettingsStore.ts`, and the copy in `chatStatusIndicator.ts` and `SubagentsSection.tsx`.
  - Shared: `protocol.ts` (the `pty-instances` topic and `pty.cancel/kill`) and `app-settings-types.ts`.
  - Keep `claudeDriver.lifecycle`, which SDK sessions use for their idle timeout and session limit.
- **Remove the unused `getSupportedCommands`** from `ClaudeSessionHandle` (`harness-types.ts:30`), its implementation (`claude-session-start.ts:289-296`) and all test stubs. Delete `agent.test.ts:2784`, which tests a method that no longer exists.
- **Settings compatibility:** `normalizeClaudeDriverSettings` (`app-settings.ts`) silently drops a saved `preference: "pty"` with **no warning**, keeps `lifecycle`, and rewrites the file on the next save. Add a test: "settings file with preference pty loads without warning and keeps lifecycle". Log a one-time warning at boot if `KANNA_CLAUDE_DRIVER=pty` is set.
- **Rename** `KANNA_PTY_BACKGROUND_TASK_MAX_MS` to `KANNA_CLAUDE_BACKGROUND_TASK_MAX_MS`, keeping the old name as a fallback alias.
- **Architecture budget** (`src/ops/architecture/budget.ts`):
  - Remove the allowance for `claude-pty/driver.ts`.
  - Lower the `settings-bound-throws` pattern count.
  - Re-pin `complexity` and `max-depth` after `runClaudeSession` gets smaller.
- **Docs:**
  - CLAUDE.md: the skill table, Tool Callback flag, Claude driver flag, compact notes, MCP config and background-task sections.
  - Skills: `kanna`, `kanna-subagents`, `kanna-loop`, `kanna-debug`, `kanna-telemetry`, `github-issue`.
  - README driver lines (leave the embedded-terminal PTY lines), `PRODUCT.md`, issue templates, and the wiki env-var extractor and its generated data.
- **c3:** retire `c3-225` (claude-pty-driver), update `c3-208`, `c3-210`, `c3-226`, `c3-229`, `c3-224` and `c3-206`, and add one ADR, "remove PTY driver". Leave the old ADRs as history.

## PR 4 — `fix(permissions): enforce chat policy and folder restrictions with a PreToolUse hook`

**Branch:** `fix/policy-pretooluse-hook`

1. **Switch `permission-gate.ts` `policy.evaluate` to native tool names and arguments:**
   - Read-path tools: `Read`(`file_path`), `Glob`/`Grep`(`path`), `LSP`(file path argument).
   - Write-path tools: `Write`/`Edit`(`file_path`), `NotebookEdit`(`notebook_path`).
   - Bash: `Bash`(`command`).
   - Replace `getPathArg` with a per-tool lookup of the argument.
   - Remove the `mcp__kanna__*` interactive set.
   - Rename `POLICY_DEFAULT.toolDenyList` entries from `mcp__kanna__bash` to `Bash`. It only exists in code, so no data migration is needed.
2. **Add the hook.** A new module `src/server/claude-policy-hook.ts` exports a PreToolUse matcher built from `{ chatPolicy, cwd, restrictedAllowedPaths }`.
   - It calls `policy.evaluate` and, **only** for `auto-deny`, returns `permissionDecision: "deny"` with the reason.
   - `ask` and `auto-allow` return `{}`, so behaviour stays as today.
   - It applies to SDK Task subagents too.
   - Compose it with the hooks from PR 2 in `claude-session-start.ts`.
3. **Stop removing native tools.** In `claude-session-start.ts:189-191`, always pass `[...CLAUDE_TOOLSET]` and delete `SDK_RESTRICTED_FS_NATIVE_TOOLS` (`claude-session-config.ts:136`).
4. **Wire subagents.** Pass `chatPolicy` (through `resolveChatPolicy`) and `restrictedAllowedPaths` into the SDK subagent start in `claude-subagent-wiring.ts`.
5. **Delete the 8 stand-ins** (`kanna-mcp-tools/{read,glob,grep,bash,edit,write,webfetch,websearch}` and `tool-callback-shim.ts`) and their registration in `kanna-mcp.ts`. Keep the `tool-callback.ts` durable approval flow, which `AskUserQuestion` and `ExitPlanMode` use through `canUseTool`.
6. **Tests** (through captured hooks or `evaluate`):
   - "restricted subagent Read outside allowed roots is denied (no-file-tools regression)"
   - "readPathDeny blocks Read of ~/.ssh in a main chat"
   - "Bash rm -rf / is denied by the default deny list"
   - "ask verdict does not block"
   - "defaultAction auto-deny override blocks unlisted tools"
   - Convert the existing `permission-gate` tests to native names. Delete the stand-in tool tests.
7. **Docs and c3:** rewrite CLAUDE.md's "Kanna-MCP Built-in Shims" and the policy docs, and run `/c3 change` on the permission component.

## PRs 5–10 — Replace hand-built code with SDK built-ins (one PR each; exact line references come from the exploration notes)

5. **`refactor(claude): type the SDK stream with SDKMessage`**
   - Split the normalizer: a typed SDK-stream path using `SDKMessage` from `sdk.d.ts:5111`, and the existing loose path used only for on-disk JSONL (`agent-transcript-parse.ts`).
   - Delete the always-true `isSdkToClaudeMessage`.
   - Keep the result's `subtype`, `terminal_reason` and `permission_denials` in the transcript and show them in the UI.
   - Type user MCP servers as the SDK's `McpServerConfig` plus a documented `ws` extension.
6. **`refactor(claude): detect API, auth and limit errors from SDK fields`**
   - Use `SDKAssistantMessage.error` (`sdk.d.ts:3535` lists the values), `api_error_status`, `rate_limit_event`, `auth_status` and `USAGE_LIMIT_ERROR_PREFIXES`.
   - Replace the text regexes in the normalizer, `auto-continue/limit-detector.ts`, `auth-error-detector.ts` and `quick-response.ts:24-33`.
   - Keep the reset-time text parser only where the SDK gives no `resetsAt`.
7. **`refactor(claude): track background tasks and workflows from SDK task events`**
   - Replace `BACKGROUND_TASK_LAUNCH_RE` and the async-agent marker (`claude-prompt-helpers.ts:73-122`) with `task_started`, `task_updated`, `task_notification`, `background_tasks_changed` and `tool_use_result`.
   - Get the workflow directory from `WorkflowOutput.transcriptDir` / `task_started.workflow_name` instead of `computeWorkflowsDir(encodeCwd…)`.
   - Enable `perTaskStopAffordance` and use `stopTask()`.
   - Deduplicate `mergeBackgroundTaskSnapshot`.
8. **`refactor(claude): match results to prompts by uuid`**
   - Set `uuid` on each `SDKUserMessage` (`claude-session-start.ts:237-257`).
   - Finalize a turn when its uuid appears in `user_message_uuids` (`sdk.d.ts:5516-5517`), instead of the first-in-first-out `pendingPromptSeqs.shift()`.
9. **`fix(quick-response): cancel timed-out structured queries with an AbortController`**
   - `runClaudeStructured` (`quick-response.ts:132-219`) should pass `abortController` with a timer that is cleared afterwards, which fixes the leaked timer.
10. **`refactor(claude): drop Kanna's copy of the CLI auto-compaction formula`**
    - Delete `proactive-compact.ts` and the `KANNA_PROACTIVE_COMPACT` path in `claude-send-command.ts`.
    - Take the compaction failure signal from `status.compact_result`.
    - Get context usage for live sessions from `getContextUsage()`.

## Later (spikes before committing to a design)

- **Mid-turn "steer":** send the message with `priority: 'now'` instead of cancelling and restarting. The priority values aren't documented, so test them first.
- **Approvals that survive a restart:** try PreToolUse `permissionDecision: "defer"` and `deferred_tool_use` as a replacement for storing pending requests.
- **Mermaid guard:** a `Stop` hook returning `decision: "block"`.
- **Native task mirror:** use the `TaskCreated` / `TaskCompleted` hooks.
- **Live sessions:** `reloadPlugins()` / `reloadSkills()`, `mcpServerStatus()`, `supportedModels()`, and overlaying `commands_changed` on the command picker.
- **Optional features:** `enableFileCheckpointing` + `rewindFiles`, `forkSession({ upToMessageId })`, image attachments as content blocks, `includePartialMessages`, `maxBudgetUsd`.

## Verification

- **Every PR:** run the full gate above, and confirm the regression tests fail before the fix and pass after it (the two-commit rule).
- **PR 1:** start the app (`bun run dev`), send two turns, then check the cost pill equals the sum of the per-turn costs. Restart the server, send a third turn in the same chat, and confirm the pill grows by only that turn's cost. Run `/clear` and confirm the next cost starts from zero.
- **PR 3:** load an old settings file that has `claudeDriver.preference: "pty"`. Confirm no "settings were reset" notice appears and that chats start on the SDK. Confirm `grep -r "claude-pty\|KANNA_CLAUDE_DRIVER" src` comes back empty.
- **PR 4:** in a live chat, ask Claude to read `~/.ssh/config` and confirm it is denied. Give a subagent `allowedPaths` and confirm it can read inside the folder, is denied outside it, and still has its native tools.
