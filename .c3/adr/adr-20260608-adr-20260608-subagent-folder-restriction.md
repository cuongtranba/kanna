---
id: adr-20260608-adr-20260608-subagent-folder-restriction
c3-seal: 8accfcc76a88148186076825f5d0d28e8afa734e16746e7c979cabd417c9d733
title: adr-20260608-subagent-folder-restriction
type: adr
goal: Add per-subagent filesystem restriction so a configured subagent can only read, write, glob, grep, edit, or shell inside a user-declared subtree of the parent chat's cwd. The decision authorizes two new optional fields on `Subagent` — `workingDir` (cwd override) and `allowedPaths` (root whitelist) — and wires them through claude-pty + claude-sdk subagent spawns so the model has no path to bypass them.
status: accepted
date: "2026-06-08"
---

## Goal

Add per-subagent filesystem restriction so a configured subagent can only read, write, glob, grep, edit, or shell inside a user-declared subtree of the parent chat's cwd. The decision authorizes two new optional fields on `Subagent` — `workingDir` (cwd override) and `allowedPaths` (root whitelist) — and wires them through claude-pty + claude-sdk subagent spawns so the model has no path to bypass them.

## Context

Today every subagent inherits the parent chat's `args.cwd` verbatim (`src/server/subagent-provider-run.ts:143,214`) and the parent chat's full tool surface. The `Subagent` interface in `src/shared/types.ts:163` has no folder, root-list, or cwd field. The existing `readPathDeny` / `writePathDeny` in `c3-226 kanna-mcp-host` (enforced by `c3-204 permission-gate`) is global per-chat — it cannot be narrowed per delegated run, and it only blocks `mcp__kanna__*` shims, leaving native `Read` / `Edit` / `Bash` unrestricted.

User pressure: trusted-but-bounded subagents (docs editor, single-package reviewer, restricted CI helper) need a hard boundary so a buggy or runaway model cannot touch the rest of the repo. Codex App Server has a separate native tool surface (`shell`, `read_file`, `write_file`, `apply_patch`) outside the kanna-mcp shim path, so Codex parity is explicitly **out of scope for this ADR** and routes to a follow-up.

Affected topology: subagent type (`c3-301`), subagent orchestration (`c3-210`), claude-pty driver (`c3-225`), kanna-mcp host + permission gate (`c3-226`), path normalization (`c3-204`), settings UI (`c3-116`), wire protocol for subagent CRUD (`c3-302`), event-store schema for subagent persistence (`c3-206`).

## Decision

1. Extend `Subagent`, `SubagentInput`, `SubagentPatch` with:
`workingDir?: string` — optional path relative to the parent chat cwd; absolute paths rejected at validation; resolved through `c3-204 paths-config` (`resolveAllowedRoot`) so symlink escapes (`realpath`) are folded before persist.

`allowedPaths?: string[]` — non-empty list of roots, same resolution rules as `workingDir`. Each root must be inside the parent chat cwd. Empty / unset = no path restriction.

2. **Claude PTY + SDK subagent spawn (`c3-210 → c3-225`)**: when either field is set on the picked subagent, `subagent-provider-run.ts` passes the resolved `cwd` (parent cwd joined with `workingDir`) and `allowedPaths` into the driver. PTY driver appends `Read Edit Write Bash Glob Grep WebFetch` to `PTY_DISALLOWED_NATIVE_TOOLS` for that spawn and emits `--tools "mcp__kanna__*"` so only kanna shims reach the FS. SDK driver passes the same `disallowedTools` list through SDK options; its existing `canUseTool` already routes to the shims.
3. **`c3-226 kanna-mcp-host`** registers per-run `readPathDeny` / `writePathDeny` derived from the subagent's `allowedPaths` for the lifetime of that subagent run (via the existing `delegationContext` + `subagentOrchestrator` wiring). Path-deny becomes a per-run scope, not just per-chat.
4. **Codex (`c3-211 codex-app-server`)** is explicitly OUT for v1. A subagent configured with `workingDir` / `allowedPaths` whose `provider === "codex"` fails validation at save time (`subagent.validate` returns a new `RESTRICTION_NOT_SUPPORTED` error) until a follow-up ADR wires codex tool gating.
5. Settings UI (`c3-116 settings-page`) gets two new optional inputs under the subagent form: working directory (single text field, relative path) and allowed paths (newline-separated). Validation messages surface through the existing `SubagentValidationError` path.

