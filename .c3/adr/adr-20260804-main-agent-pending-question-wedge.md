---
id: adr-20260804-main-agent-pending-question-wedge
c3-seal: 054e4714c6595a6031e9e4cdac3ebb1abf73ff4625ca68970ee2cf65df1dae4e
title: main-agent-pending-question-wedge
type: adr
goal: 'Close every path by which a parked main-agent `AskUserQuestion` can wedge a chat forever, and give the user one reliable place to answer it. Four changes: the result matcher must never claim a session-rebuilt ghost turn; an `ActiveTurn` is never dropped while holding an unresolved `pendingTool`; `cancelChat` resolves that promise for every provider so Stop can always recover; and the actionable question card moves to the transcript footer with the inline row degraded to a non-actionable pointer.'
status: proposed
date: "2026-08-04"
---

## Goal

Close every path by which a parked main-agent `AskUserQuestion` can wedge a chat forever, and give the user one reliable place to answer it. Four changes: the result matcher must never claim a session-rebuilt ghost turn; an `ActiveTurn` is never dropped while holding an unresolved `pendingTool`; `cancelChat` resolves that promise for every provider so Stop can always recover; and the actionable question card moves to the transcript footer with the inline row degraded to a non-actionable pointer.

## Context

Session `df3b55b4` sat wedged for 45 minutes. The main agent called native `AskUserQuestion`; the turn parked at `stop_reason:"tool_use"` and never received a `tool_result`.

Two Claude-Code background `Task`/local_agent runs kept streaming into the SAME transcript below the question — 124 `tool_call` + 124 `tool_result` + 6 `assistant_text`. The card rendered, but at row 149 of 407; the view auto-scrolled with the streaming output and never showed it. The only visible sign was "Background task completed: ...".

`adr-20260618-subagent-pending-question-footer-surface` solved this shape for subagent questions and explicitly justified leaving the main agent alone: "The main agent's own AskUserQuestion does not have this problem because it is naturally the last transcript entry." Background tasks falsify that. `isLatest` compounds it — `getLatestToolIds` means "latest UNRESOLVED", not "last on screen".

Underneath sat a harder defect. On the legacy `canUseTool` path (`KANNA_MCP_TOOL_CALLBACKS` unset, the default) the parked request is only an in-memory promise; `pendingTool.resolve` IS the SDK worker's continuation. When the SDK self-resumes after a background-task notification it calls `canUseTool` outside any Kanna turn, so `recreateActiveTurnFromSession` rebuilds a ghost `ActiveTurn` and parks the resolve there. A ghost sent no prompt and so has no `claudePromptSeq` — and the result matcher read `active.claudePromptSeq ?? null`, coercing `undefined` to `null` so the ghost matched ANY null completed seq and was deleted. The resolve was orphaned, and `respondTool` could only throw "No pending tool request".

Stop could not recover it either: `cancelChat` resolved `pendingTool` only for `codex` + `exit_plan_mode`. Under the SDK driver `interrupt()` is in-band and the session survives, so nothing ever freed the worker.

Separately, `handleSubmit` called `markSubmitted()` before `onSubmit()` and `handleAskUserQuestion` swallowed throws into `setCommandError`, so a rejected submit left the card reading "Answers" while the turn stayed parked.

## Decision

Server. Flag rebuilt turns `rebuiltFromSession` and require a non-null `claudePromptSeq` in the result matcher — two conjuncts stating one invariant, no prompt means no finalize. Add `settlePendingTool()` called at both `activeTurns.delete` sites in the session runner, encoding "never drop a turn holding an unresolved pendingTool". Make `cancelChat` resolve for every provider and tool kind. Because settling uses `discardedToolResult` and `buildCanUseTool`'s legacy branch maps ANY result to `behavior:"allow"`, short-circuit `discarded === true` to `behavior:"deny"` in the same change — otherwise the SDK executes the tool with empty answers and overwrites the transcript's "Discarded" marker.

Client. Reuse the existing footer surface rather than inventing one: render the actionable card in `listFooter` and degrade the inline row via a new `askUserQuestionSurface` render-context option. Chosen over a 12th drilled row prop (`KannaTranscriptRowProps` is already 11 props and `AskUserQuestionMessage` already consumes the context) and over forcing `isLatestAskUserQuestion: false` (that reuses the "newer question active" copy, which is factually wrong here, and `buildResolvedTranscriptRows` is shared with the share view). The provider is always mounted and only its value flips, because mounting it conditionally would remount every row and reset per-row scoped stores. The selector reads props the viewport already holds, so no server, protocol or read-model change.

Add a `markSubmitFailed` store transition so a rejected submit rolls the optimistic card back, and have `handleAskUserQuestion` rethrow after `setCommandError` (mirroring `handleSend`). The callback type widens to `void | Promise<void>` rather than narrowing, so existing `() => undefined` callers still type-check.

