---
id: adr-20260819-card-work-signal
c3-seal: aa5a9f84f6dc1648ac1fd03d0f6c2a0d88cefc6f43c0ab7421d804a771eb3693
title: A card says what is working it, over one precedence table
type: adr
goal: |-
    Replace `cardChatSignal` — which reported only a chat's `KannaStatus` — with
    `cardWorkSignal`, a precedence table over the six kinds of work `ChatActivity`
    already carries, so a board card says what is working it rather than merely
    whether its chat has a live turn. Add `ChatActivity.lastRunFailure` so a
    background agent that died is visible at all.
status: accepted
date: "2026-08-19"
relates:
    - adr-20260818-adr-20260818-chat-activity-sidebar-row
    - adr-20260811-board-in-the-workspace
---

## Goal

Replace `cardChatSignal` — which reported only a chat's `KannaStatus` — with
`cardWorkSignal`, a precedence table over the six kinds of work `ChatActivity`
already carries, so a board card says what is working it rather than merely
whether its chat has a live turn. Add `ChatActivity.lastRunFailure` so a
background agent that died is visible at all.

## Context

`cardChatSignal` answered "what is this card's chat doing" by handing the chat's
`KannaStatus` to `chatStatusIndicator` — the same table the sidebar row and the
pane tab draw from, so one chat could not read "Running" in three places and
blank on the card.

`ChatActivity` (adr-20260818) then put six kinds of work on the sidebar row, all
keyed by chat id: session, agent, workflow, loop, background task, cron. The
card had them in hand and used none of them. A card whose chat sat idle while a
loop ground through eight chunks read exactly like a card nobody had touched.

One of those six had no representation at all. `ChatActivity.agents` counts what
is RUNNING, so a background agent that DIED left no trace on any surface reading
the field — the outcome most worth seeing on a card face was the one thing
structurally invisible.

## Decision

**`cardWorkSignal` is a precedence table, first match wins**, over the six work
kinds plus failure, unread, and a bare count. A card has room for one line, so
ranking is the whole design; it is written as the table it is and tested by
asserting each row beats every row below it.

**A loop outranks a bare agent count.** An agent running under a loop is one
chunk of a plan, and `Loop · 5/8` says more than `1 agent`.

**Session state is not re-classified.** `chatStatusIndicator` still owns
status → tone, and the resulting TONE is what places a session row in the table.
So a status added there lands at a severity rather than falling through to a
bare chat count, and the card still cannot disagree with the sidebar.

**`ChatActivity.lastRunFailure` records the NEWEST run's failure**, with the
`SubagentErrorCode` when there is one. Only the newest run speaks: a newer run
of any status means work resumed, and a card that stayed red after the retry
would be reporting history.

**Scheduled work is muted, never amber, and counts DOWN.** Amber means attention
is available now; a cron job armed for 09:00 is not that. `WorkClock` is one
field carrying a direction rather than two nullable timestamps, so a row showing
both an elapsed ticker and a countdown is not expressible — a ticker beside
"failed" would imply it has not stopped, and a countdown is not an elapsed time.

**"Waiting for you" keeps its elapsed ticker.** It is the one row where the
duration is a fact about the reader: how long the chat has been blocked on them.

**`formatCountdown` rounds UP**, mirroring the elapsed formatters that floor. A
12-minute wait has to read "12m" the moment it is set; `formatCompactDuration`
floors 11m59.9s to "11m", which reads as a clock already running late.

