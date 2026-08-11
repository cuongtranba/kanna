---
id: adr-20260810-byte-bounded-chat-page
c3-seal: 8c66b5912c8488b2dfe594e69fa157c5fad1100fa6c1728ed67954a919f13897
title: byte-bounded-chat-page
type: adr
goal: |-
    Bound what a chat tab costs to open by BYTES rather than by entry count, stop
    re-reading a large transcript from disk on every snapshot derive, and free a
    chat's cached transcript once no tab is showing it. Measured on the real
    transcript corpus, opening a tab cost up to ~250 ms of client main-thread
    blocking and ~20 ms of blocking server work per derive, and the client heap
    grew 129 → 212 MB across ~30 tab switches without recovering.
status: accepted
date: "2026-08-10"
---

## Goal

Bound what a chat tab costs to open by BYTES rather than by entry count, stop
re-reading a large transcript from disk on every snapshot derive, and free a
chat's cached transcript once no tab is showing it. Measured on the real
transcript corpus, opening a tab cost up to ~250 ms of client main-thread
blocking and ~20 ms of blocking server work per derive, and the client heap
grew 129 → 212 MB across ~30 tab switches without recovering.

## Context

`INITIAL_CHAT_RECENT_LIMIT = 200` caps the first page a chat ships by entry
COUNT, which says nothing about its size. Measured against 306 MB of real
transcripts: a 19.1 MB transcript ships a 0.85 MB page and blocks the client
~0 ms, while a 14.9 MB transcript ships a **3.89 MB** page and blocks it
~250 ms. Cost tracks page bytes — not entry count, and not file size.

Two further findings came out of profiling the same corpus:

1. The transcript LRU is only seeded when a tail read happens to reach the
START of the file (`seedFullTranscript` sits behind `tail.reachedStart`).
For any transcript larger than one 256 KB tail chunk that never happens, so
the cache stays permanently empty and `getRecentMessagesPage` re-reads and
re-parses the file on EVERY call — 18.81 ms of a 20.68 ms call at 3k
entries, paid on every snapshot derive. This also corrects an earlier
reading: the 4-chat LRU showed no eviction cliff under a 6-chat round-robin
not because it was healthy, but because for large chats it is never
populated at all.
2. `releaseChat` exists in `chatStateStore` but is never called from
production code, so a chat's cached snapshot + transcript outlives every tab
that showed it.

The blind spot was measurement, not reasoning: the long-session bench fixture
(`scripts/perf/long-session-bench.ts`) emitted every entry at ~1 KB, so a
200-entry window weighed a fixed 178 KB and could not vary with content. The
July 2026 long-session OKR therefore bounded chat-open by entry count only, and
recorded the snapshot-derive path at 0.09 ms where the real distribution costs
~17.5 ms.

## Decision

Bound the first page by bytes as well as count; cache the parsed tail window
keyed on the transcript's byte size; release a chat's client slice when its
last subscription is torn down; and sample the bench fixture from the measured
real distribution so this class of miss fails the build.

**Byte budget.** `fitLimitToByteBudget` walks the newest entries and stops once
a 1 MB budget is spent, so it serializes at most one budget's worth — the
measurement is bounded by the budget, not by the transcript. A floor of 10
entries keeps a chat of very large entries from looking empty. Trimmed entries
are not lost: the page reports `hasOlder` with a cursor and scrollback pages
them back in.

**Tail cache keyed on byte size.** The JSONL is append-only, so an unchanged
size proves an unchanged tail, and a `stat` is orders of magnitude cheaper than
the re-parse it replaces. An append moves the size and expires the entry with
no invalidation to forget — and `appendText` is awaited before anything else
observes the entry, so the size always moves first. The one case byte size
cannot cover is a wholesale rewrite, which could land on the same size with
different bytes; the fork path therefore calls `invalidateTail` explicitly
rather than relying on "that chatId is always new".

