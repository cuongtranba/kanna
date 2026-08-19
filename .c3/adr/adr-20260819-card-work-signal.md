---
id: adr-20260819-card-work-signal
c3-seal: c4cf6c2834401fd3f08caddf67addd78611a6474f71c2d3afbd4c499f52c2be3
title: card-work-signal
type: adr
goal: Replace the board card's `cardChatSignal` — a thin delegation to the sidebar's `chatStatusIndicator` that read only a chat's turn status — with `cardWorkSignal`, an ordered ten-row precedence table over the whole of `ChatActivity`. Add `ChatActivity.lastFailure` so the failure row can say *why*, and widen `ChatDotTone` with `muted` so scheduled work is not painted as running work.
status: done
date: "2026-08-19"
---

## Goal

Replace the board card's `cardChatSignal` — a thin delegation to the sidebar's `chatStatusIndicator` that read only a chat's turn status — with `cardWorkSignal`, an ordered ten-row precedence table over the whole of `ChatActivity`. Add `ChatActivity.lastFailure` so the failure row can say *why*, and widen `ChatDotTone` with `muted` so scheduled work is not painted as running work.

## Context

`cardChatSignal` delegated entirely to `chatStatusIndicator` and never read the `activity` field that `buildBoardChatFacts` already carries to it for free off the sidebar snapshot. A card mid-loop, a card with four background tasks, and a card whose cron fires in twelve minutes were all indistinguishable: each read "Running" or nothing at all. The sidebar's table is right for the sidebar — it answers "is this chat running" — but a board is read at a glance across two hundred rows and its question is different: what KIND of work is on this card.

Two things were missing to answer that. `ChatActivity` carried no failure reason, so a destructive row could only say THAT something failed. And `ChatDotTone` had no neutral member, so a cron countdown would have had to borrow amber — which in this design system states *attention available*, and nothing is available yet.

`chatStatusIndicator` itself must not absorb the new table: the sidebar row, the pane tab, and the card drawer share its parity contract (adr-20260809-tab-status-indicator-parity), and widening it would have dragged the loop, the cron, and the background tasks into three surfaces that did not ask for them.

## Decision

1. Rename `src/client/lib/boards/cardChatSignal.ts` → `cardWorkSignal.ts` (`cardChatSignal` → `cardWorkSignal`, `CardChatSignal` → `CardWorkSignal`), with the colocated test. `CardChatFacts` keeps its name — it is still the chat facts a card reads.
2. Replace the delegation with an ordered table, first match wins: failed → awaiting answer → workflow → loop → agents → running → background tasks → cron → unread → chat count. A loop outranks a bare agent count because it names the SHAPE of the work: an agent under a loop is one chunk of a plan, and `loop · 5/8` says where the plan has got to while `1 agent` says only that something is on.
3. The elapsed ticker follows the ROW, not the status: rows that name work in flight carry it, the failure row and the cron row do not. A ticker beside "failed" would imply the failure has not stopped, and a countdown is not an elapsed time.
4. Add `ChatActivity.lastFailure: {reason} | null` (c3-301), derived in `computeChatActivity` (c3-207) from the chat record's `lastTurnOutcome` plus a new `ChatRecord.lastTurnError` folded from the `turn_failed` event and cleared at the next `turn_started` / `turn_finished` / `turn_cancelled`. The read model publishes the first line, capped at 120 characters. Null covers both "nothing failed" and "failed with nothing to say", and the card degrades to a bare `agent failed` rather than a dangling em dash.
5. Add `muted` to `ChatDotTone` with cases in `chatDotBgClass` / `chatDotTextClass`. `chatStatusIndicator`'s own return shape and table are untouched, so the parity contract holds.

No `TONE_PAIRINGS` entry is added: the signal renders as a dot plus text, not a `bg-{color}/10` tinted pill, so the contrast gate in `src/shared/design/tone-pairings.ts` does not govern it.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-301 | component | ChatActivity gains lastFailure; EMPTY_CHAT_ACTIVITY gains its zero value | c3-301#n11280@v1:sha256:6bfffd9c0eaaa48c0b9a647351cb87f252892e577b25427633286579ef981adf | ref-strong-typing: the new field is an explicit nullable object, never widened |
| c3-207 | component | computeChatActivity derives lastFailure from the chat record's failed outcome and error text | c3-207#n9751@v1:sha256:c4d36761ad54e6c409d3c476124f1acce54b235dc29792ed872620a0ceaca3b0 | ref-cqrs-read-models: the projection stays pure, reading only StoreState |
| c3-119 | component | cardChatSignal becomes cardWorkSignal and owns its own precedence table over ChatActivity | c3-119#n12135@v1:sha256:f01f47003108b946f36c513d7721fa67f6f9a45525b1cac202e0641ee427bce4 | rule-colocated-bun-test: the renamed helper keeps its sibling test |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | Exit 0, zero type errors |
| bun run lint | Exit 0, zero warnings |
| bunx ast-grep test | 15 rules passed, 0 failed |
| bun run lint:usestate | Exit 0, no violations |
| bun run test | 6584 pass, 2 skip, 0 fail across 517 files |
