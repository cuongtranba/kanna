---
id: adr-20260813-transcript-memory-budget
c3-seal: 3e504cd3c863cd48542f35adc76f8954d89321f8bcd828c5884c99df8d239bae
title: transcript-memory-budget
type: adr
goal: |-
    Bound `TranscriptCache` by the memory it actually spends — SOURCE JSONL bytes,
    not chat count — and stop `startTurnForChat` from loading + deep-cloning a
    whole transcript on every turn when the result is used for nothing but a
    title check most chats never need. Measured on a real install: `maxChats = 4`
    let the four largest transcripts (47 MB of source text) cost **220 MB RSS**
    parsed into JS objects (4.7x amplification), and every turn on a big chat paid
    that same load-and-clone even though `startTurnForChat` used the result for
    exactly two things — an `existingMessages.length === 0` title check, and a
    history primer built only when `shouldInjectPrimer` says so.
status: accepted
date: "2026-08-13"
---

# transcript-memory-budget

## Goal

Bound `TranscriptCache` by the memory it actually spends — SOURCE JSONL bytes,
not chat count — and stop `startTurnForChat` from loading + deep-cloning a
whole transcript on every turn when the result is used for nothing but a
title check most chats never need. Measured on a real install: `maxChats = 4`
let the four largest transcripts (47 MB of source text) cost **220 MB RSS**
parsed into JS objects (4.7x amplification), and every turn on a big chat paid
that same load-and-clone even though `startTurnForChat` used the result for
exactly two things — an `existingMessages.length === 0` title check, and a
history primer built only when `shouldInjectPrimer` says so.

## Context

The kanna server runs under pm2 with `max_memory_restart: 1 GB` and had
restarted 10 times; one restart killed a long-running autonomous loop
(diagnosed and fixed separately in `adr-20260813-queued-message-dequeue-on-commit`,
committed earlier on this same branch). Investigating the memory side of that
incident surfaced two independent, compounding causes, both in components that
`adr-20260813-queued-message-dequeue-on-commit`'s own Affected Topology
already names as owning this surface (c3-210 owns turn-start; c3-206 owns the
event store and its transcript cache):

Transcript JSONL is never compacted — each chat's message history is a single
append-only `<chatId>.jsonl` file with no size cap, unlike the *separate*
2 MB-triggered snapshot compaction c3-206's Goal describes for the main event
log. On this install that is 379 MB across 152 chats, largest single
transcript 13.7 MB.

`TranscriptCache` (`src/server/event-store-messages.adapter.ts`) was an LRU
bounded by `maxChats = 4` — a count over unbounded-size items, so nothing
capped the memory a full chat's parsed entries could hold. MEASURED: the four
largest transcripts on this install = 47 MB of source JSONL text, but held as
parsed `TranscriptEntry[]` in the cache they cost 220.2 MB RSS — a 4.7x
amplification from source bytes to heap. `adr-20260810-byte-bounded-chat-page`
had already bounded the *page a client tab receives* by bytes; this cache
holds the full transcript server-side and had no equivalent bound.

`claude-turn-starter.ts` called `deps.store.getMessages(args.chatId)`
unconditionally at the top of `startTurnForChatInner`, before the turn was
even recorded. `getMessages` loads the whole transcript from disk and
deep-clones every entry (`cloneTranscriptEntries`) — tens of MB of heap on a
big chat, paid on EVERY turn regardless of chat size or whether the result was
needed, and the load itself re-populated the very cache entry `maxChats`
couldn't bound. The result fed exactly two conditions:
`existingMessages.length === 0` (only relevant when `chat.title === "New Chat"`)
and `buildHistoryPrimer(existingMessages, ...)` (only called when
`shouldInjectPrimer` is true, which is not every turn).

## Decision

