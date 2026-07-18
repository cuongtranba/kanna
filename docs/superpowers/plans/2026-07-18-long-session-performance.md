# Long-Session Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long Kanna sessions (≥2,000 transcript entries) fast to open and smooth while streaming, by replacing full-snapshot chat re-broadcast with a versioned per-chat op-log, plus transcript-cache and render optimizations.

**Architecture:** A per-chat monotonic `seq` + in-memory op ring buffer lives in the event store (single write choke point `appendMessage`). During live turns the WS layer pushes small `chat.ops` event envelopes (append/runtime/sections deltas) instead of re-deriving and re-stringifying the full 200-message snapshot per subscriber per 16 ms tick. Full snapshot remains the subscribe/resync/fallback path — every failure mode degrades to today's behavior. Client applies ops immutably via a shared pure reducer. Separately: transcript LRU cache + window-only cloning cut chat-open cost; `content-visibility` CSS cuts paint cost.

**Tech Stack:** Bun, TypeScript (TS7 typecheck), React 19, Zustand, bun:test.

**Spec:** `docs/superpowers/specs/2026-07-18-long-session-performance-design.md` (ratified OKR frame KR1–KR4 + zero-regression anti-goal).

## Global Constraints

- Tests: `bun test --conditions production <file>` per suite; full `bun run test` must pass before push (anti-goal tripwire).
- Lint: `bun run lint` (`--max-warnings=0`). Typecheck: `bun run typecheck` (TS7 via explicit path — never bare `tsc`).
- Side-effect seal: NO `node:fs`/`Bun.*`/`process.env` etc. in `src/shared/**`, `src/client/**`, or `src/server/**` non-adapter files. New IO only in `*.adapter.ts` files or injected. `ChatOpLog` and all reducers must be pure.
- Strong typing: no `any`; discriminated unions for ops; exact types on all signatures.
- Client selectors returning collections MUST return stable refs (`EMPTY` const pattern) — React error #185 guard.
- Do not break: share page (`src/shared/session-share/`), `chat.loadHistory` paging, reconnect resubscribe.
- Commit after every task (conventional commits). Branch: `perf-long-sessions` worktree at `.worktrees/perf-long-sessions`.

---

### Task 1: Benchmark harness (DKR-1 — baseline numbers)

**Files:**
- Create: `scripts/perf/long-session-bench.ts`
- Create: `docs/superpowers/specs/2026-07-18-long-session-perf-baseline.md` (output paste)

**Interfaces:**
- Produces: a runnable script `bun scripts/perf/long-session-bench.ts` printing one JSON object `{ entries, coldOpenMs, tickDeriveMs, tickStringifyMs, tickBytes, signatureMs }`. No src/ imports restrictions apply (scripts/ is outside lint scope), but import from `src/server/...` directly.

- [ ] **Step 1: Write the bench script**