Consequently `ChatDotTone` gains `muted` — never returned by
`chatStatusIndicator`, since no chat STATUS is quiet-but-present; it exists for
scheduled work. Both class helpers resolve it to the existing muted-foreground
token, so no new colour enters the palette and the contrast gate is untouched
(the card row is solid text on `bg-card`, not a tinted pill). `ChatActivity`
widens by one field, which every consumer of `EMPTY_CHAT_ACTIVITY` picks up for
free.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-301 | component | ChatActivity gains lastRunFailure, carrying the newest subagent run's failure and its SubagentErrorCode | c3-301#n11335@v1:sha256:e3d6b62585354b852a192e02aa28c5e28b4d81e4ff0e3e97f5d26794bd8f1455 | ref-strong-typing: the field is an explicit nullable record, never a widened string |
| c3-119 | component | cardChatSignal becomes cardWorkSignal, a precedence table over six work kinds; WorkClock replaces the single liveSince timestamp | c3-119#n12190@v1:sha256:9545ee2d64e11944e7d2a884c38ff5cc0258c8d3c13f088cbef274a4c0d19c94 | rule-colocated-bun-test: the table is pinned row by row in cardWorkSignal.test.ts and rendered in KannaBoard.test.tsx |
| c3-207 | component | computeChatActivity derives lastRunFailure from the run map it already walks; the contract row stays true as written | c3-207#n9802@v1:sha256:6f0724e54daffc6916e15e601a01638736a3372afca237f76a50bf3d43802dc9 | ref-cqrs-read-models: the projection stays pure and gains no IO |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-strong-typing | Cited by all three affected components. WorkClock is a discriminated union and lastRunFailure a nullable record, so neither an unset clock nor an unknown failure code is representable as a widened string | ref-strong-typing#n11967@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |
| ref-cqrs-read-models | Cited by c3-207. lastRunFailure is derived from the run map computeChatActivity already walks; no IO and no new dep enters the projection | ref-cqrs-read-models#n11797@v1:sha256:cc9d478fbc03fb946ec0feaf95b2e7bb2d9a0be5222850d04c8b5410718e9369 | comply |
| ref-ws-subscription | Cited by c3-119. The signal reads the sidebar snapshot the board already holds; no new topic and no per-card fetch | ref-ws-subscription#n12033@v1:sha256:262446a7d1764e15397e60f10d9b4c55fae08bc956461d99a6bf0e2c5c62eada | comply |
| ref-zustand-store | Cited by c3-119. cardWorkSignal is a pure function over props; it introduces no store and no state transition | ref-zustand-store#n12066@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | N.A - no board state transition is added |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Cited by c3-119. Every precedence row is pinned in cardWorkSignal.test.ts and the rendered rows in KannaBoard.test.tsx; formatCountdown carries its own | rule-colocated-bun-test#n12099@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply |
| rule-strong-typing | Cited by c3-301 and c3-207. Verified by node_modules/typescript-7/bin/tsc --noEmit | rule-strong-typing#n12160@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |
| rule-zustand-store | Cited by c3-119. Verified by bun run lint:usestate and bunx ast-grep test; no JSX-inline state logic is introduced | rule-zustand-store#n12192@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Bake the countdown into the label | A card with only a cron job re-renders on nothing, so "Runs in 12m" would still say 12m half an hour later. Rendering it through the same useNow the elapsed stamp already uses costs one branch and is correct by construction. |
| Carry the failure reason as prose | SubagentRunError.message is a provider sentence; on a 30-character row it truncates to noise, and the drawer is one click away with room for it. The CODE is short, closed, and is the part that tells you whether to retry — so the row carries the code or nothing, and never invents one for a run that failed without it. |
| Let a failed run paint the card until a human clears it | A card that stays destructive after the work resumed is reporting the past, and the reader has no way to tell it from a live failure. |
| Dispatch the session rows on chat.status instead of the indicator's tone | A second copy of the status-to-severity mapping, free to drift from the one the sidebar uses, and it silently drops any status added later to the bottom of the table as a bare count. |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production | 6656 pass, 2 skip, 0 fail (519 files) |
| bun run lint (--max-warnings=0) | clean |
| node_modules/typescript-7/bin/tsc --noEmit | clean |
| bun run lint:usestate and bunx ast-grep test | clean, 15 rules |
| Mutation check: force lastRunFailure to null in computeChatActivity | 3 read-models tests fail |
| Mutation check: disable the loop precedence row | 2 cardWorkSignal tests fail |