No jump-to-message affordance: `scrollToIndex` is never called anywhere in `src/`, raw `document`/`requestAnimationFrame` are banned in `src/client/**`, and once the card is in the footer it is unnecessary.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns turn lifecycle: ghost-turn marker, settlePendingTool, cancel resolve, canUseTool deny | c3-210#n7317@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events." | Confirm the pending-tool invariant holds at every activeTurns.delete site |
| c3-112 | component | Chat-page viewport owns transcript placement + listFooter; hosts the new selector and card | c3-112#n6459@v1:sha256:89bb431e754fa1a8693b69fa0521167a524dec5a6ce38f056c97383dc0904281 "Compose the chat route: transcript viewport, input dock, terminal workspace, focus policy, and sidebar actions." | Confirm the footer consumes existing props only, no new write path |
| c3-114 | component | Messages-renderer owns AskUserQuestionMessage, its store and the render context | c3-114#n6558@v1:sha256:27c34f0051a7a59d7cab24990ec538a17e38cf2740694a17b24b0257ac9fc82f "Render each transcript entry kind (text, tool call, write_file, delete_file, plan, diff, ...) consistently, with collapse/expand and status." | Confirm the new option defaults to inline so share view is unchanged |
| c3-113 | component | Transcript row prop types widen for the async submit callback | c3-113#n6509@v1:sha256:68338f01f4cf15c1a18910c74d93fcb2df72a41847b9a859c5439843f0a8e4f7 "Render a hydrated list of transcript entries (text, tool calls, plan dialogs, diffs) with virtualized scrolling and sticky focus." | Confirm the widening breaks no existing caller |
| c3-110 | component | useKannaState.handleAskUserQuestion now rethrows | c3-110#n6356@v1:sha256:8d467214a2dbc5cf341cd31b54660de18b2f9baef295c94a728736a1b1c49b29 "Own the top-level React shell: routing, Kanna state hook (useKannaState), socket wiring, global keybindings, and layout chrome." | Confirm commandError behaviour is preserved |
| c3-0 | system | Kanna system: the wedge spans client and server halves of one interaction | c3-0#n3@v1:sha256:c9f10a833b3e499d1329f9637c65ac8e7c7b9f78b6210e91ff3f44b8d31e38bc "${GOAL}" | Confirm no system-level responsibility moves |
| c3-2 | container | Server container holds the turn-lifecycle component | c3-2#n6815@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce "Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models." | No container responsibility change; verify no-delta |
| c3-1 | container | Client container holds the viewport, transcript and messages-renderer | c3-1#n6177@v1:sha256:e6ee951578f4d61705ac19fe636ff75594655216f900a12ae302ea0a1d8607a8 "Render the chat experience: hydrate transcripts, accept input, drive sidebar/settings, and stay synchronized with server state via WebSocket subscriptions." | No container responsibility change; verify no-delta |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-cqrs-read-models | The footer selector is a pure read over existing props; it must never trigger a write or replay | ref-cqrs-read-models#n8928@v1:sha256:768802027896fc8c9ebd415cf63483f64e0c5f2f4bc10f21079a8f7d51c38dcd "Separate write path (event log) from read path (derived views) so subscribers consume fast snapshots without replaying the log." | comply |
| ref-strong-typing | New store field, render-context option and selector cross component boundaries as named types | ref-strong-typing#n9098@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af "No any / untyped shapes at boundaries — everything that crosses client↔server, provider↔coordinator, or log↔read-model is a named type in src/shared or " | comply |
| ref-colocated-bun-test | New behaviour ships colocated tests next to each changed file | ref-colocated-bun-test#n8895@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(x), and run under bun test — no separate test directory, no framework churn." | comply |
| ref-event-sourcing | The pending-tool fix touches turn finalization, which appends turn events; the invariant must not skip recordTurnFinished for real turns | ref-event-sourcing#n8961@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa "Every state mutation is first captured as an immutable event appended to a JSONL log; system state is derived by replay + periodic snapshot compaction." | comply |
| ref-provider-adapter | Cancel now resolves for every provider, so the behaviour must stay provider-agnostic | ref-provider-adapter#n9027@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 "Normalize Claude Agent SDK and Codex App Server into one transcript + tool-call model so the UI never branches on provider." | comply |
| ref-tool-hydration | The footer reuses AskUserQuestionMessage, so the pending card must not gain a provider-specific shape | ref-tool-hydration#n9131@v1:sha256:376e5fee261bd3b463633f19523020439854d9bd11ddc28ff5cffe12d8ed485e "Provider tool calls (Read, Edit, Bash, plan, diff, ...) are normalized into unified transcript entries by src/shared/tools.ts before rendering." | comply |
| ref-ws-subscription | handleAskUserQuestion rethrows on the typed WS command path consumed by the viewport | ref-ws-subscription#n9164@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc "A single typed WebSocket handles both subscriptions (push) and commands (pull), with a shared envelope defined in src/shared/protocol.ts." | comply |
| ref-local-first-data | Reached only via the container/system rows; this change adds no persisted state | ref-local-first-data#n8994@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 "All persistent state sits" | N.A - no new persisted state introduced |
| ref-side-effect-adapter | Reached only via the container row; no new IO is introduced, the changes are pure lifecycle bookkeeping | ref-side-effect-adapter#n9059@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee "Keep every" | N.A - no new side effect added |
| ref-zustand-store | AskUserQuestionMessage.store gains a named intent action, so the scoped-store shape applies | ref-zustand-store#n9197@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e "Client UI state lives in sma" | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Colocated *.test.ts(x) beside every changed file | rule-colocated-bun-test#n9232@v1:sha256:6c733a6bc908ab2c89a563a0429d06eb34d56731aaa4a18067213c18dbdf6c8f "All test files must live in the same directory as the file under test" | comply |
| rule-zustand-store | markSubmitFailed is a named intent action returning state unchanged on a no-op; the failure handler stays a useCallback because it closes over a prop and does async I/O | rule-zustand-store#n9325@v1:sha256:d92b52e39b6ad64907dab5d72c1b7947ce17ec843608f5468931826f343b5bb5 "Client state stores take exactly two forms." | comply |
| rule-strong-typing | New store field, render-context option and selector cross component boundaries as named types | rule-strong-typing#n9293@v1:sha256:ab9d03265e99a9527350c213d779cbb270675fd943f331a80652bf0b80e692f8 "All boundary types must be named exports" | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Ghost turn | rebuiltFromSession flag + non-null seq conjunct in the result matcher | src/server/claude-session-runner.ts |
| Pending-tool invariant | settlePendingTool() at both activeTurns.delete sites | src/server/claude-session-runner.ts |
| Cancel | resolve for every provider; discarded to deny in buildCanUseTool | src/server/claude-cancel-handler.ts |
| Footer surface | selectPendingMainQuestion + listFooter card + always-mounted provider | src/client/app/ChatPage/ChatTranscriptViewport.tsx |
| Inline degradation | askUserQuestionSurface option + shared QuestionSummaryCard | src/client/components/messages/AskUserQuestionMessage.tsx |
| Submit rollback | markSubmitFailed transition + rethrow in handleAskUserQuestion | src/client/components/messages/AskUserQuestionMessage.store.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI / validator / schema surface changes | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| claude-session-runner.test.ts | A result does not finalize a ghost holding a pendingTool; a parked resolve is settled on stream end; two regression guards pin the real-turn path both ways | bun test src/server/claude-session-runner.test.ts |
| claude-cancel-handler.test.ts | Table-driven over provider x toolKind asserting the discarded payload resolves; append happens before resolve | bun test src/server/claude-cancel-handler.test.ts |
| AskUserQuestionMessage.test.tsx | Rejected submit rolls back and shows the error; footer surface degrades to a non-actionable pointer; readonly still wins | bun test src/client/components/messages/AskUserQuestionMessage.test.tsx |
| ChatTranscriptViewport.test.tsx | selectPendingMainQuestion returns the buried unresolved question and nulls on resolved / wrong kind / missing id | bun test src/client/app/ChatPage/ChatTranscriptViewport.test.tsx |
| render-context.test.tsx | Provider publishes a referentially stable value and mounts without a render loop | bun test src/client/components/messages/render-context.test.tsx |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Route the SDK driver through the durable tool-callback protocol | Largest blast radius: changes which component renders the card and the answer RPC. Deferred; the wedge is fixable without it |
| Force isLatestAskUserQuestion false on the inline row | Reuses the "newer question active" copy, which is factually wrong here, and buildResolvedTranscriptRows is shared with the share view |
| Add a 12th drilled prop to KannaTranscriptRowProps | AskUserQuestionMessage already consumes the render context; drilling duplicates a seam that exists |
| A jump-to-question button | scrollToIndex is never called in src/ and raw DOM access is banned in src/client/**; the footer makes it unnecessary |
| Reject rather than resolve the parked promise on cancel | A rejection surfaces as an unhandled transport error inside the SDK worker |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The non-null-seq conjunct starves a legitimately seq-less turn | Two regression guards pin both directions; claude-turn-starter assigns a seq to every real turn before sending | claude-session-runner.test.ts |
| Two actionable answer surfaces | The footer branch sits after !isLatest and the selector re-checks !result; unique footer testid | AskUserQuestionMessage.test.tsx |
| Render loop from the new context consumer | Provider value memoized and callers pass module-level consts; loop-check test added | render-context.test.tsx |
| Whole-list remount on question transitions | Outer provider always mounted; only its value flips | Manual: tool-group expansion survives a question appearing |
| Flipped cancel test read as a regression | Called out in the PR body; the codex case is kept green as the no-regression proof | claude-cancel-handler.test.ts |
| Rollback loses the user's picks | submittedAnswers is retained; AskUserQuestionInteractive's own draft state still resets on remount (documented limitation) | AskUserQuestionMessage.store.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test | pass (4468 pass, 2 skip, 0 fail) |
| bun run typecheck | clean |
| bun run lint | clean (0 errors, 0 warnings) |
| bunx ast-grep test | ok, 14 passed |
| Tests verified red before the fix | 6 fail for the rollback pair, 2 fail for render-context, 2 fail for the ghost-turn pair, 5 fail for cancel |