```ts
// scripts/perf/long-session-bench.ts
// Measures KR1-KR3 baselines for a synthetic long session.
// Run: bun scripts/perf/long-session-bench.ts [entryCount]
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "../../src/server/event-store"
import { deriveChatSnapshot } from "../../src/server/read-models"
import { getStableChatSnapshotSignature } from "../../src/server/ws-router-utils"
import type { TranscriptEntry } from "../../src/shared/types"

const ENTRY_COUNT = Number(process.argv[2] ?? 3000)
const RECENT_LIMIT = 200
const TICKS = 100

function makeEntry(i: number): TranscriptEntry {
  if (i % 3 === 0) {
    return {
      _id: `tool-${i}`, createdAt: 1700000000000 + i, kind: "tool_call",
      toolName: "Bash", toolId: `toolu_${i}`,
      arguments: { command: `echo ${"x".repeat(200)}` },
    } as TranscriptEntry
  }
  return {
    _id: `text-${i}`, createdAt: 1700000000000 + i, kind: "assistant_text",
    text: `entry ${i} ${"lorem ipsum dolor sit amet ".repeat(40)}`,
  } as TranscriptEntry
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-bench-"))
  try {
    const store = new EventStore(dir)
    await store.initialize()
    const project = await store.openProject("/tmp/bench-project")
    const chat = await store.createChat(project.id)
    for (let i = 0; i < ENTRY_COUNT; i++) {
      await store.appendMessage(chat.id, makeEntry(i))
    }
    await store.flush()

    // KR3 proxy: cold open (fresh store re-reads JSONL from disk)
    const store2 = new EventStore(dir)
    await store2.initialize()
    const t0 = performance.now()
    store2.getRecentChatHistory(chat.id, RECENT_LIMIT)
    const coldOpenMs = performance.now() - t0

    // KR1+KR2 proxy: full snapshot derive + signature + stringify per tick
    const emptyMap = new Map<string, never>()
    let deriveMs = 0, sigMs = 0, strMs = 0, bytes = 0
    for (let t = 0; t < TICKS; t++) {
      const d0 = performance.now()
      const snap = deriveChatSnapshot(
        store2.state, new Map(), new Set(), new Set(), chat.id,
        (chatId) => store2.getRecentChatHistory(chatId, RECENT_LIMIT),
        (chatId) => store2.getTunnelEvents(chatId),
        new Map(), Date.now(), emptyMap, [],
      )
      const d1 = performance.now()
      const sig = getStableChatSnapshotSignature({ type: "chat", data: snap })
      const d2 = performance.now()
      const payload = JSON.stringify({ type: "snapshot", snapshot: { type: "chat", data: snap } })
      const d3 = performance.now()
      deriveMs += d1 - d0; sigMs += d2 - d1; strMs += d3 - d2; bytes = payload.length
      void sig
    }
    console.log(JSON.stringify({
      entries: ENTRY_COUNT,
      coldOpenMs: Number(coldOpenMs.toFixed(1)),
      tickDeriveMs: Number((deriveMs / TICKS).toFixed(2)),
      signatureMs: Number((sigMs / TICKS).toFixed(2)),
      tickStringifyMs: Number((strMs / TICKS).toFixed(2)),
      tickBytes: bytes,
    }, null, 2))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
void main()
```

Note: if `deriveChatSnapshot`'s parameter list differs (check `src/server/ws-router-envelope.ts:311-323` for the live call shape), mirror that call site exactly. Same for `getStableChatSnapshotSignature` (`src/server/ws-router-utils.ts`) — it takes the snapshot payload the broadcast dedupes on; match its real signature.

- [ ] **Step 2: Run and record baseline**

Run: `cd .worktrees/perf-long-sessions && bun scripts/perf/long-session-bench.ts 3000`
Expected: JSON printed with non-zero `coldOpenMs`, `tickDeriveMs`, `tickBytes` (likely: bytes in the hundreds of KB–MB, derive in the ms–tens of ms).

- [ ] **Step 3: Save baseline doc**

Paste the JSON into `docs/superpowers/specs/2026-07-18-long-session-perf-baseline.md` under a `## Baseline (pre-change)` heading, with the machine note and entry count.

- [ ] **Step 4: Commit**

```bash
git add scripts/perf/long-session-bench.ts docs/superpowers/specs/2026-07-18-long-session-perf-baseline.md
git commit -m "perf: add long-session benchmark harness + baseline (DKR-1)"
```

---

### Task 2: Shared chat-op types + pure reducer

**Files:**
- Create: `src/shared/chat-ops.ts`
- Create: `src/shared/chat-ops.test.ts`
- Modify: `src/shared/types.ts` (add `seq?: number` to `ChatSnapshot`)

**Interfaces:**
- Consumes: `ChatSnapshot`, `ChatRuntime`, `TranscriptEntry` from `src/shared/types.ts` / `src/shared/transcript-types.ts`.
- Produces (used by Tasks 4–8):

