---
id: adr-20260520-system-prompt-snippets
c3-seal: 3148083d8a61822bc569534c0fc04dd6361f56cf8dc95d81af0812fb6044250e
title: system-prompt-snippets
type: adr
goal: Replace the larger five-source proposal (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, project CLAUDE.md, project AGENTS.md, user snippets) with a single app-global user-editable text field `globalPromptAppend`. When non-empty the value is injected as additional system-level instructions on every main-agent turn — appended to the Claude system prompt (`KANNA_SYSTEM_PROMPT_APPEND` / `--append-system-prompt`) and sent to Codex via `collaborationMode.settings.developer_instructions`. One textarea in Settings, one persisted string, applied to Claude (SDK + PTY) and Codex symmetrically, inherited by subagent turns of both providers. No filesystem inheritance, no per-project field, no snippet list — those remain explicitly out of scope until evidence shows the simple form is insufficient.
status: proposed
date: "2026-05-20"
---

# adr-system-prompt-snippets

## Goal

Replace the larger five-source proposal (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, project CLAUDE.md, project AGENTS.md, user snippets) with a single app-global user-editable text field `globalPromptAppend`. When non-empty the value is injected as additional system-level instructions on every main-agent turn — appended to the Claude system prompt (`KANNA_SYSTEM_PROMPT_APPEND` / `--append-system-prompt`) and sent to Codex via `collaborationMode.settings.developer_instructions`. One textarea in Settings, one persisted string, applied to Claude (SDK + PTY) and Codex symmetrically, inherited by subagent turns of both providers. No filesystem inheritance, no per-project field, no snippet list — those remain explicitly out of scope until evidence shows the simple form is insufficient.

## Context

`src/shared/kanna-system-prompt.ts:14` declares `KANNA_SYSTEM_PROMPT_BASE` — the static refusal-policy paragraph appended to every Claude turn via `systemPrompt.append` (SDK driver, `src/server/agent.ts`) and `--append-system-prompt` (PTY driver, `src/server/claude-pty/driver.ts`). `buildKannaSystemPromptAppend(subagents)` splices a subagent roster after the base. The Codex JSON-RPC adapter (`src/server/codex-app-server.ts:1065`) calls `turn/start` per turn and hardcodes `collaborationMode.settings.developer_instructions: null` (`src/server/codex-app-server.ts:1083`) even though the protocol carries the field (`src/server/codex-app-server-protocol.ts:72`). Codex CLI itself reads `~/.codex/AGENTS.md` at startup, but the `codex app-server` JSON-RPC mode that Kanna integrates with does not — instructions must arrive on the wire as `developer_instructions`. Users today cannot inject persistent project guidance into Kanna chats without editing source; the only escape hatch is pasting into every chat. App settings already persist through `AppSettingsManager` (`src/server/app-settings.ts`) with watcher-backed reload, atomic write, and the patch path used by `SettingsPage` (`src/client/app/SettingsPage.tsx`) + `appSettingsStore` (`src/client/stores/appSettingsStore.ts`); subagent turns route through the same Claude/Codex paths via `buildClaudeSubagentStarter` and `CodexAppServerManager.startTurn`. Affected components: c3-116 settings-page (UI), c3-210 agent-coordinator (per-turn wiring for both providers + subagent), c3-211 codex-app-server (developer_instructions plumb). Two files are uncharted in the codemap (`c3x lookup` returns no matches) and this ADR closes the gap: `src/shared/kanna-system-prompt.ts` and `src/server/app-settings.ts`. The earlier draft of this ADR proposed a five-source surface (four inherited files + user snippets); this rewrite supersedes that scope.

## Decision

