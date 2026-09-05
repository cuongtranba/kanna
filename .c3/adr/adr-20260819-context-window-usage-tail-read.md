---
id: adr-20260819-context-window-usage-tail-read
c3-seal: d15d6c658fa8f15b14f5063ccba5a27d228508a74e43a7b75401ac992265133c
title: context-window-usage-tail-read
type: adr
goal: |-
    Stop the proactive-compact trigger from parsing an entire chat transcript on
    every user send. `shouldInjectProactiveCompact` needs only the newest
    `context_window_updated` / `compact_boundary` entry, but obtained it via
    `store.getMessages(chatId)`, which loads and parses the whole JSONL file.
    Replace that with a bounded backward tail scan exposed as a single store read,
    `EventStore.getLatestContextWindowUsage(chatId)`.
status: proposed
date: "2026-08-19"
---

## Goal

Stop the proactive-compact trigger from parsing an entire chat transcript on
every user send. `shouldInjectProactiveCompact` needs only the newest
`context_window_updated` / `compact_boundary` entry, but obtained it via
`store.getMessages(chatId)`, which loads and parses the whole JSONL file.
Replace that with a bounded backward tail scan exposed as a single store read,
`EventStore.getLatestContextWindowUsage(chatId)`.

## Context

The kanna server runs under pm2 and was restarting every 2-8 minutes — 75
restarts in one day. Each restart runs `shutdownServices()` (`server.ts`), which
cancels every in-flight turn and appends a bare `interrupted` transcript entry,
indistinguishable from the user pressing Stop. Users experience this as "the
chat interrupts itself at random".

The ceiling cannot simply be raised: pm2 7.0.3 silently clamps
`max_memory_restart` at 2^31 bytes. Verified on a throwaway app — both "3G" and
"4G" resolve to 2147483648. The only lever is keeping RSS under 2 GB.

Measured on the reference install: the transcript corpus is 1.0 GB across 262
chats; the largest single transcript is 96 MB / 36,000 entries and costs 524 MB
peak RSS (193 MB heap) to parse. `debugRaw` is 62% of that file (59.3 MB).
`adr-20260813-transcript-memory-budget` sized `TranscriptCache` at a 24 MiB
budget against a then-largest transcript of 13.7 MB; the corpus has since grown
7x past that assumption, so its documented "one oversized transcript degrades to
a re-read" path now costs 524 MB per re-read.

`shouldInjectProactiveCompact` (`claude-send-command.ts`) runs on every send and
paid exactly that. `getLatestContextWindowUsage` (`proactive-compact.ts`) scans
backwards and returns on the first marker, so it needs the tail, not the file.

A finding that shaped the design: 241 of 264 transcripts on this install contain
NO usage marker at all, because imported and PTY-driver sessions never emit
`context_window_updated`. A naive tail scan that widens its window from EOF
re-parses everything it has already seen, so on those chats it cost ~2x a flat
read — measured at 644 ms / 791 MB versus the full load's 216 ms / 291 MB. The
first implementation was therefore slower and heavier than the code it replaced.

## Decision

Three parts.

**A tri-state scan.** `scanLatestContextWindowUsage` in `proactive-compact.ts`
returns `{found: true, usage}` or `{found: false}`; the existing
`getLatestContextWindowUsage` flattens it and is otherwise unchanged. A windowed
reader must distinguish "a compact_boundary is the newest marker" (conclusive
null, stop) from "nothing decisive in the bytes I read" (widen). Without it, a
chat past any compact reads as not-found and widens to the start of the file on
every send for the rest of its life — the pathological case, not an edge case.

**Non-overlapping backward windows with a lookback bound.**
`getLatestChatContextWindowUsage` (`event-store-messages.adapter.ts`) reuses
`readTranscriptTail`, passing `endOffset = tail.lineOffsets[0]` so each window
ends where the previous one's first complete line began. No byte is read twice,
and the torn leading line is picked up by the next window. The scan stops after
`USAGE_SCAN_MAX_LOOKBACK_BYTES` (8 MiB) and reports null. That bound is what
keeps the 241 marker-less chats cheap; it is sound because
`context_window_updated` is emitted on every turn result, so a marker further
back than one turn describes a context window that has since been entirely
replaced — acting on it would be wrong, and the conservative null (no proactive
compact) is the better answer. Cached and legacy chats short-circuit to the pure
scan; a backend without byte-slice APIs falls back to the existing full load.

**An OPTIONAL store member.** `SendCommandStore.getLatestContextWindowUsage?`
is optional and resolved with an explicit `if`, never `??`. The hand-rolled
store fakes across the agent suites are injected as `store as never`, so a
required member passes typecheck and fails at runtime mid-suite — precisely the
failure `adr-20260813-transcript-memory-budget` records as "tried and reverted"
for a page-shaped tail API on this same interface. `getQueuedMessages?` is the
existing precedent. `??` is wrong because null is a meaningful, common answer,
so coalescing would fall through to the full load on exactly the chats being
protected.