```ts
export type ChatSections = Pick<ChatSnapshot,
  | "queuedMessages" | "availableProviders" | "slashCommands" | "slashCommandsLoading"
  | "schedules" | "liveScheduleId" | "tunnels" | "liveTunnelId"
  | "resolvedBindings" | "subagentRuns" | "loopProgress">

export type ChatOp =
  | { kind: "entries.append"; entries: TranscriptEntry[] }
  | { kind: "runtime.set"; runtime: ChatRuntime }
  | { kind: "sections.set"; sections: Partial<ChatSections> }
  | { kind: "pending.set"; entries: TranscriptEntry[] } // pending_tool_request synthetic rows

export interface ChatOpsEvent {
  type: "chat.ops"
  chatId: string
  fromSeq: number
  toSeq: number
  ops: ChatOp[]
}

export function applyChatOps(snapshot: ChatSnapshot, ops: readonly ChatOp[], toSeq: number): ChatSnapshot
```

- [ ] **Step 1: Write failing tests** (`src/shared/chat-ops.test.ts`)

Cover, using a `makeSnapshot()` fixture (build a minimal valid `ChatSnapshot` literal):
1. `entries.append` appends new entries and preserves object identity of untouched rows (`expect(result.messages[0]).toBe(base.messages[0])`).
2. `entries.append` with an `_id` already present REPLACES that entry in place (idempotent overlap after resync).
3. Appending a `context_window_updated` entry when the current last entry is also `context_window_updated` replaces it (mirror `coalesceContextWindowUpdates` semantics — read `src/server/event-store-helpers.ts` and replicate its exact rule; if the rule is more general than "adjacent", extract the helper to `src/shared/transcript-coalesce.ts` and import it from both places instead of duplicating).
4. `runtime.set` replaces runtime, keeps `messages` reference identical.
5. `sections.set` replaces only named keys; unnamed keys keep identity.
6. `pending.set` removes all existing `kind === "pending_tool_request"` entries and appends the new list at the end.
7. `applyChatOps` sets `seq: toSeq` on the result and never mutates the input (deep-freeze the input snapshot in the test).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --conditions production src/shared/chat-ops.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/shared/chat-ops.ts (sketch of the reducer core; full types above)
export function applyChatOps(snapshot: ChatSnapshot, ops: readonly ChatOp[], toSeq: number): ChatSnapshot {
  let messages = snapshot.messages
  let runtime = snapshot.runtime
  let sections: Partial<ChatSections> = {}
  for (const op of ops) {
    if (op.kind === "entries.append") {
      const byId = new Map(op.entries.map((e) => [e._id, e]))
      const replaced = messages.some((e) => byId.has(e._id))
      const kept = replaced ? messages.map((e) => byId.get(e._id) ?? e) : messages
      const fresh = op.entries.filter((e) => !messages.some((m) => m._id === e._id))
      messages = coalesceAppend(kept, fresh) // handles context_window_updated rule
    } else if (op.kind === "runtime.set") {
      runtime = op.runtime
    } else if (op.kind === "sections.set") {
      sections = { ...sections, ...op.sections }
    } else {
      messages = [...messages.filter((e) => e.kind !== "pending_tool_request"), ...op.entries]
    }
  }
  return { ...snapshot, ...sections, runtime, messages, seq: toSeq }
}
```

Also add `seq?: number` to `ChatSnapshot` in `src/shared/types.ts` (optional — `undefined` means "ops not available"; share page never sets it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --conditions production src/shared/chat-ops.test.ts` → PASS.
Run: `bun run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/chat-ops.ts src/shared/chat-ops.test.ts src/shared/types.ts
git commit -m "feat(shared): chat op-log types + pure applyChatOps reducer"
```

---

### Task 3: Protocol plumbing

**Files:**
- Modify: `src/shared/protocol.ts:48` (chat topic), `:93` (WsEvent)

**Interfaces:**
- Produces: `SubscriptionTopic` chat variant becomes `{ type: "chat"; chatId: string; recentLimit?: number; since?: number }`; `WsEvent = TerminalEvent | PtyInstancesEvent | ChatOpsEvent` (import `ChatOpsEvent` from `./chat-ops`).

- [ ] **Step 1: Edit protocol.ts** — the two lines above; import type `ChatOpsEvent`.
- [ ] **Step 2: Verify** — `bun run typecheck` clean; `bun test --conditions production src/shared/` passes.
- [ ] **Step 3: Commit** — `git commit -m "feat(protocol): chat.ops event + since on chat topic"`

