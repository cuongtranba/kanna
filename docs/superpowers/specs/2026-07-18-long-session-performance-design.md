# Long-Session Performance: Versioned Per-Chat Op-Log + Load/Render Optimizations

Date: 2026-07-18
Status: Approved (frame + design ratified by user)

## Problem

Long sessions (≥2,000 entries, MB-scale transcript JSONL) are slow to open and
laggy while the agent streams. Root causes, verified in code:

1. **Full-window re-broadcast per tick.** During a live turn, every applied
   entry schedules a broadcast (16 ms coalesced) that re-derives the full
   `ChatSnapshot` (200-message window) and JSON-stringifies it twice per
   subscriber (signature in `getStableChatSnapshotSignature`, then send). The
   protocol has **no delta/chunk event at all** — the streaming feel is
   repeated full-snapshot pushes (`ws-router-broadcast.ts`,
   `pushSnapshots`/`scheduleChatStateBroadcast`).
2. **Full JSONL read on open.** `loadTranscriptFromDisk` reads and parses the
   entire transcript file to serve the last-200 window; only one chat is
   cached at a time, so chat switching re-reads from disk
   (`event-store-messages.adapter.ts`).
3. **No render windowing.** `KannaTranscript.tsx` maps the full row array;
   snapshot replacement produces fresh references so `React.memo` rows
   re-render and markdown re-parses.

## Ratified OKR frame

**Objective:** long sessions fast to open and smooth while streaming.

| KR | Metric (benchmark harness, synthetic long session) | Target |
|----|-----------------------------------------------------|--------|
| KR1 | WS bytes per streaming tick (1 subscriber) | ≥90% reduction |
| KR2 | Server CPU ms per broadcast tick (derive+signature+stringify) | ≥80% reduction |
| KR3 | Time to interactive opening a long chat | ≥50% reduction |
| KR4 | Re-rendered messages per streaming update | only the affected row |

**Anti-goal (tripwire, human-owned):** zero correctness regressions —
`bun run test`, `bun run lint`, `bun run typecheck` exit 0 **and** a
snapshot-vs-ops parity test proves both paths yield identical chat state
(including reconnect with a seq gap). Any failure = breaking flag, work
pauses. Secondary wall: no protocol break for share page and
reconnect/replay paths.

**Flags:** `cannot` (harness shows targets unreachable), `breaking` (any
test/parity failure), `pointless` (a change lands but its KR metric does not
move), `stalled`. Goal changes are human-only.

## Verified constraints (from code exploration)

- `TranscriptEntry` (18 variants, `shared/transcript-types.ts`) each carry a
  stable `_id`; entries are **immutable after append**. No streaming
  accumulation into an existing entry.
- **Single write choke point:** all writers (SDK driver, PTY driver, subagent
  runs) converge on `eventStore.appendMessage(chatId, entry)`
  (`event-store-transcript-write.adapter.ts`).
- No monotonic per-chat sequence exists today.
- Client applies chat snapshots by wholesale replace
  (`useKannaState.ts` → `setChatSnapshot`); reconnect = resubscribe → fresh
  snapshot.
- `ChatRuntime` is small (~a dozen scalar fields); the heavy snapshot
  sections are `messages` and `subagentRuns`.

## Design

### 1. Server core — op-log + seq

- Per-chat monotonic `seq` owned by the event store, bumped on every
  chat-visible mutation. Instrumented at the existing choke points.
- In-memory ring buffer of recent ops per chat (default 512) to serve
  reconnect catch-up. Memory-only; durability stays with the existing
  JSONL/snapshot machinery.
- Op kinds (discriminated union in `src/shared/`):
  - `entries.append` — one or more immutable `TranscriptEntry` (hot op)
  - `runtime.set` — whole `ChatRuntime` (small; no field diffing)
  - `section.set` — key/value replace for rarely-changing sections
    (`queuedMessages`, `schedules`, `tunnels`, `subagentRuns`,
    `loopProgress`, `slashCommands`, `resolvedBindings`,
    `availableProviders`, `liveScheduleId`, `liveTunnelId`, `history`)

### 2. Protocol

- Chat topic gains `since?: number`. Subscribe response = full snapshot +
  `seq` field — this is also the resync path.
- New event envelope: `{ type: "chat.ops", chatId, fromSeq, toSeq, ops[] }`,
  coalesced on the existing 16 ms timer. The op batch is serialized **once**
  and fanned out to all chat subscribers — no per-subscriber
  derive/stringify.
- Gap handling: client sees `fromSeq !== lastSeq + 1` → resubscribe for a
  fresh snapshot. Server ring-buffer miss → send snapshot instead of ops.
  The fail-safe is always "full snapshot", never silent divergence.
- Snapshot signature-dedupe path remains for subscribe/resync and for
  non-chat topics.

### 3. Client store

- Snapshots: wholesale replace (unchanged). New `applyChatOps` merges ops
  immutably: append to `messages`, replace `runtime` / named section.
- Untouched rows keep stable references so `React.memo` rows skip
  re-render.

### 4. Chat-open latency

- Widen the single-chat transcript cache to a small LRU (default 4 chats)
  and clone only the returned page window (≤ recentLimit entries) instead
  of the full entry array on every read.
- JSONL tail-read (seek from end, byte-offset cursors) is DEFERRED: funded
  only if the benchmark shows KR3 still unmet after the LRU + window-clone
  change (evidence-gated per the OKR loop; cursors are opaque to the
  client so the encoding can change later without protocol impact).

### 5. Render cost

- Stable row identity by `_id`; the message components already carry
  structural `React.memo` comparators (verified in
  `KannaTranscript.tsx:419,613,785`), so op-based reference stability makes
  them effective — no separate markdown cache needed in v1.
- CSS `content-visibility: auto` (+ `contain-intrinsic-size`) on transcript
  rows for paint/layout windowing.
- A virtualization library only if post-change metrics still miss KR4 —
  YAGNI first.

### 6. Testing / verification

- **Parity test:** drive the event store through a synthetic turn; after
  every coalesced batch assert snapshot-derived state deep-equals
  ops-applied state; include a forced seq gap → resync case.
- **Benchmark harness (DKR-1, built first):** synthesizes a long session
  (≥2,000 entries, realistic entry sizes), measures KR1–KR4 before/after;
  checked in as a script so numbers are replayable.
- Existing suite + lint + typecheck green = tripwire.

## Out of scope (v1)

- Per-field `ChatRuntime` diffs.
- Op-log persistence to disk (ring buffer is memory-only).
- Subagent-run entry-level ops (section-level replace in v1; noted as a
  follow-up if delegation-heavy sessions still lag).
- Share-page changes (serves the bounded window already; benefits from
  tail-read automatically).

## Rollout / risk

- Client and server ship together; no cross-version compatibility burden
  beyond "old client ignores unknown event types" (it does — unknown
  envelope events are dropped by the socket layer).
- Every failure mode degrades to the current behavior (full snapshot), so
  the worst case equals today's performance.
