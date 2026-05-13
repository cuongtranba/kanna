# Phase 3 — Subagent Orchestration & UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run subagents that were parsed in phase 2. Parallel fan-out on multi-mention (cap 4), depth-1 chained delegation, full error code surface, transcript projection. Native SDK `Agent` tool stays untouched as a separate primary-driven mechanism.

**Architecture:** A new `SubagentOrchestrator` reads `subagentMentions` already stored on `message_appended` envelopes and spawns one provider session per mention. It uses phase 1's `buildHistoryPrimer` for `contextScope: "full-transcript"` and a new `extractPreviousAssistantReply` for the default scope. Each run emits `subagent_run_started/delta/completed/failed/cancelled` events; a new `subagentRuns: Map<runId, SubagentRunSnapshot>` field on the chat snapshot carries state to the client. Send-flow gates the primary turn: when at least one resolved subagent mention is present, the primary turn does NOT fire.

**Tech Stack:** TypeScript, Bun, React 19, Zustand, bun:test, JSONL event log.

**Design reference:** `docs/superpowers/specs/2026-05-13-model-independent-chat-phase3-subagent-orchestration.md`.

**Baseline:** Phases 1 and 2 merged. Branch `plans/model-independent-chat-phase3` off the phase-2 tip. Verify `bun test` passes before starting.

---

## File Structure

**Server (new + modify):**
- `src/server/subagent-orchestrator.ts` (new) — fan-out, chain, loop detection, depth cap
- `src/server/subagent-orchestrator.test.ts` (new)
- `src/server/history-primer.ts` — add `extractPreviousAssistantReply`
- `src/server/events.ts` — add 5 `subagent_run_*` event types; extend `StoreEvent`
- `src/server/event-store.ts` — reducer for `subagentRuns` map; reply-on-replay
- `src/server/agent.ts` — `send()` gates primary turn when resolved mentions present
- `src/shared/types.ts` — `SubagentRunSnapshot`, `SubagentErrorCode`; extend `ChatSnapshot` with `subagentRuns`

**Client (new + modify):**
- `src/client/components/messages/SubagentMessage.tsx` (new)
- `src/client/components/messages/SubagentErrorCard.tsx` (new)
- `src/client/app/KannaTranscript.tsx` — render subagent rows, group siblings, indent chains
- `src/client/app/KannaTranscript.test.tsx` — render assertions
- `src/client/components/chat-ui/ChatInput.test.tsx` — gating regression

---

## Task 1 — Read-model types

**Files:**
- Modify: `src/shared/types.ts` (near `ChatSnapshot` at line 1240)

- [ ] **Step 1: Add types**

Insert into `src/shared/types.ts`:

```ts
export type SubagentErrorCode =
  | "AUTH_REQUIRED"
  | "UNKNOWN_SUBAGENT"
  | "LOOP_DETECTED"
  | "DEPTH_EXCEEDED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"

export type SubagentRunStatus = "running" | "completed" | "failed" | "cancelled"

export interface ProviderUsage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  costUsd?: number
}

export interface SubagentRunSnapshot {
  runId: string
  chatId: string
  subagentId: string
  subagentName: string
  provider: AgentProvider
  model: string
  status: SubagentRunStatus
  parentUserMessageId: string
  parentRunId: string | null
  depth: number
  startedAt: number
  finishedAt: number | null
  finalText: string | null
  error: { code: SubagentErrorCode; message: string } | null
  usage: ProviderUsage | null
}
```

Extend `ChatSnapshot` (line 1240):

```ts
export interface ChatSnapshot {
  // ... existing
  subagentRuns: Record<string, SubagentRunSnapshot>
}
```

`Record` (plain object) rather than `Map` so it survives JSON serialization over the WebSocket. Reducer stores in `Map` and projects to `Record` at snapshot time.

- [ ] **Step 2: Typecheck**

Run: `bun run check 2>&1 | tail -10`
Expected: PASS for `types.ts`; downstream consumers will fail until they project the new field — addressed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): SubagentRunSnapshot + SubagentErrorCode"
```

---

## Task 2 — `subagent_run_*` events

**Files:**
- Modify: `src/server/events.ts:260` (StoreEvent union)

- [ ] **Step 1: Add events**

Append to `src/server/events.ts` above the final `StoreEvent` union:

```ts
export type SubagentRunEvent =
  | {
      v: 3
      type: "subagent_run_started"
      timestamp: number
      chatId: string
      runId: string
      subagentId: string
      subagentName: string
      provider: AgentProvider
      model: string
      parentUserMessageId: string
      parentRunId: string | null
      depth: number
    }
  | {
      v: 3
      type: "subagent_message_delta"
      timestamp: number
      chatId: string
      runId: string
      content: string
    }
  | {
      v: 3
      type: "subagent_run_completed"
      timestamp: number
      chatId: string
      runId: string
      finalContent: string
      usage?: ProviderUsage
    }
  | {
      v: 3
      type: "subagent_run_failed"
      timestamp: number
      chatId: string
      runId: string
      error: { code: SubagentErrorCode; message: string }
    }
  | {
      v: 3
      type: "subagent_run_cancelled"
      timestamp: number
      chatId: string
      runId: string
    }