**Release on last subscription.** Neither weaker signal is correct: tab unmount
is wrong because two tabs can show one chatId (the refcount exists for exactly
that reason), and subscription-key teardown is wrong because keys are
`${chatId}:${nonce}` and a resync releases the old key and acquires the new one
inside one commit — a key-scoped release would wipe a chat that never left the
screen. So the check is chat-scoped and deferred by one microtask, by which
time a resync's replacement subscription is registered.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-206 | component | Owns the transcript page builder and TranscriptCache; gains a byte budget on the recent page and a size-keyed tail-window cache, and its "partial tails are never cached" claim is no longer true | c3-206#n8153@v1:sha256:aba847843854e765c2464a52a18d4eda4ad06af2d690bc38025eb6ff027985ad "TranscriptCache (src/server/event-store-messages.adapter.ts) is a small" | ref-event-sourcing (append-only log is what makes size a sound validity token); ref-colocated-bun-test for the new suites |
| c3-110 | component | Owns useKannaState, whose subscription refcount now decides when a chat's cached transcript is freed | c3-110#n7352@v1:sha256:c0e73f886822a6f6cb439f13894c5307ff4b59edf1a1bdfda586a8bd7ab2e9bd "Composes the React tree at boot: react-router, the central useKannaState hook" | ref-ws-subscription (release hangs off subscription teardown); rule-zustand-store for the store transition |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-event-sourcing | The tail cache's validity token is the transcript's byte size, which is only sound because the JSONL is append-only — the invariant this ref owns | ref-event-sourcing#n9962@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa "Every state mutation is first captured as an immutable event appended to a JSONL log; system state is derived by replay + periodic snapshot compaction." | comply |
| ref-colocated-bun-test | Three new suites land beside their sources (event-store-byte-budget.test.ts, event-store-tail-cache.test.ts, useKannaState.release.test.ts) | ref-colocated-bun-test#n9896@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(x), and run under bun test — no separate test directory, no framework churn." | comply |
| ref-ws-subscription | The chat-slice release fires from subscription teardown, so it is bound to this ref's lifecycle | ref-ws-subscription#n10165@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc "A single typed WebSocket handles both subscriptions (push) and commands (pull), with a shared envelope defined in src/shared/protocol.ts." | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-zustand-store | Freeing a chat slice is a store transition and stays inside the store as the existing releaseChat action; the hook only decides when to call it | rule-zustand-store#n10324@v1:sha256:f4987b0b2521426050c0c2a5307760c102f3ed1e0a9334b074ed1913fe818f64 "All client state in Kanna lives in Zustand stores, and so does every transition of it. Singleton feature state lives under src/client/stores/<concern>Store.ts" | comply |
| rule-colocated-bun-test | New tests sit next to the modules they cover rather than in a separate tree | rule-colocated-bun-test#n10231@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f "Every Kanna test must sit next to the file under test, share its basename, and run under bun test." | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Byte budget | RECENT_PAGE_BYTE_BUDGET, MIN_RECENT_PAGE_ENTRIES, fitLimitToByteBudget added to event-store-helpers.ts; applied in getRecentMessagesPage and pageFromTail | src/server/event-store-helpers.ts, src/server/event-store-messages.adapter.ts |
| Tail cache | TranscriptCache.getTail/setTail/invalidateTail keyed on (fileSize, limit); invalidate/invalidateAll clear it too | src/server/event-store-messages.adapter.ts |
| Rewrite safety | Fork path calls invalidateTail before reseeding the full cache | src/server/event-store-transcript-write.adapter.ts |
| Client release | hasLiveSubscriptionForChat + microtask-deferred releaseChat in acquireChatSubscription | src/client/app/useKannaState.ts |
| Bench fixture | Entry sizes sampled from the measured real distribution via seeded inverse-CDF; --uniform replays the legacy fixture | scripts/perf/entry-fixture.ts, scripts/perf/long-session-bench.ts |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/event-store-byte-budget.test.ts | Pins that a lean page keeps all 200 entries, a fat page is trimmed under budget, and the floor still ships when every entry blows the budget | 7 tests |
| src/server/event-store-tail-cache.test.ts | Pins that a cached window never hides an appended message, that paging back reaches every entry, and that another recentLimit is not served from a cached window | 4 tests |
| src/client/app/useKannaState.release.test.ts | Pins last-release frees, a second tab holds, a resync does NOT wipe, and a stale releaser cannot drop a re-acquired chat | 6 tests |
| scripts/perf/entry-fixture.test.ts | Pins the fixture's SHAPE (median, p95, p95/p50 ratio, and that a 200-entry window exceeds 1 MB), so flattening it back toward one-size-per-entry breaks the build | 9 tests; verified to fail on the legacy generator (ratio 1.00, window 177,737 B) |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Truncate individual entry content to fit the budget | Changes what the transcript says. Shipping fewer whole entries loses nothing, because the existing hasOlder/cursor paging already brings the rest back on scroll. |
| Widen the 4-chat transcript LRU | Measured non-cause: round-robin over 6 chats stayed flat at 3–62 ms across 5 rounds. The LRU is not evicting for large chats, it is never populated at all, so widening it changes nothing. |
| Invalidate the tail cache from the write path | The write path already moves the file size, so a size-keyed entry expires itself. Explicit invalidation hooks are a thing to forget; the only case size cannot cover (wholesale rewrite) is handled at that one call site. |
| Call releaseChat on tab unmount | Two tabs can show one chatId, so unmount is not proof the data is unreachable. |
| Release synchronously on subscription teardown | A resync releases the old nonce key and acquires the new one in one commit, so a synchronous release wipes a chat that never left the screen and forces a refetch. |
| Cap the transcript file on disk instead | Destroys history to fix a transport problem; the file growing is intentional. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A cached tail window hides a message that has since been appended | Validity is keyed on byte size, and appendText is awaited before anything else observes the entry, so the size always moves first | src/server/event-store-tail-cache.test.ts "a newly appended message is visible immediately after a cached read" |
| A wholesale transcript rewrite lands on the same byte size with different bytes | Fork path calls invalidateTail; chat delete already routes through invalidate, which now clears the tail | src/server/event-store-transcript-write.adapter.ts; bun run test |
| Releasing a chat slice wipes a chat that is still displayed | Release is chat-scoped, not key-scoped, and deferred one microtask so a resync's replacement subscription is visible | src/client/app/useKannaState.release.test.ts "a resync does NOT wipe the chat it is resubscribing" |
| A smaller first page makes chats look truncated | Floor of 10 entries; hasOlder + cursor unchanged so scrollback fills in | Paged every chat back to the start: reached exactly 1127/1127, 1448/1448, 3834/3834 |
| Revisiting a tab the retention cap unmounted now refetches | Accepted trade for a bounded heap; steady-state switch blocking unchanged within noise | Browser run: heap 99–139 MB oscillating vs 129→212 MB monotonic |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 5163 pass, 2 skip, 1 fail — the failure is uploads > serves uploaded attachment content through the project content URL, which fails identically on clean main with EADDRINUSE on port 4310 (a locally-running Kanna holds it) and is not caused by this change |
| bun run typecheck | Clean |
| bun run lint | Clean at --max-warnings=0 |
| bunx ast-grep test | 14 passed, 0 failed |
| bun test --conditions production scripts/perf/entry-fixture.test.ts | 9 pass — fixture shape pinned |
| Browser, 6 large chats, same tabs before/after | Worst-chat main-thread blocking ~250 ms → 86 ms max |
| Server bench on the real corpus | Worst-chat first-page payload 3.89 MB → 1.05 MB; getRecentChatHistory 20.68 ms → 0.73 ms |
| Reachability walk on three trimmed transcripts | Paged back to the start: 1127/1127, 1448/1448, 3834/3834 entries |
