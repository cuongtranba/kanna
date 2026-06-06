---
id: adr-20260606-live-window-cwu-coalesce
c3-seal: edb146b40874777fedc85026c474e354a2fe5c2a35e6b64a7b5bbcc5e4b87e48
title: live-window-cwu-coalesce
type: adr
goal: |-
    Stop `context_window_updated` token-readout entries from evicting real
    transcript turns (notably `user_prompt`) out of the bounded live WebSocket
    snapshot window. The live recent window (`getRecentChatHistory`, limit
    `DEFAULT_CHAT_RECENT_LIMIT = 200`) must always contain the most recent real
    turns regardless of how many readout updates a single turn emitted, by
    collapsing consecutive runs of `context_window_updated` to their last entry
    before the window slice is taken — without touching the persisted log or the
    full-transcript read paths.
status: accepted
date: "2026-06-06"
---

## Goal

Stop `context_window_updated` token-readout entries from evicting real
transcript turns (notably `user_prompt`) out of the bounded live WebSocket
snapshot window. The live recent window (`getRecentChatHistory`, limit
`DEFAULT_CHAT_RECENT_LIMIT = 200`) must always contain the most recent real
turns regardless of how many readout updates a single turn emitted, by
collapsing consecutive runs of `context_window_updated` to their last entry
before the window slice is taken — without touching the persisted log or the
full-transcript read paths.

## Context

Chat `8dd66bf9` symptom: user sent "do we need to update any deployment nats
…" and never saw their own message in the UI, although the server received,
answered, and persisted it. Transcript proof: the `user_prompt` (`cec1fbe2`)
sits 266 entries from the end; that single turn emitted ~250
`context_window_updated` entries (token-readout, one per stream tick — 2111
across the whole session). The live snapshot pushed over WS keeps only the
last `recentLimit` (200) entries (`getMessagesPageFromEntries` →
`entries.slice(endIndex - limit, endIndex)` in `event-store.ts`). With 266
entries after the prompt, the 200-window starts 66 entries past the prompt, so
the `user_prompt` is excluded from `activeChatSnapshot.messages`; the client
(`useKannaState.ts`) renders the assistant reply (tail) but not the question.
`context_window_updated` only drives the latest-value context readout, so the
intermediate ones are pure noise yet consume window budget 1:1 with real
content. Affected topology: `c3-206 event-store` (windowing/read path);
consumers `c3-208 ws-router` and client `c3-110 app-shell` / `c3-113
transcript` are unchanged.

## Decision

Add a pure helper `coalesceContextWindowUpdates(entries)` that collapses each
maximal run of consecutive `context_window_updated` entries to only its last
entry (preserving order and all non-cwu entries), and apply it inside the two
live-window page methods (`getRecentMessagesPage`, `getMessagesPageBefore`)
between `getMessages()` and `getMessagesPageFromEntries()`. This is the right
fit because: (1) it fixes the root cause — a flood of readout noise can no
longer push real turns out of the 200-window; (2) the latest readout value is
preserved (last of each run survives), so the context-window UI is unchanged;
(3) cursors stay consistent because BOTH page methods coalesce the same array
deterministically, so an `olderCursor` minted by the recent page indexes the
same coalesced array that `getMessagesPageBefore` re-derives; (4) it does NOT
touch `getMessages()` itself, so `getLatestContextWindowUsage`, full
transcript export (`server.ts`), the session importer, and subagent transcript
reads still observe every persisted cwu.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-206 | component | Owns the read-path windowing (getRecentMessagesPage/getMessagesPageBefore/getMessagesPageFromEntries); the coalesce step lands here | Confirm coalesce sits only in live-window page path, not in getMessages or the persisted log |
| c3-208 | component | Caller that pushes the windowed snapshot (getRecentChatHistory) | No code change; verify cursor/hasOlder semantics unchanged |
| c3-2 | container | Parent of event-store; CQRS read-model boundary | No-delta: read-path-only change, write path untouched |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-cqrs-read-models | Change is purely on the read/projection path; must not mutate the event log or write path | comply |
| ref-event-sourcing | The persisted JSONL log must keep every event; coalesce is a read-time view only | comply |
| ref-local-first-data | Cited by c3-206; the read path stays within ~/.kanna/data and exposes no new surface | comply |
| ref-ws-subscription | Cited by c3-208, which pushes the windowed snapshot; envelope/cursor contract unchanged | review |
| ref-strong-typing | New helper coalesceContextWindowUpdates(entries: TranscriptEntry[]) uses concrete types, no any | comply |
| ref-colocated-bun-test | New helper + behavior needs a colocated event-store.test.ts case | comply |
| ref-provider-adapter | Cited by transcript/provider components not in this ADR's affected topology | N.A - not touched |
| ref-tool-hydration | Tool-call hydration is client-side and unaffected by read-window coalescing | N.A - not touched |
| ref-side-effect-adapter | No new IO; coalesce is a pure in-memory transform | N.A - not touched |
| ref-zustand-store | No client store change; server read-path only | N.A - not touched |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Test for the coalesce helper + window eviction sits in src/server/event-store.test.ts under bun test | comply |
| rule-strong-typing | New helper is fully typed over TranscriptEntry[]; no any/escape types introduced | comply |
| rule-zustand-store | No client store touched in this ADR | N.A - not touched |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Code | Add pure coalesceContextWindowUpdates(entries: TranscriptEntry[]) collapsing consecutive cwu runs to the last; apply in getRecentMessagesPage + getMessagesPageBefore before getMessagesPageFromEntries | src/server/event-store.ts |
| Test | Failing-first test: a chat whose latest user_prompt is followed by >limit consecutive cwu must still include the user_prompt in getRecentChatHistory(chatId, 200); assert latest cwu value preserved | src/server/event-store.test.ts |
| Verify | bun test src/server/event-store.test.ts, bun run lint | CI parity |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/template change | This is a runtime read-path fix; no c3x command, validator, hint, or schema is altered | c3x check passes unchanged |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/event-store.test.ts | Asserts user_prompt survives a cwu flood in the recent window and latest readout preserved | bun test src/server/event-store.test.ts |
| bun run lint | Side-effect seal + strong-typing on the new helper (TranscriptEntry[], no any) | CI lint gate |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Raise DEFAULT_CHAT_RECENT_LIMIT only | Band-aid; any larger cwu flood re-triggers the eviction. Does not address noise consuming window budget |
| Coalesce inside getMessages() globally | Breaks getLatestContextWindowUsage, full transcript export, importer, and subagent transcript reads that legitimately need every cwu |
| Stop persisting cwu / write-side coalesce | Changes the immutable event log (violates ref-event-sourcing) and loses the per-tick readout history other paths may use |
| Exclude cwu from the limit count entirely (keep all) | More invasive to cursor math and still ships hundreds of noise rows to the client per turn |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Cursor drift between recent page and load-older | Both page methods coalesce the same array deterministically; cursor indexes the coalesced array | Test: page recent, then getMessagesPageBefore(olderCursor), assert contiguous non-overlapping entries |
| Dropping a cwu that carried unique data | cwu only carries usage readout; last-of-run is preserved so latest value survives; non-consecutive cwu untouched | Test asserts last cwu usage retained |
| Interleaved (non-consecutive) cwu not collapsed | Acceptable: real turns between cwu mean the window already holds them; reported bug is the consecutive-flood case | Test covers the consecutive-flood case explicitly |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/event-store.test.ts | All pass incl. new cwu-eviction + cursor-contiguity cases |
| bun run lint | 0 errors, warning count at/under cap |