```

Import `SubagentErrorCode`, `ProviderUsage` from `../shared/types`.

Update `StoreEvent`:

```ts
export type StoreEvent = ProjectEvent | ChatEvent | MessageEvent | QueuedMessageEvent | TurnEvent | StackEvent | AutoContinueEvent | SubagentRunEvent
```

`STORE_VERSION` stays at 3 — older clients ignore unknown `type` values.

- [ ] **Step 2: Commit (broken build OK)**

```bash
git add src/server/events.ts
git commit -m "feat(events): subagent_run_* durable events"
```

---

## Task 3 — `subagentRuns` reducer + replay

**Files:**
- Modify: `src/server/event-store.ts:495-1000` (applyEvent + StoreState init)

- [ ] **Step 1: Add `subagentRunsByChatId` to `StoreState`**

In `src/server/events.ts:44`:

```ts
export interface StoreState {
  // ... existing
  subagentRunsByChatId: Map<string, Map<string, SubagentRunSnapshot>>
}
```

In `event-store.ts` wherever `StoreState` is initialized, seed an empty map.

- [ ] **Step 2: Initialize on `chat_created`**

In `applyEvent` chat_created handler (search for `case "chat_created":` around event-store.ts:530):

```ts
this.state.subagentRunsByChatId.set(e.chatId, new Map())
```

And on `chat_deleted`:

```ts
this.state.subagentRunsByChatId.delete(e.chatId)
```

- [ ] **Step 3: Add handlers**

In `applyEvent`'s switch:

```ts
case "subagent_run_started": {
  const map = this.state.subagentRunsByChatId.get(e.chatId)
  if (!map) break
  map.set(e.runId, {
    runId: e.runId,
    chatId: e.chatId,
    subagentId: e.subagentId,
    subagentName: e.subagentName,
    provider: e.provider,
    model: e.model,
    status: "running",
    parentUserMessageId: e.parentUserMessageId,
    parentRunId: e.parentRunId,
    depth: e.depth,
    startedAt: e.timestamp,
    finishedAt: null,
    finalText: null,
    error: null,
    usage: null,
  })
  break
}
case "subagent_message_delta": {
  const map = this.state.subagentRunsByChatId.get(e.chatId)
  const run = map?.get(e.runId)
  if (!run) break
  run.finalText = (run.finalText ?? "") + e.content
  break
}
case "subagent_run_completed": {
  const map = this.state.subagentRunsByChatId.get(e.chatId)
  const run = map?.get(e.runId)
  if (!run) break
  run.status = "completed"
  run.finishedAt = e.timestamp
  run.finalText = e.finalContent
  run.usage = e.usage ?? null
  break
}
case "subagent_run_failed": {
  const map = this.state.subagentRunsByChatId.get(e.chatId)
  const run = map?.get(e.runId)
  if (!run) break
  run.status = "failed"
  run.finishedAt = e.timestamp
  run.error = e.error
  break
}
case "subagent_run_cancelled": {
  const map = this.state.subagentRunsByChatId.get(e.chatId)
  const run = map?.get(e.runId)
  if (!run) break
  run.status = "cancelled"
  run.finishedAt = e.timestamp
  break
}
```

- [ ] **Step 4: Add appenders**

```ts
async appendSubagentEvent(event: SubagentRunEvent) {
  await this.append(this.turnsLogPath, event)
}
```

(All five variants share the turns log to keep the on-disk schema simple. They are filtered at read time by `type`.)

- [ ] **Step 5: Add replay-order priority**

Search `getReplayEventPriority` in `event-store.ts`. Add the new event types — order doesn't matter relative to other turn events, so they can share the turn priority bucket.

- [ ] **Step 6: Add replay test**

In `src/server/event-store.test.ts`:

```ts
test("subagent_run_* events build subagentRuns map", async () => {
  const { dir } = await setupStoreWithChat() // existing helper
  // append run started + delta + completed
  const runId = "r1"
  await store.appendSubagentEvent({ v: 3, type: "subagent_run_started", timestamp: 1, chatId, runId, subagentId: "s1", subagentName: "alpha", provider: "claude", model: "claude-opus-4-7", parentUserMessageId: "u1", parentRunId: null, depth: 0 })
  await store.appendSubagentEvent({ v: 3, type: "subagent_message_delta", timestamp: 2, chatId, runId, content: "hello" })
  await store.appendSubagentEvent({ v: 3, type: "subagent_run_completed", timestamp: 3, chatId, runId, finalContent: "hello world" })

  const reloaded = new EventStore(dir)
  await reloaded.ready()
  const runs = reloaded.getSubagentRuns(chatId)
  expect(runs[runId].status).toBe("completed")
  expect(runs[runId].finalText).toBe("hello world")
})
```

Expose `getSubagentRuns(chatId)` on `EventStore`:

```ts
getSubagentRuns(chatId: string): Record<string, SubagentRunSnapshot> {
  const map = this.state.subagentRunsByChatId.get(chatId)
  if (!map) return {}
  return Object.fromEntries(map.entries())
}
```

- [ ] **Step 7: Run tests**

Run: `bun test src/server/event-store.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/events.ts src/server/event-store.ts src/server/event-store.test.ts
git commit -m "feat(event-store): subagentRuns reducer + replay"
```

---

## Task 4 — Project `subagentRuns` into `ChatSnapshot`

**Files:**
- Modify: `src/server/read-models.ts` (chat snapshot builder)

- [ ] **Step 1: Add field to snapshot projection**

Find the function that builds `ChatSnapshot` in `read-models.ts`. Add:

```ts
subagentRuns: store.getSubagentRuns(chatId),
```

- [ ] **Step 2: Sort siblings deterministically when consumed**

Sorting belongs in the client; the read model passes the full map.

- [ ] **Step 3: Run tests**

Run: `bun test src/server/read-models.test.ts`
Expected: PASS (update fixtures that build `ChatSnapshot` to seed empty `subagentRuns: {}`).

- [ ] **Step 4: Commit**

```bash
git add src/server/read-models.ts src/server/read-models.test.ts
git commit -m "feat(read-models): expose subagentRuns on ChatSnapshot"
```

---

## Task 5 — `extractPreviousAssistantReply`

**Files:**
- Modify: `src/server/history-primer.ts`
- Modify: `src/server/history-primer.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/server/history-primer.test.ts`:

```ts
import { extractPreviousAssistantReply } from "./history-primer"