---

### Task 4: Server ChatOpLog (pure, in-memory)

**Files:**
- Create: `src/server/chat-op-log.ts`
- Create: `src/server/chat-op-log.test.ts`

**Interfaces:**
- Produces:

```ts
export class ChatOpLog {
  constructor(cap?: number) // default 512
  record(chatId: string, op: ChatOp): number          // returns new seq (starts at 1)
  currentSeq(chatId: string): number                   // 0 when chat unknown
  since(chatId: string, afterSeq: number): { ops: ChatOp[]; fromSeq: number; toSeq: number } | null
  // null = gap (afterSeq older than ring start) → caller must full-snapshot
  clear(chatId: string): void
}
```

- [ ] **Step 1: Failing tests** — record increments seq per chat independently; `since(chat, 0)` after 3 records returns all 3 with `fromSeq:1,toSeq:3`; `since` beyond ring cap returns `null`; `since(chat, currentSeq)` returns `{ops: [], fromSeq: afterSeq+1, toSeq: afterSeq}` (caller skips empty batches); `clear` resets to 0; ring keeps only the last `cap` ops.
- [ ] **Step 2: Run** → FAIL (module not found).
- [ ] **Step 3: Implement** — `Map<string, { seq: number; ring: Array<{ seq: number; op: ChatOp }> }>`; `record` pushes and `ring.splice(0, ring.length - cap)`; `since` returns `null` when `afterSeq < ring[0].seq - 1` (and ring shorter than seq span). Pure module — no IO, no imports beyond shared types.
- [ ] **Step 4: Run** → PASS. `bun run typecheck` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): ChatOpLog ring buffer with per-chat seq"`

---

### Task 5: EventStore integration — record append ops + expose seq

**Files:**
- Modify: `src/server/event-store.ts` (instantiate + expose), `src/server/event-store-transcript-write.adapter.ts:36-58,239-285` (dep + record), `src/server/ws-router-envelope.ts:305-326` (stamp seq)
- Test: extend `src/server/event-store.test.ts`

**Interfaces:**
- Consumes: `ChatOpLog` (Task 4).
- Produces: `EventStore.chatOps: ChatOpLog` (public readonly). `appendMessage` records `{ kind: "entries.append", entries: [entry] }` AFTER the disk append + cache update succeed (inside the write-chain closure, after the dedupe early-return — a deduped entry records nothing). `deleteChat`/`pruneStaleEmptyChats` call `chatOps.clear(chatId)`. Envelope builder stamps `seq` onto chat snapshots.