**Byte budget on `TranscriptCache`, enforced alongside the chat-count cap, not
instead of it.** The constructor takes a second parameter,
`maxBytes = 24 * 1024 * 1024` (24 MiB of SOURCE JSONL bytes — chosen because
the measured 4.7x amplification puts that at ~110 MB RSS, comfortably under
the 1 GB pm2 ceiling with headroom for four such caches' worth of transient
turn work). `bytesByChat: Map<string, number>` and `totalBytes` track the
budget; `set()` and the new `appendTo()` byte accounting both route through
`addBytes`/`drop`; a single `evict()` walks the Map's insertion order (LRU,
since `get()` re-inserts on touch) while `byChat.size > 1 && (byChat.size >
maxChats || totalBytes > maxBytes)` — the `size > 1` guard means the cache
never evicts its last entry, so one oversized transcript degrades to a
re-read on every turn rather than a thrash that evicts-then-immediately-needs
the same chat back. `estimateTranscriptBytes(entries)` (`JSON.stringify(...)
.length`) is the fallback measurer; the new `loadTranscriptWithBytes(deps,
chatId)` returns `{entries, bytes}` from the disk read that already holds the
text in memory, so `getMessagesView` reports an exact size for free instead of
re-serializing the parsed entries to get one. `loadTranscriptFromDisk` keeps
its old signature and delegates, so no other call site changes shape.

**`startTurnForChatInner` no longer loads the transcript unconditionally.**
`existingMessages: TranscriptEntry[]` becomes `loadExistingMessages: () =>
TranscriptEntry[]`, a thunk threaded through `StartTurnAfterTurnStartedCtx`.
The title condition gained two AND-chained guards BEFORE the thunk call —
`chat.title === "New Chat" && !chat.hasMessages && loadExistingMessages()
.length === 0` — so an established chat (title already set, or `hasMessages`
true) short-circuits before ever touching disk; `chat.hasMessages` alone was
deliberately NOT substituted for the transcript check (see Alternatives) so
the thunk still executes, and still governs, on the one case `hasMessages` is
`undefined` for. `startTurnAfterTurnStarted`'s primer branch calls
`loadExistingMessages()` only inside `shouldPrime ? buildHistoryPrimer(
loadExistingMessages(), ...) : null` — i.e. only when priming was already
going to happen for other reasons, never speculatively.

**The replay-dedup read in `dequeueAndStartQueuedMessage` is gated to the boot
path only.** `adr-20260813-queued-message-dequeue-on-commit` added
`isPromptAlreadyAppended(deps.store.getMessages(chatId), queuedMessage)` to
make crash recovery idempotent — but that same `dequeueAndStartQueuedMessage`
function is also the steady-state drain every live wake goes through
(`maybeStartNextQueuedMessage`), and unconditionally reading+cloning the
transcript there would reintroduce exactly the per-turn cost this ADR removes
elsewhere. `dequeueAndStartQueuedMessage`, `maybeStartNextQueuedMessage`, and
`QueuedMessageRecoveryDeps.maybeStartNextQueuedMessage` all gained an optional
`{ replay?: boolean }`; the dedup read now runs only when `options?.replay ===
true`. Only `recoverQueuedMessages` (`server.ts` boot path) passes it;
`AgentCoordinator.maybeStartNextQueuedMessage` forwards the option through
unchanged so a live wake never sets it.