describe("extractPreviousAssistantReply", () => {
  test("returns null when no prior assistant reply", () => {
    const entries: TranscriptEntry[] = [userEntry("hi", 1000)]
    expect(extractPreviousAssistantReply(entries)).toBeNull()
  })

  test("returns last assistant text", () => {
    const entries: TranscriptEntry[] = [
      userEntry("hi", 1000),
      assistantEntry("first reply", 1100),
      userEntry("more", 1200),
      assistantEntry("second reply", 1300),
    ]
    expect(extractPreviousAssistantReply(entries)).toBe("second reply")
  })

  test("falls back to tool call summary if reply has no text", () => {
    // Build a turn whose only assistant-side entry is a tool call.
    const entries: TranscriptEntry[] = [
      userEntry("run x", 1000),
      { _id: "t1", kind: "tool_call", createdAt: 1100, tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "x", input: { command: "ls" } } } as any,
    ]
    expect(extractPreviousAssistantReply(entries)).toBe("Bash: ls")
  })
})
```

- [ ] **Step 2: Run, verify red**

Run: `bun test src/server/history-primer.test.ts`
Expected: FAIL — function missing.

- [ ] **Step 3: Implement**

Append to `src/server/history-primer.ts`:

```ts
export function extractPreviousAssistantReply(entries: TranscriptEntry[]): string | null {
  // Walk backwards. Pick the last assistant_text entry's text.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.kind === "assistant_text") return entry.text
  }
  // No assistant_text — fall back to a one-line tool-call summary of the last assistant-side entry.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.kind === "tool_call") {
      const tool = entry.tool
      const cmdSummary = "command" in (tool.input ?? {}) ? `: ${(tool.input as { command?: string }).command ?? ""}` : ""
      return `${tool.toolName}${cmdSummary}`.trim()
    }
  }
  return null
}
```

- [ ] **Step 4: Run, verify green**

Run: `bun test src/server/history-primer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/history-primer.ts src/server/history-primer.test.ts
git commit -m "feat(history-primer): extractPreviousAssistantReply"
```

---

## Task 6 — Orchestrator core

**Files:**
- Create: `src/server/subagent-orchestrator.ts`
- Create: `src/server/subagent-orchestrator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/subagent-orchestrator.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { SubagentOrchestrator } from "./subagent-orchestrator"
import type { Subagent } from "../shared/types"