- [ ] **Step 1: Failing test** (in `event-store.test.ts`): after two `appendMessage` calls + `flush()`, `store.chatOps.currentSeq(chatId) === 2` and `since(chatId, 0)` returns both entries in order; a duplicate `messageId` append does NOT bump seq.
- [ ] **Step 2: Run** → FAIL (`chatOps` undefined).
- [ ] **Step 3: Implement**
  - `event-store.ts`: `readonly chatOps = new ChatOpLog()`. Add to `ChatTranscriptWriteDeps`: `recordChatOp(chatId: string, op: ChatOp): void`, wired in `buildChatTranscriptWriteDeps()` as `(chatId, op) => { this.chatOps.record(chatId, op) }`.
  - `appendMessage` (adapter): after `applyChatMessageMetadata(...)` and cache push, add `deps.recordChatOp(chatId, { kind: "entries.append", entries: [{ ...entry }] })`.
  - `deleteChat` + the prune loop: `deps.recordChatOp` is not needed — instead add `clearChatOps(chatId: string)` dep and call it where the transcript file/cache is removed.
  - `ws-router-envelope.ts` chat branch: capture `const seq = store.chatOps.currentSeq(topic.chatId)` BEFORE `deriveChatSnapshot(...)` (ops recorded mid-derive then overlap; the reducer's upsert-by-`_id` makes overlap idempotent), then `snapshot: { type: "chat", data: data ? { ...data, seq } : null }` (adjust: bind `deriveChatSnapshot` result to a local first).
- [ ] **Step 4: Run** — the new test + `bun test --conditions production src/server/event-store.test.ts src/server/ws-router.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): record entries.append ops in appendMessage; stamp seq on chat snapshots"`

---

### Task 6: Meta-diff op generation (pure)

**Files:**
- Create: `src/server/chat-ops-diff.ts`
- Create: `src/server/chat-ops-diff.test.ts`

**Interfaces:**
- Consumes: `ChatSnapshot`, `ChatOp`, `ChatSections`.
- Produces (used by Task 7):

```ts
export interface ChatMetaSignatures { runtime: string; pending: string; sections: Record<string, string> }

/** Diff the light (non-transcript) parts of a chat snapshot against the last-sent signatures.
 *  `meta` is a snapshot derived with recentLimit=0 (messages = pending_tool_request rows only). */
export function diffChatMeta(
  prev: ChatMetaSignatures | undefined,
  meta: ChatSnapshot,
): { ops: ChatOp[]; next: ChatMetaSignatures }
```

Rules: `runtime` compared via `JSON.stringify` of `{...meta.runtime, timings: null}` (timings churn constantly — excluded from delta triggering, same as the existing broadcast signature strips them); emit `runtime.set` (WITH real timings) when changed. Each `ChatSections` key compared via its own `JSON.stringify`; changed keys collected into ONE `sections.set` op. `pending` = stringify of `meta.messages` (which are only pending rows at limit 0); emit `pending.set` when changed. First call (prev undefined) emits NO ops, only signatures (baseline snapshot already carried the state).

- [ ] **Step 1: Failing tests** — no-change → zero ops; runtime status flip → single `runtime.set`; timings-only change → zero ops; one section change → `sections.set` with exactly that key; pending added → `pending.set`; first call → zero ops + full signatures.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (pure; iterate a `const SECTION_KEYS: readonly (keyof ChatSections)[]` array so a future `ChatSnapshot` key addition fails typecheck here — belt for drift). **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -m "feat(server): pure chat meta diff → ops"`

---

### Task 7: Broadcast ops path (BroadcastManager + subscription seq tracking)

**Files:**
- Modify: `src/server/ws-router-utils.ts` (ClientState + per-sub seq map), `src/server/ws-router-broadcast.ts:235-295` (`pushSnapshots`)
- Test: extend `src/server/ws-router.test.ts` (follow its existing fake-socket pattern)

**Interfaces:**
- Consumes: `EventStore.chatOps`, `diffChatMeta`, `ChatOpsEvent`, envelope builder.
- Produces: subscribers with a tracked seq receive `{v:1, type:"event", id, event: ChatOpsEvent}` envelopes during chat updates; snapshot fallback on gap; per-sub tracking in `ws.data.chatOpSeqBySubId: Map<string, number>` and per-chat meta signatures in a `BroadcastManager` private `metaSigsByChatId: Map<string, ChatMetaSignatures>`.

- [ ] **Step 1: Failing test** — using the ws-router test harness: subscribe a fake socket to a chat topic; initial push = snapshot with `seq`; append an entry via the store + trigger `broadcastChatStateImmediately(chatId)`; assert the second send is an `event` envelope with one `entries.append` op and `toSeq === seq+1`, NOT a snapshot. Then simulate gap (record 600 ops with cap 512 semantics via `store.chatOps.record` in a loop) + broadcast → assert a full snapshot envelope is sent and tracking reset to its new seq.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** in `pushSnapshots` (chat-topic branch, BEFORE building the full envelope):

```ts
if (topic.type === "chat") {
  const tracked = ws.data.chatOpSeqBySubId?.get(id)
  if (tracked !== undefined) {
    const res = this.deps.store.chatOps.since(topic.chatId, tracked)
    if (res !== null) {
      // meta diff once per chat per broadcast (cache on options.cache)
      const metaOps = this.buildMetaOps(topic.chatId, options?.cache)
      const ops = [...res.ops, ...metaOps.ops]
      if (ops.length === 0) { skippedCount += 1; continue }
      const toSeq = this.deps.store.chatOps.currentSeq(topic.chatId)
      ws.data.chatOpSeqBySubId!.set(id, toSeq)
      send(ws, { v: PROTOCOL_VERSION, type: "event", id, event: {
        type: "chat.ops", chatId: topic.chatId, fromSeq: tracked + 1, toSeq, ops,
      }})
      sentCount += 1
      continue
    }
    ws.data.chatOpSeqBySubId!.delete(id) // gap → fall through to full snapshot
  }
}
```

`buildMetaOps(chatId, cache)`: derive meta snapshot via the envelope deps (`deriveChatSnapshot` with a history fn of `(id) => store.getRecentChatHistory(id, 0)` — cheap: `getRecentMessagesPage` short-circuits at limit ≤ 0), run `diffChatMeta(this.metaSigsByChatId.get(chatId), meta)`, store `next`, memoize per `SnapshotComputationCache` (add optional `chatMetaOpsByChatId?: Map<string, ChatOp[]>` to that type) so multiple sockets share one derive per tick. Meta ops that fire when NO subscriber needs them: record them into `chatOps` (`store.chatOps.record`) so late subscribers replay them in order — i.e. `buildMetaOps` records each op and `pushSnapshots` relies solely on `since()` output; simplify the block above accordingly (metaOps go through the ring, not merged ad hoc — ONE ordering authority). After the snapshot path sends a full chat snapshot with `data.seq !== undefined`, set `ws.data.chatOpSeqBySubId.set(id, data.seq)` (initialize the map lazily). On unsubscribe/socket close the map entry dies with `ws.data` — no explicit cleanup needed beyond `chatOpSeqBySubId.delete(id)` in the unsubscribe handler in `ws-router.ts` (find the `unsubscribe` case and mirror how `snapshotSignatures` entries are cleaned; if they aren't, skip — the map is per-socket).
- [ ] **Step 4: Run** — new test + `bun test --conditions production src/server/ws-router.test.ts` → PASS. Also `bun run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): chat.ops delta broadcast with snapshot fallback"`