This deliberately does NOT seed the full transcript cache on reaching BOF (that
would reintroduce the memory being removed) and does NOT use the tail-window
cache (keyed on `(fileSize, limit)` with entries produced under the page byte
budget, so a matching limit would serve a truncated window to this unbudgeted
query).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-206 | component | Owns the transcript readers and TranscriptCache; gains getLatestChatContextWindowUsage, a bounded backward-window scan built on the existing readTranscriptTail, plus the EventStore.getLatestContextWindowUsage delegate. Its eval/code-map bindings gain event-store-messages.adapter.ts, which was unbound so c3x lookup failed on it | c3-206#n9516@v1:sha256:e04d56e73404382bba111d31d12fd30ce75cd0fa5acbb6ba5811a68709533460 "Append events to JSONL, replay on boot, compact to snapshot.json when the log exceeds 2 MB." | Confirm the new read never seeds the full transcript cache and never consults the tail-window cache, and that readTranscriptTail stays the only byte-slice reader |
| c3-210 | component | Owns claude-send-command.ts and proactive-compact.ts (both newly bound). shouldInjectProactiveCompact now prefers the optional store read; proactive-compact.ts gains the tri-state scanLatestContextWindowUsage | c3-210#n9734@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events." | Confirm no call site resolves the optional member with ??, and that the member stays optional so structural fakes keep working |
| c3-2 | container | Holds both components; no responsibility crosses the container boundary | c3-2#n9223@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce "Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models." | Verify no-delta at container level |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 6559 pass, 2 skip, 0 fail across 517 files |
| bun run typecheck | clean |
| bun run lint | clean at --max-warnings=0 |
| bunx ast-grep test | 15 passed, 0 failed |
| bun test --conditions production src/server/event-store-messages.adapter.test.ts | 45 pass — includes the differential test asserting equality with a full backward scan over 20 seeded-random transcript shapes |
| Real corpus, 96 MB / 36k-entry chat with NO marker (worst case) | tail 36 ms / +38 MB vs full 268 ms / +501 MB — 7x faster, 13x less memory, identical result |
| Real corpus, 57 MB chat with a marker at EOF (common case) | tail 31 ms / +3.4 MB vs full 6950 ms / +27.8 MB — 224x faster, identical result |
| c3x lookup src/server/event-store-messages.adapter.ts | resolves to c3-206 (previously "no component mapping found") |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Make getLatestContextWindowUsage a REQUIRED member of SendCommandStore | The agent-suite fakes are injected as store as never, so TypeScript reports nothing and all of them fail at runtime instead. This is the documented regression from adr-20260813-transcript-memory-budget ("tried and reverted: it broke 7 tests across the hand-rolled createFakeStore fakes") |
| A getRecentMessagesPage-shaped tail API on the send-command store | Same ADR rejected it, and it cannot be made optional cheaply because a page shape has consumers that genuinely need the entries. A single-value read collapses the blast radius to one optional property and zero fake edits |
| Widen the window from EOF each round instead of moving endOffset backwards | Re-parses every byte already seen. Measured on the real 96 MB marker-less transcript at 644 ms / 791 MB — worse than the 216 ms / 291 MB full load it was meant to replace |
| Scan to BOF with no lookback bound | 241 of 264 transcripts hold no marker at all, so this is the common path, not the tail case. It makes every send on those chats read the whole history |
| Cache the scan result in the tail-window cache | That cache is keyed (chatId, fileSize, limit) and its entries were produced WITH RECENT_PAGE_BYTE_BUDGET; a coinciding limit would serve a budget-truncated window to this unbudgeted query |
| Seed the full transcript cache when the scan reaches BOF | Repopulates TranscriptCache with the very transcript whose parse cost this change exists to avoid, and can evict a chat another path depends on |
| Stream loadTranscriptWithBytes in chunks instead | Measured 524 MB to 465 MB — only ~11%, because the parsed entries dominate, not the transient text. Kept as a separate follow-up rather than the primary fix |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A false null silently disables proactive compaction, invisible until a "Prompt is too long" failure | The tri-state makes every null attributable to a reason; the differential test pins equality with a full backward scan over seeded-random shapes; cached and legacy chats short-circuit to the pure scan | event-store-messages.adapter.test.ts: "agrees with a full backward scan on randomized transcripts", "reads legacy in-memory messages that have no file on disk" |
| A marker further back than 8 MiB is now ignored, where the old code would have found it | Deliberate and documented on USAGE_SCAN_MAX_LOOKBACK_BYTES: a marker that far back cannot describe the current context window, since one is emitted per turn result. The conservative null skips a compact rather than acting on stale usage | event-store-messages.adapter.test.ts: "stops looking past the lookback bound and reports no current usage" |
| Someone later "simplifies" the call site to ?? | null is a common answer, so this silently restores the full load on the protected chats. An explicit if plus a comment naming ?? as wrong, and a test that fails loudly | claude-send-command.test.ts: "a null from store.getLatestContextWindowUsage does NOT fall through to getMessages" |
| The optional member is dropped from EventStore by a later refactor, so the fallback runs forever and the fix is quietly undone with no test failure | An end-to-end case on a real EventStore + FsStorageBackend asserts the method answers correctly from cold instances | event-store.test.ts: "getLatestContextWindowUsage reads the tail and agrees with a full scan" |