function makeSubagent(over: Partial<Subagent>): Subagent {
  return {
    id: "sa-1",
    name: "alpha",
    provider: "claude",
    model: "claude-opus-4-7",
    modelOptions: { reasoningEffort: "medium", contextWindow: "1m" } as any,
    systemPrompt: "You are alpha.",
    contextScope: "previous-assistant-reply",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe("SubagentOrchestrator", () => {
  test("runs single mention and emits started + completed", async () => {
    const harness = await setupHarness({ subagents: [makeSubagent({})] })
    await harness.orchestrator.runMentionsForUserMessage({
      chatId: "c1",
      userMessageId: "u1",
      mentions: [{ kind: "subagent", subagentId: "sa-1", raw: "@agent/alpha" }],
    })
    const runs = harness.store.getSubagentRuns("c1")
    const run = Object.values(runs)[0]
    expect(run.subagentId).toBe("sa-1")
    expect(run.status).toBe("completed")
    expect(run.depth).toBe(0)
  })

  test("UNKNOWN_SUBAGENT emitted for unknown-subagent mention", async () => {
    const harness = await setupHarness({ subagents: [] })
    await harness.orchestrator.runMentionsForUserMessage({
      chatId: "c1",
      userMessageId: "u1",
      mentions: [{ kind: "unknown-subagent", name: "nobody", raw: "@agent/nobody" }],
    })
    const runs = Object.values(harness.store.getSubagentRuns("c1"))
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe("failed")
    expect(runs[0].error?.code).toBe("UNKNOWN_SUBAGENT")
  })

  test("parallel fan-out caps at MAX_PARALLEL=4", async () => {
    const subagents = [1,2,3,4,5].map((i) => makeSubagent({ id: `sa-${i}`, name: `a${i}` }))
    const harness = await setupHarness({ subagents })
    const startSpy = harness.providerStartSpy
    const mentions = subagents.map((s) => ({ kind: "subagent" as const, subagentId: s.id, raw: `@agent/${s.name}` }))
    const promise = harness.orchestrator.runMentionsForUserMessage({ chatId: "c1", userMessageId: "u1", mentions })
    await harness.tick()  // allow microtasks
    expect(startSpy.activeCount()).toBeLessThanOrEqual(4)
    harness.resolveAllPending()
    await promise
  })

  test("DEPTH_EXCEEDED when chained at depth=2", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha" })
    const beta = makeSubagent({ id: "sa-b", name: "beta" })
    const harness = await setupHarness({ subagents: [alpha, beta] })
    harness.programReply("sa-a", "delegate to @agent/beta")
    harness.programReply("sa-b", "delegate to @agent/alpha")  // would be depth 2
    await harness.orchestrator.runMentionsForUserMessage({
      chatId: "c1",
      userMessageId: "u1",
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    const runs = Object.values(harness.store.getSubagentRuns("c1"))
    const failed = runs.find((r) => r.error?.code === "DEPTH_EXCEEDED")
    expect(failed).toBeDefined()
  })

  test("LOOP_DETECTED when chained run mentions an ancestor subagent", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha" })
    const harness = await setupHarness({ subagents: [alpha] })
    harness.programReply("sa-a", "delegate to @agent/alpha")
    await harness.orchestrator.runMentionsForUserMessage({
      chatId: "c1",
      userMessageId: "u1",
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    const runs = Object.values(harness.store.getSubagentRuns("c1"))
    expect(runs.find((r) => r.error?.code === "LOOP_DETECTED")).toBeDefined()
  })

  test("AUTH_REQUIRED when provider creds missing", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha", provider: "codex" })
    const harness = await setupHarness({ subagents: [alpha], codexAuth: false })
    await harness.orchestrator.runMentionsForUserMessage({
      chatId: "c1",
      userMessageId: "u1",
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    const runs = Object.values(harness.store.getSubagentRuns("c1"))
    expect(runs[0].error?.code).toBe("AUTH_REQUIRED")
  })

  test("TIMEOUT cancels run after 120s wall-clock", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha" })
    const harness = await setupHarness({ subagents: [alpha], runTimeoutMs: 50 })
    harness.holdReply("sa-a")  // never resolves
    await harness.orchestrator.runMentionsForUserMessage({
      chatId: "c1",
      userMessageId: "u1",
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    const runs = Object.values(harness.store.getSubagentRuns("c1"))
    expect(runs[0].error?.code).toBe("TIMEOUT")
  })

  test("renamed subagent mid-run keeps snapshotted name", async () => {
    const alpha = makeSubagent({ id: "sa-a", name: "alpha" })
    const harness = await setupHarness({ subagents: [alpha] })
    const promise = harness.orchestrator.runMentionsForUserMessage({
      chatId: "c1",
      userMessageId: "u1",
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    await harness.tick()
    await harness.appSettings.updateSubagent("sa-a", { name: "renamed" })
    harness.resolveReply("sa-a", "done")
    await promise
    const run = Object.values(harness.store.getSubagentRuns("c1"))[0]
    expect(run.subagentName).toBe("alpha")
  })
})
```

Build a `setupHarness` helper (top of test file) that wires:
- `EventStore` against a temp dir
- `AppSettings` against a temp file
- A mocked provider start fn whose behavior is programmable via `programReply` / `holdReply` / `resolveReply`
- A spy that exposes `activeCount()` (currently in-flight provider start calls)

- [ ] **Step 2: Run tests, verify red**

Run: `bun test src/server/subagent-orchestrator.test.ts 2>&1 | tail -20`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement orchestrator**

Create `src/server/subagent-orchestrator.ts`:

```ts
import crypto from "node:crypto"
import type { EventStore } from "./event-store"
import type { AppSettings } from "./app-settings"
import type { ParsedMention } from "./mention-parser"
import type { AgentProvider, Subagent, SubagentErrorCode, TranscriptEntry } from "../shared/types"
import { buildHistoryPrimer, extractPreviousAssistantReply } from "./history-primer"
import { parseMentions } from "./mention-parser"

export interface ProviderRunStart {
  provider: AgentProvider
  model: string
  systemPrompt: string
  preamble: string | null
  // returns final assistant text and optional usage
  start: () => Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }>
  // optional auth check
  authReady: () => Promise<boolean>
}

export interface SubagentOrchestratorDeps {
  store: EventStore
  appSettings: AppSettings
  startProviderRun: (args: {
    subagent: Subagent
    chatId: string
    primer: string | null
  }) => ProviderRunStart
  now?: () => number
  maxParallel?: number
  maxChainDepth?: number
  runTimeoutMs?: number
}

const DEFAULT_MAX_PARALLEL = 4
const DEFAULT_MAX_CHAIN_DEPTH = 1
const DEFAULT_RUN_TIMEOUT_MS = 120_000

export class SubagentOrchestrator {
  private semaphoreCount = 0
  private queue: Array<() => void> = []

  constructor(private readonly deps: SubagentOrchestratorDeps) {}

  private maxParallel() { return this.deps.maxParallel ?? DEFAULT_MAX_PARALLEL }
  private maxDepth() { return this.deps.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH }
  private timeoutMs() { return this.deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS }
  private now() { return this.deps.now?.() ?? Date.now() }

  private async acquire(): Promise<void> {
    if (this.semaphoreCount < this.maxParallel()) {
      this.semaphoreCount += 1
      return
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    this.semaphoreCount += 1
  }
  private release(): void {
    this.semaphoreCount -= 1
    const next = this.queue.shift()
    next?.()
  }

  async runMentionsForUserMessage(args: {
    chatId: string
    userMessageId: string
    mentions: ParsedMention[]
  }): Promise<void> {
    const subagents = this.deps.appSettings.snapshot().subagents
    const resolved: { mention: Extract<ParsedMention, { kind: "subagent" }>; subagent: Subagent }[] = []
    for (const mention of args.mentions) {
      if (mention.kind === "unknown-subagent") {
        const runId = crypto.randomUUID()
        await this.deps.store.appendSubagentEvent({
          v: 3, type: "subagent_run_started", timestamp: this.now(), chatId: args.chatId, runId,
          subagentId: "", subagentName: mention.name, provider: "claude", model: "",
          parentUserMessageId: args.userMessageId, parentRunId: null, depth: 0,
        })
        await this.failRun(args.chatId, runId, "UNKNOWN_SUBAGENT", `Unknown subagent '${mention.name}'`)
        continue
      }
      const subagent = subagents.find((s) => s.id === mention.subagentId)
      if (!subagent) {
        const runId = crypto.randomUUID()
        await this.deps.store.appendSubagentEvent({
          v: 3, type: "subagent_run_started", timestamp: this.now(), chatId: args.chatId, runId,
          subagentId: mention.subagentId, subagentName: mention.subagentId, provider: "claude", model: "",
          parentUserMessageId: args.userMessageId, parentRunId: null, depth: 0,
        })
        await this.failRun(args.chatId, runId, "UNKNOWN_SUBAGENT", `Subagent ${mention.subagentId} was deleted`)
        continue
      }
      resolved.push({ mention, subagent })
    }

    await Promise.all(resolved.map(({ subagent }) =>
      this.spawnRun({
        subagent,
        chatId: args.chatId,
        parentUserMessageId: args.userMessageId,
        parentRunId: null,
        depth: 0,
        ancestorSubagentIds: [],
      })
    ))
  }

  private async spawnRun(args: {
    subagent: Subagent
    chatId: string
    parentUserMessageId: string
    parentRunId: string | null
    depth: number
    ancestorSubagentIds: string[]
  }): Promise<void> {
    const runId = crypto.randomUUID()
    await this.deps.store.appendSubagentEvent({
      v: 3, type: "subagent_run_started", timestamp: this.now(), chatId: args.chatId, runId,
      subagentId: args.subagent.id, subagentName: args.subagent.name,
      provider: args.subagent.provider, model: args.subagent.model,
      parentUserMessageId: args.parentUserMessageId, parentRunId: args.parentRunId, depth: args.depth,
    })

    await this.acquire()
    try {
      const transcript = this.deps.store.getMessages(args.chatId) as TranscriptEntry[]
      const primer = args.subagent.contextScope === "full-transcript"
        ? buildHistoryPrimer(transcript, args.subagent.provider, "")
        : (() => {
            const reply = extractPreviousAssistantReply(transcript)
            return reply == null ? null : `Previous assistant reply:\n${reply}`
          })()

      const runStart = this.deps.startProviderRun({ subagent: args.subagent, chatId: args.chatId, primer })

      if (!(await runStart.authReady())) {
        await this.failRun(args.chatId, runId, "AUTH_REQUIRED", `Authentication required for ${args.subagent.provider}`)
        return
      }

      let finalText = ""
      let usage: { inputTokens?: number; outputTokens?: number } | undefined
      try {
        const result = await Promise.race([
          runStart.start(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), this.timeoutMs())),
        ])
        finalText = result.text
        usage = result.usage
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === "TIMEOUT") {
          await this.failRun(args.chatId, runId, "TIMEOUT", `Run exceeded ${this.timeoutMs()}ms`)
        } else {
          await this.failRun(args.chatId, runId, "PROVIDER_ERROR", message)
        }
        return
      }

      await this.deps.store.appendSubagentEvent({
        v: 3, type: "subagent_run_completed", timestamp: this.now(), chatId: args.chatId, runId,
        finalContent: finalText,
        usage,
      })

      // Chain
      const chainedMentions = parseMentions(finalText, this.deps.appSettings.snapshot().subagents)
      for (const mention of chainedMentions) {
        if (mention.kind !== "subagent") continue
        const chainSubagent = this.deps.appSettings.snapshot().subagents.find((s) => s.id === mention.subagentId)
        if (!chainSubagent) continue
        const childDepth = args.depth + 1
        if (childDepth > this.maxDepth()) {
          const childRunId = crypto.randomUUID()
          await this.deps.store.appendSubagentEvent({
            v: 3, type: "subagent_run_started", timestamp: this.now(), chatId: args.chatId, runId: childRunId,
            subagentId: chainSubagent.id, subagentName: chainSubagent.name,
            provider: chainSubagent.provider, model: chainSubagent.model,
            parentUserMessageId: args.parentUserMessageId, parentRunId: runId, depth: childDepth,
          })
          await this.failRun(args.chatId, childRunId, "DEPTH_EXCEEDED", `Chain depth ${childDepth} exceeds limit ${this.maxDepth()}`)
          continue
        }
        if ([...args.ancestorSubagentIds, args.subagent.id].includes(chainSubagent.id)) {
          const childRunId = crypto.randomUUID()
          await this.deps.store.appendSubagentEvent({
            v: 3, type: "subagent_run_started", timestamp: this.now(), chatId: args.chatId, runId: childRunId,
            subagentId: chainSubagent.id, subagentName: chainSubagent.name,
            provider: chainSubagent.provider, model: chainSubagent.model,
            parentUserMessageId: args.parentUserMessageId, parentRunId: runId, depth: childDepth,
          })
          await this.failRun(args.chatId, childRunId, "LOOP_DETECTED", `Subagent ${chainSubagent.name} already in ancestor chain`)
          continue
        }
        await this.spawnRun({
          subagent: chainSubagent,
          chatId: args.chatId,
          parentUserMessageId: args.parentUserMessageId,
          parentRunId: runId,
          depth: childDepth,
          ancestorSubagentIds: [...args.ancestorSubagentIds, args.subagent.id],
        })
      }
    } finally {
      this.release()
    }
  }

  private async failRun(chatId: string, runId: string, code: SubagentErrorCode, message: string) {
    await this.deps.store.appendSubagentEvent({
      v: 3, type: "subagent_run_failed", timestamp: this.now(), chatId, runId,
      error: { code, message },
    })
  }
}
```

`getMessages` already exists on `EventStore` (it's read by the read-models projection). If named differently, adapt.

- [ ] **Step 4: Run tests, iterate to green**

Run: `bun test src/server/subagent-orchestrator.test.ts 2>&1 | tail -20`
Expected: harness scaffolding + assertions pass. Fix any orchestrator bug surfaced by the tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/subagent-orchestrator.ts src/server/subagent-orchestrator.test.ts
git commit -m "feat(subagent-orchestrator): fan-out + chain + error surface"
```

---

## Task 7 — Wire orchestrator into send flow

**Files:**
- Modify: `src/server/agent.ts:1441-1505` (send())

- [ ] **Step 1: Construct orchestrator in agent ctor**

In `Agent`'s constructor, after `appSettings` and `store` are stashed:

```ts
this.subagentOrchestrator = new SubagentOrchestrator({
  store: this.store,
  appSettings: this.appSettings,
  startProviderRun: ({ subagent, chatId, primer }) => buildSubagentProviderRun({
    subagent, chatId, primer,
    claudeStartFn: this.startClaudeSessionFn,
    codexManager: this.codexManager,
  }),
})
```

`buildSubagentProviderRun` is a helper to be defined alongside the orchestrator that converts a subagent + primer into a `ProviderRunStart`. It must:
- For `claude`: spawn an ephemeral session via `startClaudeSessionFn` with `subagent.systemPrompt` as system; collect assistant text; close session; return final text.
- For `codex`: similar, via `codexManager.startSession` + `startTurn`.
- `authReady()`: query existing auth check (`this.appSettings.snapshot().claudeAuth` / `auth` for codex).

Implement `buildSubagentProviderRun` in `subagent-orchestrator.ts` (export it). Each provider call must use the subagent's own model + options — NOT the chat's. Sessions are isolated: do not write back to `chat.sessionTokensByProvider`.

- [ ] **Step 2: Gate primary turn in `send()`**

Replace lines 1469-1496 in `agent.ts`:

```ts
const chat = this.store.requireChat(chatId)
const subagents = this.appSettings.snapshot().subagents
const parsedMentions = parseMentions(command.content, subagents)
const resolvedMentions = parsedMentions.filter((m) => m.kind === "subagent")

// Append user message with envelope (existing — done in Task 6 of Phase 2)
await this.appendUserPromptMessage(chatId, command.content, command.attachments ?? [], parsedMentions)

if (resolvedMentions.length > 0) {
  // Subagent fan-out — primary does NOT fire
  await this.subagentOrchestrator.runMentionsForUserMessage({
    chatId,
    userMessageId: this.getLastUserMessageId(chatId),
    mentions: parsedMentions,
  })
  return { chatId }
}

if (this.activeTurns.has(chatId)) {
  // ... existing queue path (unchanged)
}

// Phase 1 primary path (unchanged)
const provider = this.resolveProvider(command, chat.provider)
const settings = this.getProviderSettings(provider, command)
await this.startTurnForChat({ /* ... */ })
return { chatId }
```

`appendUserPromptMessage` is whatever helper currently exists in `agent.ts` for the user-prompt insert; if not factored out, factor it now. Its job: build the `UserPromptEntry`, then call `store.appendMessage(chatId, entry, { subagentMentions, unknownSubagentMentions })`.

`getLastUserMessageId` returns the `_id` of the just-appended entry. If no helper exists, capture the id at append-time and pass it through.

- [ ] **Step 3: Test gating in agent**

Add to `src/server/agent.test.ts`:

```ts
test("send with resolved @agent/ mention does NOT start primary turn", async () => {
  const harness = await setupAgent({ subagents: [makeSubagent({ id: "sa-1", name: "alpha" })] })
  const primaryStart = harness.spyOnStartTurn()
  await harness.agent.send({ type: "chat.send", chatId: "c1", content: "hi @agent/alpha", provider: "claude" })
  expect(primaryStart).not.toHaveBeenCalled()
  const runs = Object.values(harness.store.getSubagentRuns("c1"))
  expect(runs).toHaveLength(1)
})

test("send with no mentions starts primary turn as before", async () => {
  const harness = await setupAgent({ subagents: [] })
  const primaryStart = harness.spyOnStartTurn()
  await harness.agent.send({ type: "chat.send", chatId: "c1", content: "hi there", provider: "claude" })
  expect(primaryStart).toHaveBeenCalled()
})

test("send with only unknown-subagent mentions still skips primary", async () => {
  const harness = await setupAgent({ subagents: [] })
  const primaryStart = harness.spyOnStartTurn()
  await harness.agent.send({ type: "chat.send", chatId: "c1", content: "hi @agent/nobody", provider: "claude" })
  // Spec: orchestrator only fires for kind:"subagent". unknown still triggers a failed run but no primary turn? Per phase-3 spec: "primary does NOT fire" applies to any @agent/ mention. Confirm with code path; if unknown alone should trigger primary, adjust the test.
})
```

Re-read the phase 3 spec for the exact gating rule. Spec text (§ Send-flow integration):

```
if parsed.subagents.length > 0:
   orchestrator.runMentionsForUserMessage(...)
   primary does NOT fire
```

`parsed.subagents` = resolved-only. So unknown-only triggers an `UNKNOWN_SUBAGENT` failure event AND the primary turn fires. Update the gating in Step 2: check `resolvedMentions.length > 0`, but still run the orchestrator for unknown emissions even when primary fires:

```ts
const unknownMentions = parsedMentions.filter((m) => m.kind === "unknown-subagent")
if (unknownMentions.length > 0 && resolvedMentions.length === 0) {
  // Surface UNKNOWN_SUBAGENT failures, but proceed to primary turn
  await this.subagentOrchestrator.runMentionsForUserMessage({
    chatId, userMessageId: this.getLastUserMessageId(chatId), mentions: parsedMentions,
  })
}
if (resolvedMentions.length > 0) {
  await this.subagentOrchestrator.runMentionsForUserMessage({ /* ... */ })
  return { chatId }
}
// fall through to primary path
```

Adjust the third test above to assert: primary IS called AND an UNKNOWN_SUBAGENT failed run exists.

- [ ] **Step 4: Run tests**

Run: `bun test src/server/agent.test.ts src/server/subagent-orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/agent.ts src/server/agent.test.ts src/server/subagent-orchestrator.ts
git commit -m "feat(agent): route resolved @agent/ mentions to orchestrator"
```

---

## Task 8 — `SubagentMessage` UI component

**Files:**
- Create: `src/client/components/messages/SubagentMessage.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Bot } from "lucide-react"
import type { SubagentRunSnapshot } from "../../../shared/types"
import { cn } from "../../lib/utils"
import { SubagentErrorCard } from "./SubagentErrorCard"

interface SubagentMessageProps {
  run: SubagentRunSnapshot
  indentDepth: number
}

export function SubagentMessage({ run, indentDepth }: SubagentMessageProps) {
  return (
    <div
      data-testid={`subagent-message:${run.runId}`}
      className={cn("border-l-2 border-accent pl-3 py-2")}
      style={{ marginLeft: `${indentDepth * 24}px` }}
    >
      <header className="flex items-center gap-2 text-xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5" />
        <span>{run.subagentName}</span>
        <span className="opacity-60">{run.provider}/{run.model}</span>
        {run.status === "running" && <span className="ml-auto inline-block animate-pulse">streaming…</span>}
      </header>
      {run.finalText && (
        <div className="mt-1 whitespace-pre-wrap text-sm">{run.finalText}</div>
      )}
      {run.status === "failed" && run.error && (
        <div className="mt-2">
          <SubagentErrorCard error={run.error} runId={run.runId} subagentId={run.subagentId} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/components/messages/SubagentMessage.tsx
git commit -m "feat(messages): SubagentMessage component"
```

---

## Task 9 — `SubagentErrorCard` UI

**Files:**
- Create: `src/client/components/messages/SubagentErrorCard.tsx`

- [ ] **Step 1: Implement**

```tsx
import { AlertTriangle, KeyRound, RotateCw } from "lucide-react"
import type { SubagentErrorCode } from "../../../shared/types"

interface SubagentErrorCardProps {
  error: { code: SubagentErrorCode; message: string }
  runId: string
  subagentId: string
  onRetry?: () => void
  onOpenSettings?: () => void
}

function badgeText(code: SubagentErrorCode) {
  switch (code) {
    case "AUTH_REQUIRED": return "Auth required"
    case "UNKNOWN_SUBAGENT": return "Unknown subagent"
    case "LOOP_DETECTED": return "Loop detected"
    case "DEPTH_EXCEEDED": return "Depth exceeded"
    case "TIMEOUT": return "Timeout"
    case "PROVIDER_ERROR": return "Provider error"
  }
}

export function SubagentErrorCard({ error, runId, subagentId, onRetry, onOpenSettings }: SubagentErrorCardProps) {
  const canRetry = error.code === "TIMEOUT" || error.code === "PROVIDER_ERROR"
  const canOpenSettings = error.code === "AUTH_REQUIRED"
  return (
    <div
      data-testid={`subagent-error:${runId}`}
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
    >
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span>{badgeText(error.code)}</span>
      </div>
      <p className="mt-1 text-foreground">{error.message}</p>
      <div className="mt-2 flex gap-2">
        {canOpenSettings && onOpenSettings && (
          <button onClick={onOpenSettings} className="inline-flex items-center gap-1 text-xs underline">
            <KeyRound className="h-3 w-3" /> Open settings
          </button>
        )}
        {canRetry && onRetry && (
          <button onClick={onRetry} className="inline-flex items-center gap-1 text-xs underline">
            <RotateCw className="h-3 w-3" /> Retry
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/components/messages/SubagentErrorCard.tsx
git commit -m "feat(messages): SubagentErrorCard component"
```

---

## Task 10 — Render runs in `KannaTranscript`

**Files:**
- Modify: `src/client/app/KannaTranscript.tsx`
- Modify: `src/client/app/KannaTranscript.test.tsx`

- [ ] **Step 1: Read runs from snapshot**

Find where `KannaTranscript` receives `ChatSnapshot` (search the imports and use of `messages`). Add:

```tsx
const subagentRuns = chat?.subagentRuns ?? {}
```

- [ ] **Step 2: Group runs by `parentUserMessageId`**

Add a `useMemo` that builds a `Map<userMessageId, SubagentRunSnapshot[]>`. Sort each group by `startedAt` asc, `runId` asc (tiebreak):

```ts
const runsByUserMessageId = useMemo(() => {
  const grouped = new Map<string, SubagentRunSnapshot[]>()
  for (const run of Object.values(subagentRuns)) {
    if (run.parentRunId !== null) continue  // children rendered separately under parent
    const list = grouped.get(run.parentUserMessageId) ?? []
    list.push(run)
    grouped.set(run.parentUserMessageId, list)
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId))
  }
  return grouped
}, [subagentRuns])

const childrenByParentRunId = useMemo(() => {
  const map = new Map<string, SubagentRunSnapshot[]>()
  for (const run of Object.values(subagentRuns)) {
    if (run.parentRunId === null) continue
    const list = map.get(run.parentRunId) ?? []
    list.push(run)
    map.set(run.parentRunId, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId))
  }
  return map
}, [subagentRuns])
```

- [ ] **Step 3: Insert `SubagentMessage` rows in render loop**

In the message iteration loop, after rendering each user message row, render its associated subagent runs (and recursively children):

```tsx
function renderRunTree(run: SubagentRunSnapshot, depth: number): React.ReactNode {
  const children = childrenByParentRunId.get(run.runId) ?? []
  return (
    <React.Fragment key={run.runId}>
      <SubagentMessage run={run} indentDepth={depth} />
      {children.map((child) => renderRunTree(child, depth + 1))}
    </React.Fragment>
  )
}

// In the row map, after a `kind: "user_prompt"` row:
{message.kind === "user_prompt" && runsByUserMessageId.get(message._id)?.map((run) => renderRunTree(run, 0))}
```

- [ ] **Step 4: Tests**

Add to `src/client/app/KannaTranscript.test.tsx`:

```tsx
test("renders subagent run rows under triggering user message", () => {
  const { container } = render(
    <KannaTranscript
      // ... existing fixture
      chat={{
        messages: [{ _id: "u1", kind: "user_prompt", content: "@agent/alpha", createdAt: 1 }],
        subagentRuns: {
          r1: { runId: "r1", chatId: "c1", subagentId: "sa-1", subagentName: "alpha", provider: "claude", model: "x", status: "completed", parentUserMessageId: "u1", parentRunId: null, depth: 0, startedAt: 2, finishedAt: 3, finalText: "done", error: null, usage: null },
        },
        // ... rest of ChatSnapshot fixture
      } as any}
    />
  )
  expect(container.querySelector('[data-testid="subagent-message:r1"]')).not.toBeNull()
})

test("renders chained runs indented under parent", () => {
  const { container } = render(
    <KannaTranscript
      chat={{
        messages: [{ _id: "u1", kind: "user_prompt", content: "@agent/alpha", createdAt: 1 }],
        subagentRuns: {
          r1: { runId: "r1", parentRunId: null, parentUserMessageId: "u1", depth: 0, status: "completed", subagentId: "a", subagentName: "alpha", provider: "claude", model: "x", chatId: "c1", startedAt: 2, finishedAt: 3, finalText: "@agent/beta", error: null, usage: null },
          r2: { runId: "r2", parentRunId: "r1", parentUserMessageId: "u1", depth: 1, status: "completed", subagentId: "b", subagentName: "beta", provider: "claude", model: "x", chatId: "c1", startedAt: 4, finishedAt: 5, finalText: "child", error: null, usage: null },
        },
      } as any}
    />
  )
  const child = container.querySelector('[data-testid="subagent-message:r2"]') as HTMLElement
  expect(child).not.toBeNull()
  expect(child.style.marginLeft).toBe("24px")
})

test("renders error card for failed run with retry on TIMEOUT", () => {
  const { container } = render(
    <KannaTranscript
      chat={{
        messages: [{ _id: "u1", kind: "user_prompt", content: "@agent/alpha", createdAt: 1 }],
        subagentRuns: {
          r1: { runId: "r1", parentRunId: null, parentUserMessageId: "u1", depth: 0, status: "failed", subagentId: "a", subagentName: "alpha", provider: "claude", model: "x", chatId: "c1", startedAt: 2, finishedAt: 3, finalText: null, error: { code: "TIMEOUT", message: "took too long" }, usage: null },
        },
      } as any}
    />
  )
  expect(container.querySelector('[data-testid="subagent-error:r1"]')).not.toBeNull()
})
```

- [ ] **Step 5: Run tests**

Run: `bun test src/client/app/KannaTranscript.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/app/KannaTranscript.tsx src/client/app/KannaTranscript.test.tsx
git commit -m "feat(transcript): render subagent runs grouped + chained"
```

---

## Task 11 — Composer gating regression test

**Files:**
- Modify: `src/client/components/chat-ui/ChatInput.test.tsx`

- [ ] **Step 1: Add gating tests**

```tsx
test("plain text behaves as phase 1 (sends normally)", async () => {
  const { sendSpy } = renderChatInput({ subagents: [] })
  await typeAndSubmit("hello")
  expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ content: "hello" }))
})

test("@agent/<name> in text still emits chat.send (gating happens server-side)", async () => {
  const { sendSpy } = renderChatInput({ subagents: [{ id: "sa-1", name: "alpha", /* ... */ }] })
  await typeAndSubmit("@agent/alpha please review")
  expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ content: "@agent/alpha please review" }))
})
```

Server-side gating is verified by Task 7's agent tests; client-side, the composer just submits text.

- [ ] **Step 2: Run tests**

Run: `bun test src/client/components/chat-ui/ChatInput.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/chat-ui/ChatInput.test.tsx
git commit -m "test(chat-input): mention gating round-trips"
```

---

## Task 12 — Streaming live updates

**Files:**
- Modify: `src/server/subagent-orchestrator.ts` (emit `subagent_message_delta` while streaming)
- Modify: provider-run helper

- [ ] **Step 1: Stream deltas from provider into events**

In `buildSubagentProviderRun`, the provider session yields incremental chunks (Claude `assistant` SDK frames, Codex deltas). For each chunk:

```ts
await store.appendSubagentEvent({
  v: 3, type: "subagent_message_delta", timestamp: Date.now(), chatId, runId, content: chunkText,
})
```

The orchestrator already commits a `subagent_run_completed` event with the final aggregate `finalContent` once streaming finishes. The reducer (Task 3) handles concatenation for deltas and overwrite-with-final for completion.

- [ ] **Step 2: Manual smoke test**

Run: `bun run dev`. Create a Claude subagent. Send `@agent/alpha summarize this conversation`. Observe the SubagentMessage row streaming text incrementally, then settling on final.

- [ ] **Step 3: Commit**

```bash
git add src/server/subagent-orchestrator.ts
git commit -m "feat(subagent-orchestrator): stream deltas live"
```

---

## Task 13 — Full sweep + PR

**Files:** (none)

- [ ] **Step 1: Full tests**

Run: `bun test 2>&1 | tail -30`
Expected: ALL PASS.

- [ ] **Step 2: Typecheck**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin plans/model-independent-chat-phase3
gh pr create --repo cuongtranba/kanna --base main --head plans/model-independent-chat-phase3 --title "feat: phase 3 subagent orchestration + UI" --body "$(cat <<'EOF'
## Summary
- SubagentOrchestrator with parallel fan-out (cap 4), depth-1 chains, loop detection
- 5 new durable events (subagent_run_*) reduced into subagentRuns map
- Agent.send routes resolved @agent/ mentions to orchestrator; primary turn gated
- SubagentMessage + SubagentErrorCard render runs grouped by user message; chained runs indented
- Provider sessions are isolated (no read/write to chat.sessionTokensByProvider)

## Test plan
- [ ] bun test
- [ ] Send `@agent/alpha` — see streaming reply, no primary turn fires
- [ ] Send `@agent/alpha @agent/beta` — see parallel siblings under same user message
- [ ] Build alpha that mentions @agent/beta, beta mentions @agent/alpha — LOOP_DETECTED card
- [ ] Send `@agent/missing` only — primary turn fires, UNKNOWN_SUBAGENT failure card shown
EOF
)"
```

---

## Open follow-ups (not v1)

- Per-subagent persistent session token caching (currently isolated per run).
- Fan-out + primary synthesis (combine sibling outputs back into a primary reply).
- `MAX_CHAIN_DEPTH=2` opt-in for advanced flows.
- Retry button on error card actually triggers a new run (currently UI only).

---

## Self-review checklist

- [ ] `STORE_VERSION` unchanged.
- [ ] Provider sessions inside orchestrator do NOT read or write `chat.sessionTokensByProvider`.
- [ ] `subagentName` snapshotted at `subagent_run_started` emission — survives rename.
- [ ] `parentRunId === null` runs render flat; chained runs render indented.
- [ ] Sibling ordering: `startedAt` asc, `runId` asc tiebreak.
- [ ] `MAX_PARALLEL = 4`, `MAX_CHAIN_DEPTH = 1`, `RUN_TIMEOUT_MS = 120_000`.
- [ ] `UNKNOWN_SUBAGENT` failures emit a started+failed pair so the UI can render the error card.
- [ ] Resolved mention gates primary turn; unknown-only does not.
- [ ] `bun test` and `bun run check` pass.