---

### Task 8: Client — apply ops, gap resync

**Files:**
- Modify: `src/client/app/useKannaState.ts:1358-1417` (chat subscription), the `useKannaStateStore` definition in the same file/store module (add `applyChatOps` action + `chatResyncNonce`)
- Test: extend the store's existing test (`src/client/app/useKannaState.test.ts`)

**Interfaces:**
- Consumes: `applyChatOps` (Task 2), `ChatOpsEvent` (protocol), `socket.subscribe(topic, listener, eventListener)` (already supported — `src/client/app/socket.ts:122-139`).
- Produces: store action `applyChatOpsEvent(chatId: string, event: ChatOpsEvent): "applied" | "stale" | "gap"` (delegates to the shared `applyChatOps` reducer) + `bumpChatResyncNonce(): void` + `chatResyncNonce: number` state; on `"gap"` the subscription effect re-runs (nonce bump) → fresh snapshot.

- [ ] **Step 1: Failing tests** — store-level: seed snapshot with `seq: 5`; event `{fromSeq: 6, toSeq: 6, ops:[entries.append]}` → applied, message appended, `seq === 6`, untouched entry refs stable; event `{fromSeq: 8, ...}` → `"gap"`, snapshot unchanged; event `{toSeq: 4}` → `"stale"`, unchanged; event for a different chatId than the active snapshot → ignored.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — in the store: compare against `current.seq`; `"applied"` path sets `applyChatOps(current, event.ops, event.toSeq)` from shared reducer. In `useKannaState`'s chat subscribe effect, add the third argument:

```ts
socket.subscribe<ChatSnapshot | null, ChatOpsEvent>(
  { type: "chat", chatId: activeChatId, recentLimit: INITIAL_CHAT_RECENT_LIMIT },
  (snapshot) => { /* existing wholesale replace */ },
  (event) => {
    if (event.type !== "chat.ops" || event.chatId !== activeChatId) return
    const result = useKannaStateStore.getState().applyChatOpsEvent(activeChatId, event)
    if (result === "gap") useKannaStateStore.getState().bumpChatResyncNonce()
  },
)
```

