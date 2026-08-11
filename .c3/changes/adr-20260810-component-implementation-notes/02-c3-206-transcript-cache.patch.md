---
target: c3-206
scope: block
base: c3-206#n8288@v1:sha256:aba847843854e765c2464a52a18d4eda4ad06af2d690bc38025eb6ff027985ad
---
`TranscriptCache` (`src/server/event-store-messages.adapter.ts`) holds TWO
caches, both LRU over 4 chats. Page reads (`getRecentMessagesPage` /
`getMessagesPageBefore`) use the no-clone `getMessagesView` and clone only the
returned window; the public `getMessages` keeps full-clone semantics.

The FULL-transcript cache is seeded only when a tail read reaches BOF, so for
any transcript larger than one tail chunk it stays permanently empty. The
TAIL-WINDOW cache (`getTail` / `setTail`, keyed on `(fileSize, limit)`) is what
makes a repeat read cheap in that case: the JSONL is append-only, so an
unchanged byte size proves an unchanged tail, and a `stat` replaces a full
re-read + parse (20.68 ms → 0.73 ms per `getRecentChatHistory` at 3k entries).
An append moves the size and expires the entry, so there is no invalidation to
forget — `appendText` is awaited before anything else observes the entry, so
the size always moves first. Byte size cannot detect a wholesale REWRITE
landing on the same byte count, so a writer that replaces a transcript must
call `invalidateTail` explicitly (the fork path does); `invalidate` /
`invalidateAll` clear both caches.

The recent page is bounded by BYTES as well as by `recentLimit`:
`fitLimitToByteBudget` (`event-store-helpers.ts`) trims the newest window to
`RECENT_PAGE_BYTE_BUDGET` (1 MB) with a floor of `MIN_RECENT_PAGE_ENTRIES`
(10). Entry count says nothing about payload size — on the real corpus a
19.1 MB transcript ships 0.85 MB while a 14.9 MB one shipped 3.89 MB and
blocked the client ~250 ms — and trimmed entries stay reachable through the
normal `hasOlder` + cursor paging.