Why this approach: it reuses the path-deny machinery already shipped in c3-226 / c3-204 (no new enforcement layer), uses the same `--disallowedTools` shape already used for `AskUserQuestion` / `ExitPlanMode` / `ScheduleWakeup` in PTY (proven pattern), and keeps the subagent record the single source of truth so the restriction survives spawn / restart / event replay.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-301 | component | Subagent / SubagentInput / SubagentPatch get two new optional fields | Contract row added for the new fields; strong-typing rule compliance review |
| c3-210 | component | delegateRun + sendToLiveRun must thread the resolved cwd + allowedPaths into the provider-run handle and into the per-run path-deny registration | Contract review on delegateRun / sendToLiveRun signatures; verify no new side-effect import lands in coordinator (must go through paths-config) |
| c3-225 | component | Driver receives a different cwd than the parent chat and appends Read/Edit/Write/Bash/Glob/Grep/WebFetch to the disallowed-native-tools list per spawn | Contract review on StartClaudeSessionPtyArgs; smoke-test the existing --disallowedTools / --tools wiring still passes |
| c3-226 | component | Path-deny becomes per-run scope; createToolCallbackService + permission gate need a per-run override layered on top of the per-chat deny lists | Contract review on the path-deny surface; rule compliance for kanna-mcp shim envelope |
| c3-204 | component | New helper resolveSubagentRoots(parentCwd, workingDir?, allowedPaths?) folds realpath, rejects parent-escape, and returns the canonical absolute roots | Confirms no new direct fs side effect leaks outside paths-config; ref-side-effect-adapter compliance |
| c3-116 | component | Adds two form inputs + surfaces new validation errors | Confirm zustand store shape unchanged; rule-zustand-store compliance |
| c3-302 | component | Settings RPCs (subagent.create / subagent.update) carry the two new optional fields on the wire | Strong-typing review for the WS envelope shape |
| c3-206 | component | Subagent-created / subagent-updated events carry the two new optional fields; replay must populate them as undefined for old events | Event-sourcing review; back-compat replay test |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | All four new wire surfaces (Subagent, SubagentInput, SubagentPatch, settings RPC) cross the client↔server boundary and must be typed end-to-end with named fields, never widened to string or any | comply |
| ref-side-effect-adapter | New path resolution (realpath, parent-escape check) is a node:fs side effect; must land inside c3-204 paths-config or a *.adapter.ts file, never in subagent-provider-run.ts or agent-coordinator.ts | comply |
| ref-event-sourcing | Subagent fields persist via the event log; the new fields ride on existing subagent-created / subagent-updated events; old events must replay safely with the new fields undefined | comply |
| ref-provider-adapter | Decision deliberately leaves codex on the un-gated path for v1; provider-adapter normalization still holds (subagent restriction is enforced upstream at coordinator, not inside the adapter) | review |
| ref-colocated-bun-test | New code in c3-210, c3-225, c3-206 (cited owners) needs colocated *.test.ts coverage for the restriction threading, driver arg builder, and event-store replay | comply |
| ref-local-first-data | c3-226, c3-204, c3-116, c3-206 (cited owners) keep all subagent state under ~/.kanna; new fields persist via the same local event log, no new external store | comply |
| ref-tool-hydration | c3-210 and c3-226 cite tool-call hydration; restriction is enforced before the shim runs, so the existing hydrated tool-call transcript is unchanged | review |
| ref-ws-subscription | c3-302 cites WS subscription; settings RPC envelopes carry the two new optional fields and keep the single typed WebSocket contract | comply |
| ref-zustand-store | c3-116 stores subagent edit form state in a zustand slice; new fields keep the existing store shape (string + string list) | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New fields cross client↔server (settings RPC), JSONL↔read-model (event store), and provider↔coordinator (subagent-provider-run args). Each surface must be a named type, not a loose object | comply |
| rule-colocated-bun-test | Every new code path (validation, paths-config helper, driver arg builder, settings form) ships a colocated *.test.ts; PTY restriction smoke needs a live-API style test gated by env, named *.live.test.ts if it spawns claude | comply |
| rule-mcp-name-reserved | Restriction does not change the kanna MCP server name reservation; new path-deny scope reuses the existing mcp__kanna__* surface | review |
| rule-zustand-store | c3-116 subagent edit form stores the two new fields in the existing zustand slice; rule says all client UI-local state lives in zustand with stable refs | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Types | Add workingDir + allowedPaths to Subagent / SubagentInput / SubagentPatch; add RESTRICTION_NOT_SUPPORTED + INVALID_PATH + PATH_ESCAPE to SubagentValidationErrorCode | src/shared/types.ts:163-207 |
| Paths-config | Add resolveSubagentRoots(parentCwd, workingDir?, allowedPaths?) returning { cwd, allowedPaths } with realpath + parent-escape rejection; pure module, no direct fs caller outside an existing adapter | src/server/paths-config* |
| Event-store | Make subagent-created + subagent-updated events carry the two optional fields; replay test asserts old events deserialize cleanly with undefined fields | src/server/events.ts, src/server/event-store.ts |
| Subagent validation | Server-side validate rejects absolute paths, escape paths, empty allowedPaths array (use undefined instead), and codex provider with any restriction set | src/server/subagent-orchestrator.ts validate path |
| Agent coordinator | delegateRun + sendToLiveRun resolve restriction once via paths-config and pass into the provider-run handle + per-run path-deny registration | src/server/agent-coordinator.ts, src/server/subagent-orchestrator.ts |
| Provider run (claude PTY + SDK) | subagent-provider-run.ts threads resolved cwd into StartClaudeSessionArgs; appends Read Edit Write Bash Glob Grep WebFetch to disallowed natives; emits --tools "mcp__kanna__*" when restriction is set | src/server/subagent-provider-run.ts |
| kanna-mcp per-run path-deny | createToolCallbackService gains a per-run scope keyed by delegation runId; permission-gate consults the per-run roots before the per-chat deny | src/server/kanna-mcp.ts, src/server/permission-gate.ts, src/server/tool-callback.ts |
| Settings UI | Subagent edit form gains two inputs; surfaces validation errors from the new error codes | src/client/app/settings/* |
| Protocol | WS settings RPC subagent.create / subagent.update payload extended with the two optional fields | src/shared/protocol.ts |
| Codex guard | Provider-aware validation rejects restriction on codex subagents until follow-up ADR lands | src/server/subagent-orchestrator.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-301 Contract | Add Contract row for the new Subagent restriction fields surface (direction OUT, target c3-210, evidence src/shared/types.ts) — workingDir + allowedPaths optional, validated as relative to parent cwd | c3x read c3-301 --section Contract |
| c3-210 Contract | Amend delegateRun + sendToLiveRun rows to note restriction threading; add Per-run path-deny scope row (direction IN, target c3-226) resolving subagent restriction via c3-204 and registering per-run roots in c3-226 path-deny | c3x read c3-210 --section Contract |
| c3-225 Contract | Add Subagent restriction args Contract row (direction IN, target c3-210) — StartClaudeSessionArgs accepts resolved cwd + allowedPaths; spawn extends PTY_DISALLOWED_NATIVE_TOOLS with Read Edit Write Bash Glob Grep WebFetch and emits --tools mcp__kanna__* when restriction is set | c3x read c3-225 --section Contract |
| c3-226 Contract | Amend Path deny enforcement row to note per-run scope layered on per-chat deny; cite createToolCallbackService per-run override | c3x read c3-226 --section Contract |
| c3-204 Contract | Add resolveSubagentRoots Contract row (direction OUT) — resolves workingDir + allowedPaths against parent cwd, rejects parent-escape and absolute paths | c3x read c3-204 --section Contract |
| N.A - no new rules / refs / recipes added | N.A - decision reuses existing rule-strong-typing, ref-side-effect-adapter, ref-event-sourcing | N.A - cited in Compliance Refs and Compliance Rules tables of this ADR |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| Server-side subagent validation | Rejects absolute path, parent-escape, codex+restriction, empty allowedPaths array | src/server/subagent-orchestrator.ts validate; bun test src/server/subagent-orchestrator.test.ts |
| paths-config unit test | resolveSubagentRoots rejects parent-escape via realpath + lexical check; round-trips a valid subtree | src/server/paths-config.test.ts |
| Provider-run unit test | Asserts disallowed-natives list includes Read/Edit/Write/Bash/Glob/Grep/WebFetch when restriction is set; cwd passed through | src/server/subagent-provider-run.test.ts |
| kanna-mcp per-run deny test | Asserts a shim call with a path outside allowedPaths returns isError; per-chat deny still applies when no per-run scope | src/server/kanna-mcp.test.ts, src/server/permission-gate.test.ts |
| Event-store replay test | Old subagent-created event (no new fields) replays with workingDir / allowedPaths undefined | src/server/event-store.test.ts |
| Lint side-effect seal | Continued bun run lint passes; no new node:fs caller outside paths-config / *.adapter.ts | bun run lint |
| Live PTY restriction smoke | Live test spawns a restricted claude subagent and confirms an off-root Read fails | src/server/subagent-provider-run.live.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| workingDir only (no allowedPaths) | Subagent can still write outside the chroot via absolute paths from Bash or native Edit; the cwd is just a shell convenience, not a security boundary in PTY mode |
| allowedPaths only (no workingDir) | Relative paths in tool calls still resolve against the parent chat cwd, so the subagent keeps full visibility of unrelated files via tab-completion / glob discovery before path-deny fires; defense-in-depth needs both |
| Block at shim only (KANNA_MCP_TOOL_CALLBACKS=1) without disallowing native tools | Claude can call native Read / Edit / Bash that bypass mcp__kanna__* entirely, so path-deny becomes theater; PTY already proved the disallow-native pattern works for AskUserQuestion / ExitPlanMode / ScheduleWakeup |
| Include codex in v1 | Codex App Server has its own native tool surface (shell, read_file, write_file, apply_patch) that does not flow through kanna-mcp, so codex needs a separate gate; bundling it would double the ADR scope and delay claude-side restriction |
| Per-chat config instead of per-subagent | A chat is a runtime concept; the restriction belongs to the subagent identity so it survives across chats and across event replay |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Symlink escape (subagent uses ln -s outside the root) | resolveSubagentRoots calls realpath on every root and rejects roots that escape parent cwd post-resolution; per-run path-deny re-resolves on every shim call so a symlink created mid-run is also caught | src/server/paths-config.test.ts symlink escape case |
| Native tool surface drift (Anthropic adds a new built-in FS tool not in our disallowed list) | PTY smoke-test asserts --tools "mcp__kanna__*" whitelist is the canonical filter (allowlist beats denylist); document the allowlist policy in c3-225 Contract | Smoke test in src/server/subagent-provider-run.live.test.ts asserts off-allowlist tool is rejected |
| Per-run path-deny scope leaks across runs | Scope keyed on delegation runId; cleared in the same onRunTerminal hook that releases the permit; test asserts no cross-run pollution | src/server/kanna-mcp.test.ts cross-run isolation case |
| Old subagent records (no restriction fields) regress | All new fields optional, default to undefined; replay test pins back-compat | src/server/event-store.test.ts old-record replay case |
| User configures restriction on a codex subagent and is confused | Server-side validation returns RESTRICTION_NOT_SUPPORTED with a clear message pointing to the follow-up ADR slot; UI surfaces it inline | src/server/subagent-orchestrator.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/subagent-orchestrator.test.ts src/server/subagent-provider-run.test.ts src/server/paths-config.test.ts src/server/kanna-mcp.test.ts src/server/permission-gate.test.ts src/server/event-store.test.ts | all green |
| bun run lint | zero errors, warning count unchanged or lower |
| c3x check | passes with no drift |
| Live smoke: spawn a restricted claude subagent (PTY) targeting a single subdir; ask it to read a sibling file outside the subtree | shim returns isError; transcript shows the rejection |
| Live smoke: same as above on SDK driver | canUseTool routes to the shim; shim returns isError |
| Manual UI check: create a subagent with workingDir=docs and allowedPaths=docs,wiki; save; reopen edit form | fields round-trip; validation rejects an absolute path or ../foo |