1. Add `globalPromptAppend: string` (default `""`, trimmed-empty treated as absent, hard cap 8000 chars) to `AppSettingsSnapshot` / `AppSettingsPatch` / `AppSettingsFile`. Normalize in `app-settings.ts` (trim trailing newlines, cap with warning), exposed through a new `AppSettingsManager.setGlobalPromptAppend(text)` method routed via the existing `appSettings/patch` WebSocket command.
2. Extend `buildKannaSystemPromptAppend(subagents: Subagent[], opts?: { globalPromptAppend?: string })` in `src/shared/kanna-system-prompt.ts` to splice a `## Project instructions` block carrying the user text immediately after `KANNA_SYSTEM_PROMPT_BASE` and before the subagent roster. Empty / whitespace-only text emits nothing — byte-for-byte legacy output preserved.
3. Plumb the same resolved string into both Claude entry points (`agent.ts` SDK path and PTY driver) and the Codex path. For Codex, extend `StartCodexTurnArgs` with `developerInstructions?: string` and replace the hardcoded `developer_instructions: null` with `args.developerInstructions?.trim() ? args.developerInstructions.trim() : null`. Subagents inherit by virtue of `subagent-provider-run.ts` calling the same builder + Codex starter — no separate field, no separate code path.
4. `agent-coordinator` reads the snapshot once per turn (existing `AppSettingsManager.getSnapshot()`); live edits apply to the next turn without restart.
5. UI: new "Global instructions" section in `SettingsPage` with a multi-line textarea bound to `appSettingsStore`, helper text "Appended to every Claude and Codex turn (main + subagents)", live char counter, save disabled above 8000.
6. **Explicit non-goals (was in superseded draft):** no filesystem inheritance (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, project `CLAUDE.md`, project `AGENTS.md` are NOT read); no write-back-to-disk editor; no user-snippet list; no per-project override; no per-snippet enable toggles. Reasons in Alternatives.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-116 | component | New textarea section in SettingsPage bound to existing appSettingsStore patch action | Foundational Flow: confirm preferences-store input row still holds; rule-zustand-store: setter reuses existing appSettingsStore, no new local store; ref-local-first-data: persisted under settings.json |
| c3-210 | component | Reads globalPromptAppend per turn from settings snapshot; passes to both providers + subagent starters | ref-provider-adapter: both Claude and Codex receive equivalent injection so adapter normalization stays untouched; ref-tool-hydration: review confirms tool hydration unaffected (suffix string only) |
| c3-211 | component | StartCodexTurnArgs extended with developerInstructions; turn/start payload sets developer_instructions per turn | ref-provider-adapter: adapter shape extended symmetrically with Claude path; rule-strong-typing: new typed field, no any |
| c3-301 | component | Adopts src/shared/kanna-system-prompt.ts into codemap (currently uncharted) so future lookups resolve | Codemap update: c3x set c3-301 codemap-include 'src/shared/kanna-system-prompt.ts' |
| c3-2 | container | Owns src/server/app-settings.ts which gains the new field; file currently uncharted | Codemap update: c3x set c3-2 codemap-include 'src/server/app-settings.ts' (or attach to an existing server component if owner prefers); update Responsibilities only if app-settings is split into its own component |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | Global prompt must reach Claude (systemPrompt.append) AND Codex (developer_instructions) on identical contract so transcript UI never branches per provider | comply |
| ref-local-first-data | New setting persists to ~/.kanna settings file via the existing AppSettingsManager atomic-write path | comply |
| ref-zustand-store | UI bind uses the existing appSettingsStore patch action; no new local Zustand store | comply |
| ref-strong-typing | New field crosses client↔server (patch envelope), server↔provider (turn args), and shared types — every boundary named | comply |
| ref-event-sourcing | Cited by c3-210 which this ADR touches; review confirms the global prompt is configuration state in settings.json, not an event-sourced domain mutation, so the event log path is untouched | review |
| ref-cqrs-read-models | Cited by c3-207 / c3-208 in adjacent paths; review confirms settings have no read-model projection, UI consumes the manager snapshot directly via the existing app-settings broadcast — pattern preserved | review |
| ref-tool-hydration | Cited by c3-210 which this ADR touches; review confirms tool-call hydration is downstream of streamed transcript events and never reads the system-prompt suffix, so c3-303 normalization is out of path | review |
| ref-colocated-bun-test | New .test.ts files sit next to changed source | comply |
| ref-ws-subscription | Patch envelope reuses the existing appSettings/patch command; no new WS message kind | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | globalPromptAppend flows across four typed boundaries (WS envelope, AppSettings types, Codex turn args, shared prompt builder) — each gets a concrete named type | comply |
| rule-colocated-bun-test | New tests for normalizeAppSettings, buildKannaSystemPromptAppend, codex-app-server developer_instructions wiring, SettingsPage UI sit next to their source files | comply |
| rule-zustand-store | UI state for the textarea is server-derived; writes use the existing appSettingsStore patch action — no new local Zustand store, server truth stays in useKannaState | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared types | Add globalPromptAppend: string to AppSettingsSnapshot, AppSettingsPatch, AppSettingsFile in src/shared/types.ts and src/server/app-settings.ts; default "" | typed field declared in both shared and server modules |
| Settings normalize | Add normalizeGlobalPromptAppend(value, warnings) — trim, cap 8000 chars, warn on overflow; wire into normalizeAppSettings, toFilePayload, toSnapshot, applyPatch, toComparablePayload | helper exported; default ""; warnings emitted on overflow |
| Settings setter | Add AppSettingsManager.setGlobalPromptAppend(text) that calls writePatch({ globalPromptAppend: text }) | manager method present; reused by WS handler |
| Prompt builder | Extend buildKannaSystemPromptAppend(subagents, opts?) with opts.globalPromptAppend; splice ## Project instructions block after BASE, before roster; trim and skip if blank | snapshot test confirms ordering; omitted opts = byte-identical legacy output |
| Claude SDK wiring | src/server/agent.ts and src/server/subagent-provider-run.ts read appSettings.getSnapshot().globalPromptAppend and pass via opts to buildKannaSystemPromptAppend | both paths call same builder |
| Claude PTY wiring | src/server/claude-pty/driver.ts and the subagent starter receive the builder output unchanged via --append-system-prompt | string passed through unmodified |
| Codex args | Extend StartCodexTurnArgs with developerInstructions?: string in src/server/codex-app-server.ts; replace developer_instructions: null (line 1083) with args.developerInstructions?.trim() ? args.developerInstructions.trim() : null | grep developer_instructions: null returns 0 hits after change |
| Codex caller | agent-coordinator Codex branch (agent.ts) and subagent Codex starter (subagent-provider-run.ts) pass settings value into startTurn | both main + subagent Codex paths fed |
| UI field | New section in src/client/app/SettingsPage.tsx with Textarea primitive bound to appSettingsStore; helper text "Appended to every Claude and Codex turn (main + subagents)" with char counter (limit 8000); save disabled when over cap | snapshot test; appSettingsStore patch action exercised |
| WS patch | Confirm existing appSettings/patch envelope accepts new field via existing generic AppSettingsPatch typing | src/shared/protocol.ts compiles without new variants |
| Tests | app-settings.test.ts (normalize default, overflow warning, patch round-trip), kanna-system-prompt.test.ts (builder splices, empty parity, ordering), codex-app-server.test.ts (developer_instructions plumbed, null when blank), SettingsPage.test.tsx (textarea + char counter + save flow), subagent-provider-run.test.ts (subagent inheritance both providers) | bun test paths green |
| Codemap | c3x set c3-301 codemap-include 'src/shared/kanna-system-prompt.ts'; c3x set c3-2 codemap-include 'src/server/app-settings.ts' (or component-level if owner splits app-settings) | c3x lookup returns owner for both files |
| ADR Parent Delta | After implementation: confirm c3-116, c3-210, c3-211 contracts updated only if Components / Foundational Flow / Business Flow tables shifted; record no-delta evidence otherwise via c3x read --section | per-component c3x read diff |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| Codemap c3-301 | c3x set c3-301 codemap-include 'src/shared/kanna-system-prompt.ts' | c3x lookup src/shared/kanna-system-prompt.ts returns c3-301 |
| Codemap c3-2 | c3x set c3-2 codemap-include 'src/server/app-settings.ts' | c3x lookup src/server/app-settings.ts returns c3-2 owner |
| c3-116 settings-page | c3x write c3-116 --section 'Foundational Flow' to record the new global-instructions input row only if section actually changes; otherwise record no-delta in PR | c3x read c3-116 --section 'Foundational Flow' |
| c3-211 codex-app-server | c3x write c3-211 --section 'Business Flow' to mention developer_instructions plumb on the primary path | c3x read c3-211 --section 'Business Flow' |
| c3x check | Re-run after every mutation; must end with total ≥ 71 and issues empty | c3x check output |
| N.A surfaces | No new c3x command, validator, schema row, or hint added — feature does not change the CLI contract | N.A - ADR adds product feature, not CLI surface |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/shared/kanna-system-prompt.test.ts | Asserts (a) omitted opts → byte-identical legacy output, (b) non-empty globalPromptAppend → ## Project instructions block between BASE and roster, (c) whitespace-only treated as empty, (d) BASE remains first paragraph | green |
| bun test src/server/app-settings.test.ts | Asserts normalize default, overflow warning + truncation at 8000, patch round-trip, watcher reload preserves field | green |
| bun test src/server/codex-app-server.test.ts | Asserts turn/start payload carries developer_instructions: <text> when set, null when blank, null when whitespace-only | green |
| bun test src/client/app/SettingsPage.test.tsx | Asserts textarea renders, dispatches appSettingsStore patch action, char counter caps at 8000, save disabled when over | green |
| bun test src/server/subagent-provider-run.test.ts | Asserts subagent turn (Claude and Codex) carries the global prompt | green |
| bun run lint | --max-warnings=0 catches regressions; new types must not introduce any/unknown at boundaries | green |
| c3x check | Validates docs / codemap match after edits | total ≥ 71, issues empty |
| Manual smoke | Set textarea, send one Claude turn + one Codex turn; clear textarea, send turn; Codex turn/start payload shows null when blank, populated when set | recorded in PR description |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Five-source surface from the superseded draft (4 inherited files + user snippets) | User asked for the simple form today; file inheritance requires write-back, watcher, allowlist security check, project-root resolution per chat — none of which deliver value over a single textarea until evidence shows duplication pain. The bigger ADR remains a viable v2 if usage proves the limitation |
| Per-provider fields (claudePromptAppend + codexPromptAppend) | One global prompt was the explicit request; two fields invite drift between providers and break ref-provider-adapter symmetry; subagent inheritance would need duplicate plumbing |
| Per-project field stored on the Project type | App-global was explicitly chosen; per-project would require Project type extension, project-page settings UI, project ID propagation into prompt builder — out of scope |
| Inline edit of KANNA_SYSTEM_PROMPT_BASE constant | Constant is the refusal-policy contract; user edits would override safety language; not user-editable by design |
| New globalSystemPrompt/* WS message kinds | Existing appSettings/patch already covers the patch shape generically; new envelopes would duplicate validation and watcher wiring |
| Append to Codex same buffer as Claude (no developer_instructions) | Codex JSON-RPC has a first-class developer_instructions field; using the wire-native path is more discoverable, future-proof against Codex behavior changes, and keeps the suffix builder Claude-specific |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| User pastes a 50KB prompt — blows past context budget or trips API limits | Hard cap 8000 chars in normalizeGlobalPromptAppend; UI shows live char count + over-limit error before save; save disabled above cap | normalize test asserts truncation + warning; UI test asserts counter + disabled save above cap |
| User pastes a malicious "ignore previous instructions" override that flips refusal policy | KANNA_SYSTEM_PROMPT_BASE ships first; user text appears in a clearly-delimited ## Project instructions section the model can scope; matches Anthropic guidance for user-authored sections. No security guarantee for self-targeting jailbreaks since user operates on their own codebase by design | snapshot test confirms BASE precedes user text; documented in builder JSDoc |
| Codex developer_instructions semantics differ subtly from Claude systemPrompt.append (Codex may weight differently) | Document tradeoff in kanna-system-prompt.ts JSDoc; ship same string to both; codex-app-server test asserts wire payload | codex-app-server test green; jsdoc present |
| Subagent inheritance surprises a user who wanted clean subagent prompts | Settings textarea help text states "Applies to main and subagent turns of both providers"; subagent UI unchanged so per-subagent overrides remain available via existing subagent systemPrompt field | UI snapshot test |
| Race: watcher reloads settings mid-turn — turn uses stale value | agent-coordinator already reads snapshot once per turn at start; live edits apply to next turn (documented behavior) | unit test ensures getSnapshot() called once per turn start |
| Codemap gap means future c3x lookup on changed files still misses | This ADR schedules c3x set codemap-include for both uncharted files in Underlay C3 Changes | c3x lookup for both files returns owner after work |
| Users expect ~/.claude/CLAUDE.md inheritance based on existing CLI behavior and are surprised when Kanna ignores it | Settings section copy explicitly says "Kanna does not read CLAUDE.md or AGENTS.md from disk — paste your global instructions here"; future v2 (the superseded draft) can layer file inheritance on top | copy review during UI implementation |

## Verification

| Check | Result |
| --- | --- |
| bun test src/shared/kanna-system-prompt.test.ts | green |
| bun test src/server/app-settings.test.ts | green |
| bun test src/server/codex-app-server.test.ts | green |
| bun test src/server/subagent-provider-run.test.ts | green |
| bun test src/client/app/SettingsPage.test.tsx | green |
| bun test (full suite) | green |
| bun run lint | 0 errors, warnings ≤ current ratchet cap |
| c3x check after each mutation | total ≥ 71, issues empty |
| c3x lookup src/shared/kanna-system-prompt.ts | returns c3-301 owner |
| c3x lookup src/server/app-settings.ts | returns c3-2 owner |
| Manual Claude turn with text set | suffix contains the user text under ## Project instructions; observable via temporary debug log or transcript inspection |
| Manual Codex turn with text set | turn/start payload carries developer_instructions: <text>; observable via JSON-RPC log |
| Manual turn with text cleared | Codex turn/start shows developer_instructions: null; Claude suffix carries BASE only |