and include `chatResyncNonce` in the effect dependency array so a bump unsubscribes + resubscribes (fresh snapshot resets seq). Keep the existing `sameChatSnapshotCore` reuse check.
- [ ] **Step 4: Run** — `bun test --conditions production src/client/app/useKannaState.test.ts` → PASS; `bun run lint` clean (watch the stable-ref selector rule).
- [ ] **Step 5: Commit** — `git commit -m "feat(client): apply chat.ops deltas with gap-triggered resync"`

---

### Task 9: Snapshot-vs-ops parity test (anti-goal enforcement)

**Files:**
- Create: `src/server/chat-ops-parity.test.ts`

**Interfaces:** consumes EventStore, `deriveChatSnapshot`, `diffChatMeta`, `applyChatOps`.

- [ ] **Step 1: Write the parity test** — temp-dir EventStore; take baseline snapshot (recentLimit 1000). Then drive a scripted sequence: 30 appends of mixed kinds (assistant_text, tool_call, tool_result, `context_window_updated` ×3 consecutive, user_prompt), a `recordTurnStarted`/`recordTurnFinished` flip, a queued message enqueue. After EVERY mutation batch: collect ops via `store.chatOps.since(chatId, lastSeq)` + `diffChatMeta` (drive it the same way Task 7's `buildMetaOps` does), apply with `applyChatOps` onto the running client-side snapshot, and `expect(opsApplied).toEqual({ ...deriveChatSnapshot(freshly), seq: expect.any(Number) })` — normalize `timings` (exclude from comparison, they are wall-clock). Final case: force a ring gap (record > cap ops) and assert `since` returns null (resync contract).
- [ ] **Step 2: Run** → `bun test --conditions production src/server/chat-ops-parity.test.ts` PASS (fix reducer/diff bugs it surfaces — this test is the wall; timeout 30_000).
- [ ] **Step 3: Commit** — `git commit -m "test(server): snapshot-vs-ops parity wall"`

---

### Task 10: Transcript LRU cache + window-only cloning (KR3)

**Files:**
- Modify: `src/server/event-store-messages.adapter.ts` (cache + read paths), `src/server/event-store-transcript-write.adapter.ts:145-147,227-229,270-272` (cache touch points), `src/server/event-store.ts:85` (ref construction), `src/server/event-store-init.ts` (cachedTranscriptRef usages — grep for `cachedTranscriptRef`)
- Test: extend `src/server/event-store-messages.adapter.test.ts`

**Interfaces:**
- Produces: `CachedTranscriptRef` replaced by:

```ts
export class TranscriptCache {
  constructor(maxChats?: number) // default 4
  get(chatId: string): TranscriptEntry[] | undefined   // touches LRU order
  set(chatId: string, entries: TranscriptEntry[]): void // evicts LRU beyond max
  appendTo(chatId: string, entry: TranscriptEntry): void // no-op if not cached
  invalidate(chatId: string): void
  invalidateAll(): void
}
```

and a new internal `getMessagesView(deps, chatId): readonly TranscriptEntry[]` returning the cached array WITHOUT cloning (do-not-mutate contract, `readonly` type). `getRecentMessagesPage` / `getMessagesPageBefore` switch to the view + clone only the returned page (`page.entries.map(cloneEntry)`); public `getMessages` keeps full-clone semantics for all other callers.

- [ ] **Step 1: Failing tests** — LRU: load chats A,B,C,D,E → A evicted (5th distinct load re-reads disk; assert via a counting fake `StorageBackend.readTextSync`); switching back to B = no disk read. Window clone: mutate an entry object returned by `getRecentMessagesPage` → cached entry unaffected. `appendTo` on cached chat visible in next page read.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — `TranscriptCache` = `Map<string, TranscriptEntry[]>` with Map-insertion-order LRU (delete+set on touch). Update every `cachedTranscriptRef.value` usage (grep `cachedTranscriptRef` across `src/server/`) to the new API. Keep `legacyMessagesByChatId` path working.
- [ ] **Step 4: Run** — adapter test + `bun test --conditions production src/server/` (full server suite — this touches hot paths) → PASS.
- [ ] **Step 5: Commit** — `git commit -m "perf(server): transcript LRU cache + window-only page cloning"`

---

### Task 11: Render windowing CSS (KR4 support)

**Files:**
- Modify: `src/client/app/KannaTranscript.tsx:945-947` (row wrapper div)

- [ ] **Step 1: Add CSS containment** — change the row wrapper to:

```tsx
<div key={row.id} className="mx-auto max-w-[800px] pb-5 [content-visibility:auto] [contain-intrinsic-size:auto_160px]">
```

- [ ] **Step 2: Manual browser verification (required — UI change)** — `bun run dev`, open a long chat (or seed one with the bench script pointed at the dev KANNA_HOME), verify: scroll is smooth, no layout jumps at top/bottom anchors, jump-to-bottom still lands correctly, streaming keeps auto-scroll behavior. If scroll anchoring breaks, drop `contain-intrinsic-size` to `auto 120px` or remove `content-visibility` from the LAST 10 rows (nearest to the live edge) by index check — document what you shipped.
- [ ] **Step 3: Run loop-check tests** — `bun test --conditions production src/client/app/KannaTranscript.test.tsx` → PASS.
- [ ] **Step 4: Commit** — `git commit -m "perf(client): content-visibility windowing on transcript rows"`

---

### Task 12: Post-change benchmark, KR verdict, docs, C3 sweep

**Files:**
- Modify: `scripts/perf/long-session-bench.ts` (add ops-path measurement), `docs/superpowers/specs/2026-07-18-long-session-perf-baseline.md` (post numbers)
- Modify: `.c3/` docs via `/c3 change` (protocol + event-store + ws-router + transcript components changed)

- [ ] **Step 1: Extend bench** — add a second measured loop: per tick, `store.chatOps.record(...)` one entry op + `since(chatId, seq-1)` + `JSON.stringify` of the `chat.ops` envelope; report `opsTickMs` and `opsTickBytes`.
- [ ] **Step 2: Run + record** — `bun scripts/perf/long-session-bench.ts 3000`; paste under `## Post-change`. Compute reductions against baseline. **KR verdict table** (KR1 bytes ≥90%↓, KR2 tick CPU ≥80%↓, KR3 cold open ≥50%↓). KR3 note: if cold open misses the target, the deferred tail-read task (spec §4) is the funded follow-up — flag `pointless` on KR3 and stop; do NOT silently expand scope.
- [ ] **Step 3: C3 update** — run `/c3 change` covering: new shared module `chat-ops`, new server modules `chat-op-log` / `chat-ops-diff`, protocol event addition, transcript cache change. Same-PR doc update is a repo blocker rule.
- [ ] **Step 4: Full verification (anti-goal tripwire)** — `bun run lint && bun run typecheck && bun run test` — ALL must exit 0. Read the output; no "should pass".
- [ ] **Step 5: Commit** — `git add -A && git commit -m "perf: post-change bench numbers + c3 docs"`

---

## KR ↔ Task map

| KR | Tasks | Measured by |
|----|-------|-------------|
| KR1 bytes/tick ≥90%↓ | 2–8 | bench `tickBytes` vs `opsTickBytes` |
| KR2 tick CPU ≥80%↓ | 2–8, 10 | bench `tickDeriveMs+signatureMs+tickStringifyMs` vs `opsTickMs` |
| KR3 open ≥50%↓ | 10 (+deferred tail-read) | bench `coldOpenMs` |
| KR4 single-row re-render | 8 (ref stability), 11 | React DevTools profiler, manual |
| Anti-goal | 9, 12 | parity test + full suite/lint/typecheck |

## Deferred (needs benchmark evidence before funding)

- JSONL tail-read with byte-offset cursors (spec §4) — only if KR3 unmet after Task 10.
- Virtualization library — only if KR4 unmet after Task 11.
- Per-entry ops for `subagentRuns` — only if delegation-heavy sessions still lag (sections.set covers v1).