This wins over the rejected alternatives (below) because it fixes both halves
of the same feedback loop — an unbounded cache AND an unconditional per-turn
read that kept refilling it — inside the two components that already own this
surface, with no new event schema and no change to `getMessages`'s public
full-clone contract.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-206 | component | TranscriptCache gains a maxBytes budget enforced alongside maxChats, per-chat byte accounting (bytesByChat/totalBytes), LRU-first eviction that never drops the last entry, and appendTo now counts appended bytes; new exports estimateTranscriptBytes and loadTranscriptWithBytes (the component's stated "TranscriptCache ... both LRU over 4 chats" claim is no longer the whole story — a byte bound now applies alongside the chat cap) | c3-206#n8873@v1:sha256:5cd3861d4c134b7027ff2adab58549ec34529ef45c284f22449a33960d25d1fd "TranscriptCache (src/server/event-store-messages.adapter.ts) holds TWO" | Confirm the component doc's Transcript cache section is updated in a follow-up doc pass to state the byte budget alongside the chat cap, and that evict() remains the only path that removes cache entries under budget pressure |
| c3-210 | component | Owns startTurnForChat (claude-turn-starter.ts), which no longer calls deps.store.getMessages unconditionally — loadExistingMessages is a thunk evaluated only behind the title short-circuit or an already-true shouldPrime; owns dequeueAndStartQueuedMessage / maybeStartNextQueuedMessage (claude-send-command.ts), where the replay-dedup transcript read added by the prior ADR on this branch is now gated behind {replay: true}, passed only by recoverQueuedMessages | c3-210#n9044@v1:sha256:588b3966e9ff5b225b83ffadc7d415b18ed72d7e6c335864e521f7729832ec17 "Owns the agent turn lifecycle: receives chat.send commands, picks the provider via the catalog, drives the Codex/Claude adapter, normalizes streamed events in" | Confirm no caller of startTurnForChat re-introduces an unconditional deps.store.getMessages(...) on this path, and that replay: true is passed ONLY from recoverQueuedMessages |
| c3-2 | container | Server container holds both components above; no responsibility crosses the container boundary — every change is internal to c3-206's cache and c3-210's turn-start/dequeue modules | c3-2#n8528@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce "Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models." | Verify no-delta at container level |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-event-sourcing | The whole problem this ADR bounds exists because the transcript JSONL is append-only and never compacted by design ("Every state mutation is first captured as an immutable event appended to a JSONL log") — the cache fix accepts that growth is unbounded on disk and bounds only what is held in memory, rather than capping the log itself | ref-event-sourcing#n10687@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa "Every state mutation is first captured as an immutable event appended to a JSONL log; system state is derived by replay + periodic snapshot compaction." | comply |
| ref-colocated-bun-test | New byte-budget eviction tests land inside the existing colocated suite (event-store-messages.adapter.test.ts), not a new file or directory | ref-colocated-bun-test#n10621@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(x), and run under bun test — no separate test directory, no framework churn." | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Three new tests ("evicts on the byte budget while still under the chat cap", "keeps the newest transcript even when it alone exceeds the budget", "appended entries count toward the byte budget") were added inside event-store-messages.adapter.test.ts, sharing its basename with event-store-messages.adapter.ts and running under bun test | rule-colocated-bun-test#n10956@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f "Every Kanna test must sit next to the file under test, share its basename, and run under bun test. No \_\_tests\_\_/ directories, no separate test packages, no " | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Byte budget | DEFAULT_TRANSCRIPT_CACHE_MAX_BYTES = 24 MiB; TranscriptCache constructor gains maxBytes; bytesByChat/totalBytes accounting via addBytes/drop; evict() enforces both bounds, never dropping the last entry | src/server/event-store-messages.adapter.ts |
| Byte reporting | estimateTranscriptBytes(entries); loadTranscriptWithBytes(deps, chatId) returns {entries, bytes}, loadTranscriptFromDisk delegates to it; getMessagesView passes the exact source size to transcriptCache.set | src/server/event-store-messages.adapter.ts |
| Lazy transcript load | existingMessages → loadExistingMessages thunk on StartTurnAfterTurnStartedCtx; title check adds !chat.hasMessages short-circuit before the thunk call; primer branch calls the thunk only inside an already-true shouldPrime | src/server/claude-turn-starter.ts |
| Replay gate | dequeueAndStartQueuedMessage / maybeStartNextQueuedMessage gain {replay?: boolean}; the isPromptAlreadyAppended transcript read now runs only when options?.replay === true | src/server/claude-send-command.ts |
| Replay gate threading | AgentCoordinator.maybeStartNextQueuedMessage forwards options unchanged; QueuedMessageRecoveryDeps.maybeStartNextQueuedMessage signature widened to accept it; server.ts passes options through to agent.maybeStartNextQueuedMessage | src/server/agent-coordinator.ts, src/server/queued-message-recovery.ts, src/server/server.ts |
| Boot-recovery call site | recoverQueuedMessages is the ONLY caller that passes {replay: true} | src/server/queued-message-recovery.ts |
| Tests | Byte-budget eviction under the chat cap; newest-kept-when-oversized; appended entries counting toward the budget | src/server/event-store-messages.adapter.test.ts |
| Docs | New CLAUDE.md section "Transcript memory is bounded by bytes, and loaded lazily", and a paragraph appended to the existing replay-idempotency section naming the {replay: true} gate, both citing this ADR | CLAUDE.md |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| event-store-messages.adapter.test.ts | "evicts on the byte budget while still under the chat cap"; "keeps the newest transcript even when it alone exceeds the budget"; "appended entries count toward the byte budget" | bun test --conditions production src/server/event-store-messages.adapter.test.ts |
| claude-send-command.test.ts | Existing replay-idempotency cases updated to pass {replay: true} explicitly, pinning that the dedup path is opt-in, not the default | bun test --conditions production src/server/claude-send-command.test.ts |
| Full suite + typecheck + lint | Whole-repo regression gate before any push, per this repo's CLAUDE.md | bun run test; bun run typecheck; bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Replace maxChats with maxBytes outright | The count cap still cheaply prevents a pathological number of tiny transcripts (e.g. many near-empty chats) with a single Map-size check; keeping both costs nothing and avoids changing what the existing maxChats-only eviction tests assert |
| Use chat.hasMessages ALONE for the title check, dropping the transcript-length read entirely | hasMessages is maintained on create and first append, but its only backfill is the stale-empty-chat pruner — an older chat can have real messages with hasMessages === undefined. Dropping the transcript term would silently change title-generation behaviour for that class of chat instead of just making the check lazy |
| Add a getRecentMessagesPage-style tail read to the send-command store interface for the replay dedup, instead of gating the existing full read behind {replay: true} | Tried and reverted: it broke 7 tests across the hand-rolled createFakeStore fakes in claude-send-command.test.ts, which model the store interface directly. Gating removes the read from the hot path entirely rather than merely making it cheaper, and needs no new store-interface surface |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A hot chat's transcript is evicted and reloaded from disk on every turn once the cache is byte-constrained, trading memory for latency | evict() never drops the cache's last entry, so a single oversized transcript degrades to a steady re-read rather than a full-cache thrash across several large chats; 24 MiB default budget covers the measured largest transcript on the reference install (13.7 MB) with room for more than one such chat cached at once | event-store-messages.adapter.test.ts "keeps the newest transcript even when it alone exceeds the budget" |
| A future call site re-adds deps.store.getMessages(...) unconditionally to the turn-start path, silently reintroducing the per-turn load+clone cost | loadExistingMessages is a thunk, not a value, on StartTurnAfterTurnStartedCtx — a caller has to actively invoke it, and the title short-circuit plus shouldPrime gate are the only two call sites today | src/server/claude-turn-starter.ts (thunk shape); CLAUDE.md's "Transcript memory is bounded by bytes, and loaded lazily" section names this explicitly as a thing not to reintroduce |
| A future caller passes {replay: true} from the steady-state drain, reintroducing the per-message-send transcript read adr-20260813-queued-message-dequeue-on-commit added for crash recovery only | replay defaults to undefined/falsy everywhere except recoverQueuedMessages; AgentCoordinator.maybeStartNextQueuedMessage forwards whatever it is given rather than hardcoding true, so a live wake path stays opt-in-only unless a caller deliberately sets it | src/server/claude-send-command.ts (default-falsy alreadyAppended guard); claude-send-command.test.ts existing replay cases pass {replay: true} explicitly, pinning the default off |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 5794 pass, 2 skip, 0 fail across 475 files |
| bun run typecheck | clean |
| bun run lint | clean at --max-warnings=0 |
| bun test --conditions production src/server/event-store-messages.adapter.test.ts | 34 pass, 0 fail |
| Heap measurement (throwaway bun script, 4 largest transcripts held as parsed entries) | 47.0 MB on disk → 220.2 MB RSS delta (4.7x amplification) |
