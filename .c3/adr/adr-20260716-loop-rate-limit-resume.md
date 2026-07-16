---
id: adr-20260716-loop-rate-limit-resume
c3-seal: 1f8bd69014e4c27b0347037b6a675eff6dd27828355806e5b53d63a60b0854f3
title: loop-rate-limit-resume
type: adr
goal: |-
    Stop an armed autonomous loop from silently dying when its orchestrator wake
    turn hits a Claude usage limit, and give the user an observable per-chat
    "Progress" panel showing the loop's per-round work and its rate-limit state.
status: proposed
date: "2026-07-16"
---

# ADR — Loop rate-limit resume resilience + Loop Progress panel

## Goal

Stop an armed autonomous loop from silently dying when its orchestrator wake
turn hits a Claude usage limit, and give the user an observable per-chat
"Progress" panel showing the loop's per-round work and its rate-limit state.

## Context

A real 19.5h loop session (`67d9b0d2-…`) spent ~10h dead-idle, dominated by one
9h stall: at 00:49 a background-subagent completion woke the loop, the wake turn
immediately returned a synthetic `result` with `api_error_status: 429`
("You've hit your limit · resets 4:10am (Asia/Saigon)"), and the loop then
terminated with NO resume schedule. Root cause: the errored-`result` handling in
`runClaudeSession` (agent.ts) runs only inside the prompt-seq gate
`event.entry.kind === "result" && active && completedClaudePromptSeq ===
active.claudePromptSeq`. A synthetic 429 result arriving with the pending
prompt-seq queue drained fails that gate and — because there is no else-branch
and the `catch` block only handles THROWN errors — limit detection never runs.
The notification-driven loop terminates on absence of delegation, so it died
until the user manually typed "resume" 9h later. Separately, the loop is opaque:
there is no UI showing which chunks ran or that it is rate-limited.

## Decision

Two changes. (1) Add a fallback in `runClaudeSession`: when an errored `result`
misses the prompt-seq gate, still run `detectFromResultText` →
`handleLimitDetection` / auth detection. `handleLimitDetection` is idempotent
(dedupes on a live schedule) and already honours the auto-resume setting
(rotate → accept@reset if setting on → propose if off), so this only ever adds a
missing resume, never a duplicate. The user chose "respect the auto-resume
setting": off ⇒ a visible proposal, on ⇒ auto-resume at reset. (2) Surface a
per-chat Loop Progress read-model on the existing `ChatSnapshot` (no new WS
topic): each top-level background delegation since the loop armed becomes one row
with pending/running/done/failed status; a rate-limited loop shows a "resume at
<time>" row with a Resume action wired to the existing auto-continue accept.
Rows are labelled from the first line of the delegate prompt, captured on
`subagent_run_started`.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-227 | component | Errored-result limit detection made reachable off the seq-gate; LoopState gains armedAt for row filtering; rate-limit view exposed to the loop panel. | c3-227#n7575@v1:sha256:0ef718fb27e7c02a2e8fbf87c689c52d8fff12f8b2db15415c79e8d40e8dca12 "Detect provider rate-limit and auth-error endings on a Kanna chat," | Confirm idempotent scheduling + setting-respecting branches unchanged. |
| c3-207 | component | ChatSnapshot gains loopProgress derived via pure buildLoopProgress; subagent-run projection carries the new label. | c3-207#n6530@v1:sha256:fcde78a59ac52af675e32b8beffd96f801400deee2a39a336bba00bef3382138 "Project events into derived views (sidebar, chat, projects, discovery) that ws-router broadcasts to clients." | Confirm read-model purity + stable-ref dedup (sameLoopProgress). |
| c3-205 | component | subagent_run_started gains optional label (prompt-derived chunk label); back-compat via optional field. | c3-205#n6427@v1:sha256:360cde9c009b55fb3b85083d974f20e76a35d969e68a6d0c27e8b9a2e5856686 "Define the typed event union (project/chat/message/turn) appended to JSONL logs." | Confirm additive/optional (older events omit it). |
| c3-112 | component | New LoopProgressSection panel mounted in the transcript footer, fed from ChatSnapshot.loopProgress; Resume wired to onAutoContinueAccept. | c3-112#n5830@v1:sha256:89bb431e754fa1a8693b69fa0521167a524dec5a6ce38f056c97383dc0904281 "Compose the chat route: transcript viewport, input dock, terminal workspace, focus policy, and sidebar actions." | Confirm stable selector ref (render-loop seal) + panel self-gates when idle. |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/agent.oauth-rotation.test.ts | New "errored rate-limit RESULT with no matching active turn still schedules a resume" regression fails before the fix, passes after (10/10). |
| bun test --conditions production src/shared/loop-progress.test.ts src/server/auto-continue/read-model.test.ts | deriveChunkLabel + buildLoopProgress + deriveLoopState.armedAt covered. |
| bun test --conditions production src/client/app/LoopProgressSection.test.tsx | Panel renders labels, self-hides when idle, Resume accepts the schedule, no render-loop warning. |
| bun run typecheck && bun run lint && bun run test | Typecheck + lint (max-warnings=0) clean; full suite 3221 pass / 0 fail. |
