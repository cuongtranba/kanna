# Phase 5 — Interactive Tools + Payload Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the phase-4 auto-deny stub in
`agent.ts:1646-1681` with real `AskUserQuestion`/`ExitPlanMode`
forwarding to the parent chat's UI, and add claude-code-style
persist-to-disk payload cap (50 KB threshold, 2 KB preview) for
`subagent_entry_appended` events so `turns.jsonl` stays bounded.

**Architecture:** Add two durable events
(`subagent_tool_pending`, `subagent_tool_resolved`) and an in-memory
`Map` of Promise resolvers keyed by `chatId::runId::toolUseId` on
`AgentCoordinator`. The orchestrator's wall-clock timeout becomes a
sliding window that pauses while a tool is pending. The
`appendSubagentEvent` path gains a `capTranscriptEntry` pre-step that
writes large `tool_result` contents to
`<kannaRoot>/projects/<projectId>/chats/<chatId>/subagent-results/<runId>/<toolUseId>.<ext>`
and rewrites the event's entry to carry only a 2 KB preview plus a
`persisted` flag. Client renders a new `SubagentPendingToolCard`
inside `SubagentMessage`, reusing existing
`AskUserQuestionMessage`/`ExitPlanModeMessage` components.

**Tech Stack:** TypeScript, Bun, React 19, Zustand, bun:test, JSONL
event log, Claude SDK (`@anthropic-ai/claude-agent-sdk`), Codex CLI
app-server.

**Source spec:**
`docs/superpowers/specs/2026-05-14-model-independent-chat-phase5-interactive-tools-payload-cap-design.md`
(commit `49aed2d`).

**Baseline:** Phase 4 merged (commit `52d22ce`, PR #86). Branch
`plans/model-independent-chat-phase5` off the phase 4 tip on `main`.
Verify `bun test` passes locally before starting.

---

## File Structure

**Server (modify):**
- `src/server/agent.ts` — replace auto-deny in
  `buildSubagentProviderRunForChat` (1646-1681); add
  `subagentPendingResolvers` map; add `chat.respondSubagentTool`
  command handler.
- `src/server/events.ts` — add two event variants to
  `SubagentRunEvent` (lines 281-335).
- `src/server/event-store.ts` — add replay-priority cases (line 136);
  add reducers in switch block (line 808+); wire `capTranscriptEntry`
  into `appendSubagentEvent` (line 1501); add restart-recovery loop;
  add `subagent-results` cleanup on chat delete.
- `src/server/subagent-orchestrator.ts` — sliding-window timeout pause
  via a controllable `TimeoutHandle` that listens for pending/resolved
  events.
- `src/shared/types.ts` — `SubagentPendingTool` type; extend
  `SubagentRunSnapshot` with `pendingTool`; extend `ToolResultEntry`
  with `persisted` field; add `"INTERRUPTED"` to `SubagentErrorCode`.
- `src/shared/protocol.ts` — add
  `chat.respondSubagentTool` client command shape (line 240 area).

**Server (new):**
- `src/server/subagent-entry-cap.ts` — disk-spill module
  (`capTranscriptEntry` function).
- `src/server/subagent-entry-cap.test.ts` — unit tests.

**Client (modify):**
- `src/client/components/messages/SubagentMessage.tsx` — render
  `SubagentPendingToolCard` when `run.pendingTool != null`.
- `src/client/components/messages/SubagentMessage.test.tsx` — extend
  with pending-card rendering + persisted-tool_result tests.
- `src/client/components/messages/SubagentEntryRow.tsx` — branch on
  `entry.persisted` for "View full output" affordance.
- `src/client/app/KannaTranscript.tsx` — thread
  `onSubagentToolSubmit` callback to `SubagentMessage`.

**Client (new):**
- `src/client/components/messages/SubagentPendingToolCard.tsx`.

---

## Task 1 — Type additions

**Files:**
- Modify: `src/shared/types.ts:858-863` (`ToolResultEntry`)
- Modify: `src/shared/types.ts:1300-1306` (`SubagentErrorCode`)
- Modify: `src/shared/types.ts:1317-1341` (`SubagentRunSnapshot`)

- [ ] **Step 1: Add `SubagentPendingTool` type**

In `src/shared/types.ts`, immediately before `export interface
SubagentRunSnapshot` (around line 1317), add:

```ts
export interface SubagentPendingTool {
  toolUseId: string
  toolKind: "ask_user_question" | "exit_plan_mode"
  input: unknown
  requestedAt: number
}
```

- [ ] **Step 2: Extend `SubagentRunSnapshot`**

In `src/shared/types.ts` inside `SubagentRunSnapshot` (after the
`entries: TranscriptEntry[]` field, line 1340), add:

```ts
  /**
   * Set while the subagent is awaiting a user response to an
   * interactive tool call (AskUserQuestion / ExitPlanMode). Null
   * otherwise. The orchestrator's wall-clock timeout is paused while
   * this is non-null.
   */
  pendingTool: SubagentPendingTool | null
```

- [ ] **Step 3: Extend `SubagentErrorCode`**

In `src/shared/types.ts:1300-1306`, add `"INTERRUPTED"`:

```ts
export type SubagentErrorCode =
  | "AUTH_REQUIRED"
  | "UNKNOWN_SUBAGENT"
  | "LOOP_DETECTED"
  | "DEPTH_EXCEEDED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INTERRUPTED"
```

- [ ] **Step 4: Extend `ToolResultEntry`**

In `src/shared/types.ts:858-863`, add optional `persisted` field:

```ts
export interface ToolResultEntry extends TranscriptEntryBase {
  kind: "tool_result"
  toolId: string
  content: unknown
  isError?: boolean
  /**
   * Set when the original content exceeded the subagent payload cap
   * (50 KB) and the full content was written to disk. `content` then
   * carries only a 2 KB preview wrapped in <persisted-output> tags.
   */
  persisted?: {
    filepath: string
    originalSize: number
    isJson: boolean
    truncated: true
  }
}
```

- [ ] **Step 5: Run typecheck**

```bash
bun run check
```

Expected: existing reducers and snapshot constructors now fail to
compile because they don't initialise `pendingTool`. That's
intentional — Task 2 fixes them.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(subagent): add SubagentPendingTool + INTERRUPTED + ToolResultEntry.persisted"
```

---

## Task 2 — Initialise `pendingTool` in reducer

**Files:**
- Modify: `src/server/event-store.ts:811-828` (`subagent_run_started`
  reducer)

- [ ] **Step 1: Add `pendingTool: null` to constructor**

In `src/server/event-store.ts` inside the `subagent_run_started`
case, in the `map.set(e.runId, { ... })` literal (line 811), add
`pendingTool: null,` after `entries: [],`:

```ts
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
          entries: [],
          pendingTool: null,
        })
```

- [ ] **Step 2: Run typecheck**

```bash
bun run check
```

Expected: typecheck passes (or only fails on event union — that's
Task 3).

- [ ] **Step 3: Run server tests**

```bash
bun test src/server/event-store.test.ts
```

Expected: existing tests still pass; `pendingTool` is the new
property but no test asserts on it yet.

- [ ] **Step 4: Commit**

```bash
git add src/server/event-store.ts
git commit -m "chore(event-store): initialise pendingTool=null on subagent_run_started"
```

---

## Task 3 — Add `subagent_tool_pending` / `subagent_tool_resolved` events

**Files:**
- Modify: `src/server/events.ts:281-335` (`SubagentRunEvent` union)
- Modify: `src/server/event-store.ts:136-141` (replay priority)

- [ ] **Step 1: Add two event variants to the union**

In `src/server/events.ts`, append two cases to `SubagentRunEvent`
(after the existing `subagent_entry_appended` variant, around line
335). Result:

```ts
export type SubagentRunEvent =
  | { /* subagent_run_started */ }
  | { /* subagent_message_delta */ }
  | { /* subagent_run_completed */ }
  | { /* subagent_run_failed */ }
  | { /* subagent_run_cancelled */ }
  | { /* subagent_entry_appended */ }
  | {
      v: 3
      type: "subagent_tool_pending"
      timestamp: number
      chatId: string
      runId: string
      toolUseId: string
      toolKind: "ask_user_question" | "exit_plan_mode"
      input: unknown
    }
  | {
      v: 3
      type: "subagent_tool_resolved"
      timestamp: number
      chatId: string
      runId: string
      toolUseId: string
      result: unknown
      resolution: "user" | "auto_deny" | "interrupted"
    }
```

Do NOT edit the existing variants — append only.

- [ ] **Step 2: Add replay-priority cases**

In `src/server/event-store.ts:136-141` add the two new event types to
the same `subagent_*` priority block:

```ts
    case "subagent_run_started":
    case "subagent_message_delta":
    case "subagent_entry_appended":
    case "subagent_run_completed":
    case "subagent_run_failed":
    case "subagent_run_cancelled":
    case "subagent_tool_pending":
    case "subagent_tool_resolved":
```

Find the exact priority number used by the existing subagent cases
and assign the same priority to both new cases (look at the lines
immediately around 136 — the existing block returns one priority
number).

- [ ] **Step 3: Run typecheck**

```bash
bun run check
```

Expected: switch statements in `applyReducer` flag the two new
variants as unhandled — that's intentional, Task 4 fixes the
reducer.

- [ ] **Step 4: Commit**

```bash
git add src/server/events.ts src/server/event-store.ts
git commit -m "feat(events): add subagent_tool_pending / subagent_tool_resolved variants"
```

---

## Task 4 — Reducers for tool_pending / tool_resolved

**Files:**
- Modify: `src/server/event-store.ts:879-887` (after
  `subagent_run_cancelled` case)
- Test: `src/server/event-store.test.ts`

- [ ] **Step 1: Write failing test**

Open `src/server/event-store.test.ts` and append a new test (locate
the end of the existing `describe("EventStore subagent ...")` block
if present, else add a new `describe`):

```ts
import { describe, expect, test } from "bun:test"
// ...existing imports...

describe("EventStore subagent tool pending/resolved", () => {
  test("subagent_tool_pending sets pendingTool on the run", async () => {
    const { store, chatId, runId } = await seedRunningSubagent()
    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_tool_pending",
      timestamp: 1700000000000,
      chatId,
      runId,
      toolUseId: "tool-1",
      toolKind: "ask_user_question",
      input: { questions: [{ id: "q1", question: "ok?" }] },
    })
    const run = store.getSubagentRuns(chatId)[runId]
    expect(run.pendingTool).toEqual({
      toolUseId: "tool-1",
      toolKind: "ask_user_question",
      input: { questions: [{ id: "q1", question: "ok?" }] },
      requestedAt: 1700000000000,
    })
  })

  test("subagent_tool_resolved clears pendingTool and appends synthetic tool_result", async () => {
    const { store, chatId, runId } = await seedRunningSubagent()
    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_tool_pending",
      timestamp: 1700000000000,
      chatId,
      runId,
      toolUseId: "tool-2",
      toolKind: "exit_plan_mode",
      input: {},
    })
    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_tool_resolved",
      timestamp: 1700000000500,
      chatId,
      runId,
      toolUseId: "tool-2",
      result: { confirmed: true },
      resolution: "user",
    })
    const run = store.getSubagentRuns(chatId)[runId]
    expect(run.pendingTool).toBeNull()
    const last = run.entries[run.entries.length - 1]
    expect(last.kind).toBe("tool_result")
    expect((last as { toolId: string }).toolId).toBe("tool-2")
    expect((last as { content: unknown }).content).toEqual({ confirmed: true })
  })
})

// Helper — define above the describe block, or in a shared test util:
async function seedRunningSubagent(): Promise<{
  store: import("../../src/server/event-store").EventStore
  chatId: string
  runId: string
}> {
  // Use the same in-memory bootstrap pattern existing tests use:
  // create temp dir, mkdir, instantiate EventStore, seed a project +
  // chat + subagent_run_started. Mirror an existing test's setup.
  throw new Error("seedRunningSubagent helper not yet implemented")
}
```

Replace `seedRunningSubagent` with the existing helper used by phase
3/4 subagent reducer tests (`src/server/event-store.test.ts` already
has one — locate by `grep -n "subagent_run_started" src/server/event-store.test.ts`
and copy the setup steps).

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/server/event-store.test.ts -t "subagent tool pending/resolved"
```

Expected: FAIL with "Cannot read … pendingTool" or "tool-2 not found
in entries" or similar.

- [ ] **Step 3: Add reducers**

In `src/server/event-store.ts`, locate the `subagent_run_cancelled`
case (around line 879) and append two new cases AFTER it (still
inside the same `switch (e.type)` block):

```ts
      case "subagent_tool_pending": {
        const map = this.state.subagentRunsByChatId.get(e.chatId)
        const run = map?.get(e.runId)
        if (!run) break
        run.pendingTool = {
          toolUseId: e.toolUseId,
          toolKind: e.toolKind,
          input: e.input,
          requestedAt: e.timestamp,
        }
        break
      }
      case "subagent_tool_resolved": {
        const map = this.state.subagentRunsByChatId.get(e.chatId)
        const run = map?.get(e.runId)
        if (!run) break
        run.pendingTool = null
        run.entries.push({
          kind: "tool_result",
          _id: `${e.runId}:${e.toolUseId}:resolved`,
          createdAt: e.timestamp,
          toolId: e.toolUseId,
          content: e.result,
        } as TranscriptEntry)
        break
      }
```

The `_id` and `createdAt` fields must match the `TranscriptEntryBase`
shape from `src/shared/types.ts:766`. Confirm via:

```bash
grep -n "interface TranscriptEntryBase" src/shared/types.ts
```

and copy the required fields.

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/server/event-store.test.ts -t "subagent tool pending/resolved"
```

Expected: PASS.

- [ ] **Step 5: Run the full event-store test file**

```bash
bun test src/server/event-store.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/event-store.ts src/server/event-store.test.ts
git commit -m "feat(event-store): reducers for subagent_tool_pending / subagent_tool_resolved"
```

---

## Task 5 — Protocol command `chat.respondSubagentTool`

**Files:**
- Modify: `src/shared/protocol.ts:240` (after `chat.respondTool`)

- [ ] **Step 1: Add command shape**

In `src/shared/protocol.ts` directly after the
`chat.respondTool` variant (line 240), add:

```ts
  | { type: "chat.respondSubagentTool"; chatId: string; runId: string; toolUseId: string; result: unknown }
```

- [ ] **Step 2: Run typecheck**

```bash
bun run check
```

Expected: typecheck passes (no handler exists yet; that's Task 8).

- [ ] **Step 3: Commit**

```bash
git add src/shared/protocol.ts
git commit -m "feat(protocol): add chat.respondSubagentTool command"
```

---

## Task 6 — `subagent-entry-cap` module

**Files:**
- Create: `src/server/subagent-entry-cap.ts`
- Create: `src/server/subagent-entry-cap.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/subagent-entry-cap.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { capTranscriptEntry, SUBAGENT_RESULT_THRESHOLD, PREVIEW_SIZE } from "./subagent-entry-cap"
import type { TranscriptEntry } from "../shared/types"

describe("capTranscriptEntry", () => {
  let kannaRoot: string

  beforeEach(async () => {
    kannaRoot = await mkdtemp(path.join(tmpdir(), "kanna-cap-test-"))
  })

  afterEach(async () => {
    await rm(kannaRoot, { recursive: true, force: true })
  })

  function makeEntry(content: unknown): TranscriptEntry {
    return {
      kind: "tool_result",
      _id: "test-entry",
      createdAt: 0,
      toolId: "tool-xyz",
      content,
    } as TranscriptEntry
  }

  test("passthrough non-tool_result entry", async () => {
    const entry: TranscriptEntry = {
      kind: "assistant_text",
      _id: "a",
      createdAt: 0,
      text: "hello",
    } as TranscriptEntry
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    expect(out).toBe(entry)
  })

  test("passthrough tool_result under threshold", async () => {
    const entry = makeEntry("hello world")
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    expect(out).toBe(entry)
    expect("persisted" in out).toBe(false)
  })

  test("persist tool_result over threshold (string content)", async () => {
    const big = "a".repeat(SUBAGENT_RESULT_THRESHOLD + 100)
    const entry = makeEntry(big)
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    expect(out).not.toBe(entry)
    const persisted = (out as { persisted?: { filepath: string; originalSize: number; isJson: boolean; truncated: true } }).persisted
    expect(persisted).toBeDefined()
    expect(persisted!.originalSize).toBe(big.length)
    expect(persisted!.isJson).toBe(false)
    expect(persisted!.truncated).toBe(true)
    expect(persisted!.filepath.endsWith("tool-xyz.txt")).toBe(true)
    const onDisk = await readFile(persisted!.filepath, "utf-8")
    expect(onDisk).toBe(big)
    const preview = (out as { content: string }).content
    expect(preview).toContain("<persisted-output>")
    expect(preview).toContain("Output too large")
    expect(preview.length).toBeLessThan(PREVIEW_SIZE + 1000)
  })

  test("persist tool_result over threshold (json array content)", async () => {
    const blocks = Array.from({ length: 1000 }, (_, i) => ({ type: "text", text: `line ${i}\n${"x".repeat(100)}` }))
    const entry = makeEntry(blocks)
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    const persisted = (out as { persisted?: { filepath: string; isJson: boolean } }).persisted
    expect(persisted).toBeDefined()
    expect(persisted!.isJson).toBe(true)
    expect(persisted!.filepath.endsWith("tool-xyz.json")).toBe(true)
  })

  test("idempotent: re-call with same toolUseId swallows EEXIST", async () => {
    const big = "z".repeat(SUBAGENT_RESULT_THRESHOLD + 1)
    const entry = makeEntry(big)
    const out1 = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    const out2 = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    expect((out1 as { persisted?: { filepath: string } }).persisted!.filepath)
      .toBe((out2 as { persisted?: { filepath: string } }).persisted!.filepath)
    const s = await stat((out1 as { persisted?: { filepath: string } }).persisted!.filepath)
    expect(s.size).toBe(big.length)
  })

  test("measures bytes not chars: multibyte content under threshold by chars but over by bytes is persisted", async () => {
    // 4-byte UTF-8 char (emoji) repeated. char count = 20_000, byte count = 80_000.
    // Threshold is 50_000 bytes — must persist.
    const emoji = "\u{1F4A9}" // 4 bytes in UTF-8
    const content = emoji.repeat(20_000)
    const entry = makeEntry(content)
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    const persisted = (out as { persisted?: { originalSize: number } }).persisted
    expect(persisted).toBeDefined()
    expect(persisted!.originalSize).toBe(Buffer.byteLength(content, "utf8"))
  })

  test("sanitizes toolId with path separators", async () => {
    const big = "a".repeat(SUBAGENT_RESULT_THRESHOLD + 1)
    const entry: TranscriptEntry = {
      kind: "tool_result",
      _id: "e1",
      createdAt: 0,
      toolId: "../../../etc/passwd",
      content: big,
    } as TranscriptEntry
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    const filepath = (out as { persisted?: { filepath: string } }).persisted!.filepath
    expect(filepath).toContain(path.join("subagent-results", "r1"))
    expect(filepath).not.toContain("..")
    expect(filepath).not.toContain("/etc/passwd")
    expect(path.basename(filepath)).toMatch(/^[A-Za-z0-9_-]+\.txt$/)
  })

  test("preview cuts at newline boundary within last 50% of limit", async () => {
    const head = "line\n".repeat(300)
    const tail = "z".repeat(SUBAGENT_RESULT_THRESHOLD)
    const entry = makeEntry(head + tail)
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    const content = (out as { content: string }).content
    const previewSection = content.slice(content.indexOf("Preview"))
    const previewBody = previewSection.split("\n").slice(1, -2).join("\n")
    expect(previewBody.endsWith("\n") || previewBody.endsWith("line")).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/server/subagent-entry-cap.test.ts
```

Expected: FAIL with "Cannot find module './subagent-entry-cap'".

- [ ] **Step 3: Implement the module**

Create `src/server/subagent-entry-cap.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TranscriptEntry, ToolResultEntry } from "../shared/types"

// Bytes (UTF-8), not chars. Matches claude-code's 50K char default in
// spirit but enforced precisely against the byte size we serialize.
export const SUBAGENT_RESULT_THRESHOLD = 50_000
export const PREVIEW_SIZE = 2000
const PERSISTED_OPEN_TAG = "<persisted-output>"
const PERSISTED_CLOSE_TAG = "</persisted-output>"

interface CapArgs {
  entry: TranscriptEntry
  chatId: string
  runId: string
  projectId: string
  kannaRoot: string
}

interface ContentSizeInfo {
  size: number
  isJson: boolean
  serialized: string
}

function measureContent(content: unknown): ContentSizeInfo | null {
  // Measure the BYTES we actually write to disk + ship through the
  // JSONL event log. Char length under-counts multibyte content, and
  // counting only text-block lengths while serializing the full array
  // (incl. image / tool_reference blocks) misses real payload size.
  if (typeof content === "string") {
    return {
      size: Buffer.byteLength(content, "utf8"),
      isJson: false,
      serialized: content,
    }
  }
  if (Array.isArray(content)) {
    const serialized = JSON.stringify(content, null, 2)
    return {
      size: Buffer.byteLength(serialized, "utf8"),
      isJson: true,
      serialized,
    }
  }
  return null
}

function safeBasename(toolId: string): string {
  // Tool IDs come from the SDK (typically UUID-ish) but defense-in-depth:
  // if anything ever supplies a path separator, `..`, or non-printable
  // char, the file write could escape `subagent-results/<runId>/`.
  // Strip to [A-Za-z0-9_-], collapse, cap length.
  const cleaned = toolId.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 200)
  return cleaned.length > 0 ? cleaned : "tool"
}

function buildPreview(serialized: string): { preview: string; hasMore: boolean } {
  if (serialized.length <= PREVIEW_SIZE) {
    return { preview: serialized, hasMore: false }
  }
  const slice = serialized.slice(0, PREVIEW_SIZE)
  const lastNewline = slice.lastIndexOf("\n")
  const cut = lastNewline > PREVIEW_SIZE * 0.5 ? lastNewline : PREVIEW_SIZE
  return { preview: serialized.slice(0, cut), hasMore: true }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function buildMessage(filepath: string, originalSize: number, preview: string, hasMore: boolean): string {
  let msg = `${PERSISTED_OPEN_TAG}\n`
  msg += `Output too large (${formatBytes(originalSize)}). Full output saved to: ${filepath}\n\n`
  msg += `Preview (first ${formatBytes(PREVIEW_SIZE)}):\n`
  msg += preview
  msg += hasMore ? "\n...\n" : "\n"
  msg += PERSISTED_CLOSE_TAG
  return msg
}

function dirFor(args: CapArgs): string {
  return path.join(
    args.kannaRoot, "projects", args.projectId, "chats", args.chatId,
    "subagent-results", args.runId,
  )
}

export async function capTranscriptEntry(args: CapArgs): Promise<TranscriptEntry> {
  if (args.entry.kind !== "tool_result") return args.entry
  const entry = args.entry as ToolResultEntry
  const info = measureContent(entry.content)
  if (!info || info.size <= SUBAGENT_RESULT_THRESHOLD) return entry

  const dir = dirFor(args)
  await mkdir(dir, { recursive: true })
  const ext = info.isJson ? "json" : "txt"
  const filepath = path.join(dir, `${safeBasename(entry.toolId)}.${ext}`)
  try {
    await writeFile(filepath, info.serialized, { encoding: "utf-8", flag: "wx" })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "EEXIST") throw err
  }
  const { preview, hasMore } = buildPreview(info.serialized)
  const message = buildMessage(filepath, info.size, preview, hasMore)
  return {
    ...entry,
    content: message,
    persisted: {
      filepath,
      originalSize: info.size,
      isJson: info.isJson,
      truncated: true,
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/server/subagent-entry-cap.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/subagent-entry-cap.ts src/server/subagent-entry-cap.test.ts
git commit -m "feat(subagent): payload cap module with 50KB threshold + 2KB preview"
```

---

## Task 7 — Wire cap into `appendSubagentEvent`

**Files:**
- Modify: `src/server/event-store.ts:1501-1503` (`appendSubagentEvent`)
- Modify: `src/server/event-store.ts` constructor / fields (find
  via grep)
- Test: `src/server/event-store.test.ts`

- [ ] **Step 1: Locate kannaRoot accessor**

Find how event-store currently resolves the kanna data root:

```bash
grep -n "dataDir\|getDataDir\|kannaRoot\|this\\.root" src/server/event-store.ts | head -20
```

Note the actual field/accessor name. The plan assumes
`this.dataDir` (string field) but use whatever the codebase already
exposes.

- [ ] **Step 2: Locate the project lookup for a chat**

```bash
grep -n "getProject\|projectsById\|chat\\.projectId" src/server/event-store.ts | head -20
```

Find the synchronous accessor that maps `chatId → projectId` (likely
`this.requireChat(chatId).projectId`).

- [ ] **Step 3: Write failing test**

Append to `src/server/event-store.test.ts`:

```ts
test("subagent_entry_appended caps tool_result over threshold", async () => {
  const { store, chatId, runId, projectId, kannaRoot } = await seedRunningSubagent()
  const big = "z".repeat(60_000)
  await store.appendSubagentEvent({
    v: 3,
    type: "subagent_entry_appended",
    timestamp: 1700000000000,
    chatId,
    runId,
    entry: {
      kind: "tool_result",
      _id: "e1",
      createdAt: 1700000000000,
      toolId: "tool-big",
      content: big,
    } as TranscriptEntry,
  })
  const run = store.getSubagentRuns(chatId)[runId]
  const last = run.entries[run.entries.length - 1] as { persisted?: { filepath: string; originalSize: number } }
  expect(last.persisted).toBeDefined()
  expect(last.persisted!.originalSize).toBe(big.length)
  const onDisk = await Bun.file(last.persisted!.filepath).text()
  expect(onDisk).toBe(big)
})
```

Extend the existing `seedRunningSubagent` helper so it returns
`projectId` and `kannaRoot` (the test dir the store is rooted at).

- [ ] **Step 4: Run test to verify it fails**

```bash
bun test src/server/event-store.test.ts -t "caps tool_result over threshold"
```

Expected: FAIL — `last.persisted` is undefined.

- [ ] **Step 5: Wire `capTranscriptEntry` into the appender**

Add import at the top of `src/server/event-store.ts`:

```ts
import { capTranscriptEntry } from "./subagent-entry-cap"
```

Replace `appendSubagentEvent` at line 1501:

```ts
  async appendSubagentEvent(event: SubagentRunEvent) {
    if (event.type === "subagent_entry_appended" && event.entry.kind === "tool_result") {
      const chat = this.state.chatsById.get(event.chatId)
      if (chat) {
        event = {
          ...event,
          entry: await capTranscriptEntry({
            entry: event.entry,
            chatId: event.chatId,
            runId: event.runId,
            projectId: chat.projectId,
            kannaRoot: this.dataDir,
          }),
        }
      }
    }
    await this.append(this.turnsLogPath, event)
  }
```

Replace `this.dataDir` and `this.state.chatsById.get(event.chatId)`
with the actual accessors found in Steps 1-2. If the chat is missing
(during replay-time edge cases), skip the cap step — fall through to
the append.

- [ ] **Step 6: Run test to verify it passes**

```bash
bun test src/server/event-store.test.ts -t "caps tool_result over threshold"
```

Expected: PASS.

- [ ] **Step 7: Run the full event-store test file**

```bash
bun test src/server/event-store.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/event-store.ts src/server/event-store.test.ts
git commit -m "feat(event-store): apply subagent payload cap in appendSubagentEvent"
```

---

## Task 8 — `AgentCoordinator.subagentPendingResolvers` + onToolRequest rewrite

**Files:**
- Modify: `src/server/agent.ts:1635-1710`
  (`buildSubagentProviderRunForChat`)
- Modify: `src/server/agent.ts` (class field declarations — find
  via grep)

- [ ] **Step 1: Locate class field block**

```bash
grep -n "private activeTurns\\|private autoResumeByChat\\|private cancelledChats" src/server/agent.ts | head -10
```

Note the line where existing `private` fields live on the
`AgentCoordinator` class.

- [ ] **Step 2: Add resolver map field**

Inside the `AgentCoordinator` class, alongside the other `private`
fields, add:

```ts
  private subagentPendingResolvers = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()

  private subagentPendingKey(chatId: string, runId: string, toolUseId: string): string {
    return `${chatId}::${runId}::${toolUseId}`
  }
```

- [ ] **Step 3: Replace auto-deny with forwarding**

In `src/server/agent.ts:1646-1681`, replace the `onToolRequest`
arrow function inside `buildSubagentProviderRunForChat` with:

```ts
    const onToolRequest = async (request: HarnessToolRequest): Promise<unknown> => {
      if (request.tool.toolKind !== "ask_user_question"
          && request.tool.toolKind !== "exit_plan_mode") {
        // Non-interactive tools (bash, read, write, ...) — SDK handles
        // them via canUseTool wrapper. No forwarding needed.
        return null
      }
      const toolUseId = request.tool.toolId
      const key = this.subagentPendingKey(args.chatId, args.runId, toolUseId)
      await this.store.appendSubagentEvent({
        v: 3,
        type: "subagent_tool_pending",
        timestamp: Date.now(),
        chatId: args.chatId,
        runId: args.runId,
        toolUseId,
        toolKind: request.tool.toolKind,
        input: request.tool.input,
      })
      this.emitStateChange(args.chatId)
      return await new Promise<unknown>((resolve, reject) => {
        this.subagentPendingResolvers.set(key, { resolve, reject })
      })
    }
```

Remove the `console.warn(LOG_PREFIX, "subagent tool auto-denied", …)`
block — phase 5 no longer auto-denies.

- [ ] **Step 4: Run subagent agent tests**

```bash
bun test src/server/agent.test.ts -t "subagent"
```

Expected: existing tests may fail because they expect the auto-deny
synthetic result. Note the failures; Task 12 updates them.

- [ ] **Step 5: Commit**

```bash
git add src/server/agent.ts
git commit -m "feat(agent): replace subagent auto-deny with pending-tool forwarding"
```

---

## Task 9 — WS handler `chat.respondSubagentTool`

**Files:**
- Modify: `src/server/agent.ts` (locate `respondTool` method, around
  line 2364)

- [ ] **Step 1: Locate existing respondTool method**

```bash
grep -n "async respondTool\\|chat\\.respondTool" src/server/agent.ts
```

- [ ] **Step 2: Add `respondSubagentTool` method**

Immediately after the existing `respondTool` method body
(`src/server/agent.ts` around line 2410), add:

```ts
  async respondSubagentTool(command: Extract<ClientCommand, { type: "chat.respondSubagentTool" }>) {
    const key = this.subagentPendingKey(command.chatId, command.runId, command.toolUseId)
    const resolver = this.subagentPendingResolvers.get(key)
    if (!resolver) {
      throw new Error("No pending subagent tool")
    }
    this.subagentPendingResolvers.delete(key)
    await this.store.appendSubagentEvent({
      v: 3,
      type: "subagent_tool_resolved",
      timestamp: Date.now(),
      chatId: command.chatId,
      runId: command.runId,
      toolUseId: command.toolUseId,
      result: command.result,
      resolution: "user",
    })
    resolver.resolve(command.result)
    this.emitStateChange(command.chatId)
  }
```

- [ ] **Step 3: Wire into ws router**

Find the ws command dispatch (likely `src/server/ws-router.ts` or
similar):

```bash
grep -rn 'case "chat.respondTool"' src/server/ | head -3
```

Add the matching case for `chat.respondSubagentTool` right after
`chat.respondTool`. Pattern (adapt to exact file):

```ts
        case "chat.respondSubagentTool":
          await this.coordinator.respondSubagentTool(command)
          break
```

- [ ] **Step 4: Run typecheck**

```bash
bun run check
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/server/agent.ts src/server/<ws-router-file>.ts
git commit -m "feat(ws): handler for chat.respondSubagentTool command"
```

---

## Task 10 — Orchestrator sliding-window timeout

**Files:**
- Modify: `src/server/subagent-orchestrator.ts:250-301` (the
  `Promise.race` timeout block inside `spawnRun`)

- [ ] **Step 1: Understand current timeout shape**

The current code at `subagent-orchestrator.ts:283-290` runs:

```ts
        const result = await Promise.race([
          runStart.start(onChunk, onEntry),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("TIMEOUT")), this.timeoutMs())
          }),
        ]).finally(() => {
          if (timeoutId) clearTimeout(timeoutId)
        })
```

Replace with a controllable timer that exposes pause/resume.

- [ ] **Step 2: Add a `PausableTimeout` helper**

At the top of `src/server/subagent-orchestrator.ts`, immediately
below the imports, add:

```ts
class PausableTimeout {
  private remainingMs: number
  private deadline: number | null = null
  private handle: ReturnType<typeof setTimeout> | null = null
  private onFire: () => void

  constructor(totalMs: number, onFire: () => void) {
    this.remainingMs = totalMs
    this.onFire = onFire
  }

  start(now: number = Date.now()): void {
    this.deadline = now + this.remainingMs
    this.handle = setTimeout(this.onFire, this.remainingMs)
  }

  pause(now: number = Date.now()): void {
    if (this.handle == null || this.deadline == null) return
    clearTimeout(this.handle)
    this.handle = null
    this.remainingMs = Math.max(0, this.deadline - now)
    this.deadline = null
  }

  resume(now: number = Date.now()): void {
    if (this.handle != null) return
    this.start(now)
  }

  clear(): void {
    if (this.handle != null) clearTimeout(this.handle)
    this.handle = null
    this.deadline = null
  }
}
```

- [ ] **Step 3: Pipe pause/resume hooks through the orchestrator**

Modify `SubagentOrchestratorDeps` (around line 39) — no shape
change needed. Instead, in `spawnRun` after constructing the
`PausableTimeout`, expose pause/resume via two methods on the
orchestrator class:

```ts
  private timeoutsByRun = new Map<string, PausableTimeout>()

  notifySubagentToolPending(runId: string): void {
    this.timeoutsByRun.get(runId)?.pause()
  }

  notifySubagentToolResolved(runId: string): void {
    this.timeoutsByRun.get(runId)?.resume()
  }
```

- [ ] **Step 4: Replace the timeout block in `spawnRun`**

Inside `spawnRun` (around line 250), replace the `Promise.race`
block with:

```ts
      let finalText = ""
      let usage: ProviderUsage | undefined
      const pausable = new PausableTimeout(this.timeoutMs(), () => {
        timeoutRejection.reject(new Error("TIMEOUT"))
      })
      const timeoutRejection = createDeferred<never>()
      this.timeoutsByRun.set(runId, pausable)
      pausable.start()
      try {
        const result = await Promise.race([
          runStart.start(onChunk, onEntry),
          timeoutRejection.promise,
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
      } finally {
        pausable.clear()
        this.timeoutsByRun.delete(runId)
      }
```

Add the `createDeferred` helper near `PausableTimeout`:

```ts
interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
```

- [ ] **Step 5: Wire `AgentCoordinator` to call the notify hooks**

In `src/server/agent.ts` inside `onToolRequest` (Task 8 code), call
the orchestrator BEFORE awaiting the resolver Promise. Locate the
`subagentOrchestrator` reference on the coordinator:

```bash
grep -n "subagentOrchestrator\\b\\|this\\.orchestrator\\b" src/server/agent.ts | head -5
```

Then in the `onToolRequest` body, after `this.store.appendSubagentEvent({type: "subagent_tool_pending", ...})`:

```ts
      this.subagentOrchestrator?.notifySubagentToolPending(args.runId)
```

And in `respondSubagentTool` (Task 9), before calling
`resolver.resolve`, add:

```ts
    this.subagentOrchestrator?.notifySubagentToolResolved(command.runId)
```

- [ ] **Step 6: Add timeout-pause test**

Append to `src/server/subagent-orchestrator.test.ts`:

```ts
test("timeout pauses while subagent has pending tool", async () => {
  const fakeNow = { value: 0 }
  const deferred = createDeferred<{ text: string }>()
  const orchestrator = new SubagentOrchestrator({
    store: stubStore,
    appSettings: stubAppSettings([{ id: "s1", name: "alice", ... }]),
    startProviderRun: () => ({
      provider: "claude", model: "x", systemPrompt: "", preamble: null,
      authReady: async () => true,
      start: async () => deferred.promise,
    }),
    now: () => fakeNow.value,
    runTimeoutMs: 1000,
  })
  // Spawn a run, simulate tool pending at t=500, advance clock by 5000ms.
  // Resume at t=5500. Expect run not to have failed by TIMEOUT.
  // Resolve start() at t=5500+something. Expect completed.
})
```

Use the existing test scaffolding pattern in the file (locate by
reading the top of `subagent-orchestrator.test.ts`).

- [ ] **Step 7: Run orchestrator tests**

```bash
bun test src/server/subagent-orchestrator.test.ts
```

Expected: all pass including new pause test.

- [ ] **Step 8: Commit**

```bash
git add src/server/subagent-orchestrator.ts src/server/subagent-orchestrator.test.ts src/server/agent.ts
git commit -m "feat(subagent): sliding-window timeout pause while tool pending"
```

---

## Task 11 — Restart recovery for orphan pending

**Files:**
- Modify: `src/server/event-store.ts` (post-replay hook — find via
  grep)
- Modify: `src/server/subagent-orchestrator.ts` constructor

- [ ] **Step 1: Locate post-replay hook in EventStore**

```bash
grep -n "afterReplay\\|onReplayComplete\\|replay\\s*(" src/server/event-store.ts | head -10
```

Find where replay finishes — there will be a method called after
log loading. If none exists as a hook, add a public method:

```ts
  *runningSubagentRuns(): Iterable<SubagentRunSnapshot> {
    for (const map of this.state.subagentRunsByChatId.values()) {
      for (const run of map.values()) {
        if (run.status === "running") yield run
      }
    }
  }
```

- [ ] **Step 2: Add recovery on orchestrator construction**

In `src/server/subagent-orchestrator.ts` `SubagentOrchestrator`
constructor (around line 66), add at the end:

```ts
    void this.recoverInterruptedRuns()
```

And add the private method:

```ts
  private async recoverInterruptedRuns(): Promise<void> {
    for (const run of this.deps.store.runningSubagentRuns()) {
      if (run.pendingTool == null) continue
      try {
        await this.deps.store.appendSubagentEvent({
          v: 3,
          type: "subagent_run_failed",
          timestamp: this.now(),
          chatId: run.chatId,
          runId: run.runId,
          error: {
            code: "INTERRUPTED",
            message: "Server restart while subagent awaited tool response",
          },
        })
      } catch (err) {
        console.warn(`${LOG_PREFIX} interrupted-run recovery failed`, {
          chatId: run.chatId, runId: run.runId, err,
        })
      }
    }
  }
```

- [ ] **Step 3: Write failing test**

In `src/server/subagent-orchestrator.test.ts`:

```ts
test("recoverInterruptedRuns: marks runs with pendingTool as INTERRUPTED", async () => {
  const store = await seedStoreWithPendingSubagent()
  const orchestrator = new SubagentOrchestrator({
    store, appSettings: stubAppSettings([]),
    startProviderRun: () => { throw new Error("should not start") },
  })
  // Wait one tick for recoverInterruptedRuns to complete
  await new Promise((r) => setTimeout(r, 10))
  const run = Object.values(store.getSubagentRuns(seededChatId))[0]
  expect(run.status).toBe("failed")
  expect(run.error?.code).toBe("INTERRUPTED")
})
```

Build `seedStoreWithPendingSubagent` to instantiate a store, append
`subagent_run_started` then `subagent_tool_pending`, then return
that store to a fresh orchestrator.

- [ ] **Step 4: Run test**

```bash
bun test src/server/subagent-orchestrator.test.ts -t "INTERRUPTED"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/event-store.ts src/server/subagent-orchestrator.ts src/server/subagent-orchestrator.test.ts
git commit -m "feat(subagent): recover orphan pending runs as INTERRUPTED on restart"
```

---

## Task 12 — Update phase-3 mention-gating test for new behaviour

**Files:**
- Modify: `src/server/agent.test.ts:3264-3291` (the test that asserts
  primary doesn't fire when mentions exist)

- [ ] **Step 1: Read existing test**

```bash
sed -n '3260,3310p' src/server/agent.test.ts
```

- [ ] **Step 2: Update assertion**

If the test asserts on the auto-deny behaviour (snapshot has a
`subagent_run_failed` event with code from auto-deny), update it to
not depend on `INTERRUPTED` semantics for runs that don't call
interactive tools. Most likely the test uses a non-interactive tool
path and is unaffected — verify by running first:

```bash
bun test src/server/agent.test.ts -t "subagent"
```

Adjust any tests that explicitly asserted on the auto-deny synthetic
result (`"[denied: subagents cannot ask the user; reply via assistant text]"`).
Those tests should now mock `onToolRequest` to verify it appends
`subagent_tool_pending` instead.

- [ ] **Step 3: Re-run agent tests**

```bash
bun test src/server/agent.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/agent.test.ts
git commit -m "test(agent): update subagent tests for tool-forwarding behaviour"
```

---

## Task 13 — Client: lift submit callback from
`AskUserQuestionMessage` / `ExitPlanModeMessage` (if coupled)

**Files:**
- Inspect: `src/client/components/messages/AskUserQuestionMessage.tsx`
- Inspect: `src/client/components/messages/ExitPlanModeMessage.tsx`

- [ ] **Step 1: Verify existing prop shape**

`AskUserQuestionMessage` already takes `onSubmit` as a prop
(`src/client/components/messages/AskUserQuestionMessage.tsx:11`).
`ExitPlanModeMessage` similarly takes a callback. No refactor needed
— the parent decides which command to dispatch. Skip to Task 14 if
both confirmed.

- [ ] **Step 2: If a hardcoded `chat.respondTool` dispatch lives inside either component, lift it**

If grep finds `chat.respondTool` literal inside either component:

```bash
grep -n "chat\\.respondTool\\|sendCommand" src/client/components/messages/AskUserQuestionMessage.tsx src/client/components/messages/ExitPlanModeMessage.tsx
```

Move the dispatch up to the existing parent in
`KannaTranscript.tsx:431` (already does this — see grep result from
earlier: `onAskUserQuestionSubmit` is passed in). No code change.

- [ ] **Step 3: No commit needed if no change**

---

## Task 14 — `SubagentPendingToolCard` component

**Files:**
- Create:
  `src/client/components/messages/SubagentPendingToolCard.tsx`

- [ ] **Step 1: Implement component**

Build a synthetic `HydratedToolCall` that matches the shape in
`src/shared/types.ts:1125-1138` (`HydratedToolCallBase`). The
`AskUserQuestionMessage` component reads `message.input.questions`
(`AskUserQuestionMessage.tsx:152`), not `message.questions` — `input`
must be a nested object.

Create `src/client/components/messages/SubagentPendingToolCard.tsx`:

```tsx
import type {
  AskUserQuestionAnswerMap,
  HydratedAskUserQuestionToolCall,
  HydratedExitPlanModeToolCall,
  SubagentPendingTool,
} from "../../../shared/types"
import { AskUserQuestionMessage } from "./AskUserQuestionMessage"
import { ExitPlanModeMessage } from "./ExitPlanModeMessage"
import type { AskUserQuestionItem } from "./types"

interface Props {
  pendingTool: SubagentPendingTool
  onAskUserQuestionSubmit: (toolUseId: string, questions: AskUserQuestionItem[], answers: AskUserQuestionAnswerMap) => void
  onExitPlanModeSubmit: (
    toolUseId: string,
    response: { confirmed: boolean; clearContext?: boolean; message?: string },
  ) => void
}

export function SubagentPendingToolCard({ pendingTool, onAskUserQuestionSubmit, onExitPlanModeSubmit }: Props) {
  if (pendingTool.toolKind === "ask_user_question") {
    const rawInput = pendingTool.input as { questions?: AskUserQuestionItem[] }
    const message: HydratedAskUserQuestionToolCall = {
      id: pendingTool.toolUseId,
      kind: "tool",
      toolKind: "ask_user_question",
      toolName: "AskUserQuestion",
      toolId: pendingTool.toolUseId,
      input: { questions: rawInput.questions ?? [] },
      timestamp: new Date(pendingTool.requestedAt).toISOString(),
    }
    return (
      <div data-testid={`subagent-pending-tool:${pendingTool.toolUseId}`}>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          awaiting your response
        </div>
        <AskUserQuestionMessage
          message={message}
          onSubmit={onAskUserQuestionSubmit}
          isLatest={true}
        />
      </div>
    )
  }
  if (pendingTool.toolKind === "exit_plan_mode") {
    const rawInput = pendingTool.input as { plan?: string }
    const message: HydratedExitPlanModeToolCall = {
      id: pendingTool.toolUseId,
      kind: "tool",
      toolKind: "exit_plan_mode",
      toolName: "ExitPlanMode",
      toolId: pendingTool.toolUseId,
      input: { plan: rawInput.plan ?? "" },
      timestamp: new Date(pendingTool.requestedAt).toISOString(),
    }
    return (
      <div data-testid={`subagent-pending-tool:${pendingTool.toolUseId}`}>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          awaiting your response
        </div>
        <ExitPlanModeMessage
          message={message}
          onSubmit={onExitPlanModeSubmit}
          isLatest={true}
        />
      </div>
    )
  }
  return null
}
```

Verify the input shapes by reading
`src/shared/types.ts` lines 1140-1156 (`AskUserQuestionToolCall`,
`ExitPlanModeToolCall`) — adjust if the actual input field names
differ.

- [ ] **Step 2: Run typecheck**

```bash
bun run check
```

Expected: passes. Fix any prop name mismatches surfaced by tsc.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/messages/SubagentPendingToolCard.tsx
git commit -m "feat(client): SubagentPendingToolCard component"
```

---

## Task 15 — `SubagentMessage` renders pending card

**Files:**
- Modify:
  `src/client/components/messages/SubagentMessage.tsx`

- [ ] **Step 1: Add props for tool submit callbacks**

In `SubagentMessage.tsx:8-14`, extend the `SubagentMessageProps`:

```tsx
interface SubagentMessageProps {
  run: SubagentRunSnapshot
  indentDepth: number
  localPath: string
  onOpenSettings?: () => void
  onRetry?: () => void
  onSubagentAskUserQuestionSubmit?: (
    runId: string,
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap,
  ) => void
  onSubagentExitPlanModeSubmit?: (
    runId: string,
    toolUseId: string,
    response: { confirmed: boolean; clearContext?: boolean; message?: string },
  ) => void
}
```

Add imports:

```tsx
import type { AskUserQuestionAnswerMap } from "../../../shared/types"
import type { AskUserQuestionItem } from "./types"
import { SubagentPendingToolCard } from "./SubagentPendingToolCard"
```

- [ ] **Step 2: Render pending card after entries**

In the JSX returned by `SubagentMessage` (after the `messages.map`
on line 40-42), add:

```tsx
      {run.pendingTool && (
        <SubagentPendingToolCard
          pendingTool={run.pendingTool}
          onAskUserQuestionSubmit={(toolUseId, questions, answers) =>
            onSubagentAskUserQuestionSubmit?.(run.runId, toolUseId, questions, answers)
          }
          onExitPlanModeSubmit={(toolUseId, response) =>
            onSubagentExitPlanModeSubmit?.(run.runId, toolUseId, response)
          }
        />
      )}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run check
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/messages/SubagentMessage.tsx
git commit -m "feat(client): SubagentMessage renders pending-tool card"
```

---

## Task 16 — `KannaTranscript` wires callback to dispatch

**Files:**
- Modify: `src/client/app/KannaTranscript.tsx`

- [ ] **Step 1: Locate where `SubagentMessage` is rendered**

```bash
grep -n "SubagentMessage" src/client/app/KannaTranscript.tsx
```

- [ ] **Step 2: Add dispatch handlers and pass to SubagentMessage**

In `KannaTranscript.tsx`, locate the `useKannaSendCommand` hook (or
whatever the existing dispatch hook is called — find by grepping
for `chat.respondTool` in the file). Add the two new handlers near
the existing `onAskUserQuestionSubmit`:

```tsx
const onSubagentAskUserQuestionSubmit = useCallback(
  (runId: string, toolUseId: string, _questions: AskUserQuestionItem[], answers: AskUserQuestionAnswerMap) => {
    sendCommand({
      type: "chat.respondSubagentTool",
      chatId: chat.runtime.chatId,
      runId,
      toolUseId,
      result: { answers },
    })
  },
  [sendCommand, chat.runtime.chatId],
)

const onSubagentExitPlanModeSubmit = useCallback(
  (runId: string, toolUseId: string, response: { confirmed: boolean; clearContext?: boolean; message?: string }) => {
    sendCommand({
      type: "chat.respondSubagentTool",
      chatId: chat.runtime.chatId,
      runId,
      toolUseId,
      result: response,
    })
  },
  [sendCommand, chat.runtime.chatId],
)
```

Then pass both to every `<SubagentMessage>` JSX site:

```tsx
<SubagentMessage
  run={run}
  /* existing props */
  onSubagentAskUserQuestionSubmit={onSubagentAskUserQuestionSubmit}
  onSubagentExitPlanModeSubmit={onSubagentExitPlanModeSubmit}
/>
```

- [ ] **Step 3: Run typecheck and lint**

```bash
bun run check && bun run lint
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/client/app/KannaTranscript.tsx
git commit -m "feat(client): wire chat.respondSubagentTool dispatch in KannaTranscript"
```

---

## Task 17 — Propagate `persisted` through hydration + render affordance

**Background:** `parseTranscript.ts:91-106` consumes raw `tool_result`
entries INTO the preceding `tool_call`'s `result`/`rawResult` fields.
The raw `persisted` field on the tool_result entry is dropped.
`SubagentEntryRow` only sees the hydrated tool call (`kind: "tool"`),
not the original tool_result. We must copy `persisted` onto the
hydrated tool call so the renderer can find it.

**Files:**
- Modify: `src/shared/types.ts:1125-1138`
  (`HydratedToolCallBase` — add `persisted` field)
- Modify: `src/client/lib/parseTranscript.ts:91-106`
  (hydration: copy `persisted` from tool_result entry)
- Modify: `src/client/components/messages/SubagentEntryRow.tsx`
  (render branch)

- [ ] **Step 1: Add `persisted` to `HydratedToolCallBase`**

In `src/shared/types.ts:1125-1138` extend the base shape:

```ts
export interface HydratedToolCallBase<TKind extends string, TInput, TResult> {
  id: string
  messageId?: string
  hidden?: boolean
  kind: "tool"
  toolKind: TKind
  toolName: string
  toolId: string
  input: TInput
  result?: TResult
  rawResult?: unknown
  isError?: boolean
  /**
   * Set when the underlying tool_result entry was persisted to disk
   * via the subagent payload cap. Mirrored from
   * ToolResultEntry.persisted during hydration.
   */
  persisted?: {
    filepath: string
    originalSize: number
    isJson: boolean
    truncated: true
  }
  timestamp: string
}
```

- [ ] **Step 2: Copy `persisted` during hydration**

In `src/client/lib/parseTranscript.ts:91-106`, inside the
`case "tool_result":` block, after assigning `result`/`rawResult`:

```ts
      case "tool_result": {
        const pendingCall = pendingToolCalls.get(entry.toolId)
        if (pendingCall) {
          const rawResult = (
            pendingCall.normalized.toolKind === "ask_user_question" ||
            pendingCall.normalized.toolKind === "exit_plan_mode"
          )
            ? getStructuredToolResultFromDebug(entry) ?? entry.content
            : entry.content

          pendingCall.hydrated.result = hydrateToolResult(pendingCall.normalized, rawResult) as never
          pendingCall.hydrated.rawResult = rawResult
          pendingCall.hydrated.isError = entry.isError
          // Phase 5: propagate persisted-on-disk metadata so renderers
          // can surface "View full output" affordance on the tool call.
          if (entry.persisted) {
            pendingCall.hydrated.persisted = entry.persisted
          }
        }
        break
      }
```

- [ ] **Step 3: Read existing SubagentEntryRow**

```bash
sed -n '1,200p' src/client/components/messages/SubagentEntryRow.tsx
```

Locate the branch that renders `message.kind === "tool"` (or the
catch-all that delegates to `ToolCallMessage`).

- [ ] **Step 4: Render persisted affordance**

In `SubagentEntryRow.tsx`, at the start of the render for a
hydrated tool message, gate on `message.persisted`:

```tsx
if (message.kind === "tool" && message.persisted) {
  const stripped = stripPersistedTags(asString(message.rawResult ?? ""))
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1 text-xs">
      <div className="font-medium">
        {message.toolName}: output too large ({formatBytes(message.persisted.originalSize)}) — saved to disk
      </div>
      <pre className="text-[11px] whitespace-pre-wrap overflow-hidden max-h-48">
        {stripped}
      </pre>
      <a
        href={`file://${message.persisted.filepath}`}
        onClick={(e) => {
          e.preventDefault()
          openLocalFile(message.persisted!.filepath)
        }}
        className="text-blue-500 hover:underline"
      >
        View full output ({message.persisted.filepath})
      </a>
    </div>
  )
}
```

Then fall through to the existing render path for non-persisted
calls.

Helpers (add at module top — they only exist if not already
imported):

```tsx
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2)
}

function stripPersistedTags(s: string): string {
  return s
    .replace(/<persisted-output>\n?/g, "")
    .replace(/\n?<\/persisted-output>/g, "")
}
```

For `openLocalFile`, locate the existing local-file open path:

```bash
grep -rn "openLocalFile\\|/api/local-file\\|file://" src/client/components/messages/LocalFileLinkCard.tsx src/client/lib/
```

Reuse the same approach (likely a fetch to a server endpoint that
streams the file). If no shared helper exists, call
`mcp__kanna__offer_download` indirectly by emitting a markdown link
the existing `LocalFileLinkCard` consumes — verify by reading how
commit `67fb665` wired downloads.

- [ ] **Step 5: Run typecheck and tests**

```bash
bun run check && bun test src/client
```

Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/client/lib/parseTranscript.ts src/client/components/messages/SubagentEntryRow.tsx
git commit -m "feat(client): propagate persisted tool_result through hydration + render View Full Output"
```

---

## Task 18 — Client tests for `SubagentMessage`

**Files:**
- Modify: `src/client/components/messages/SubagentMessage.test.tsx`

- [ ] **Step 1: Add test for pending card rendering**

Append to `SubagentMessage.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, test, mock } from "bun:test"
import { SubagentMessage } from "./SubagentMessage"
import type { SubagentRunSnapshot } from "../../../shared/types"

function makeRun(overrides: Partial<SubagentRunSnapshot>): SubagentRunSnapshot {
  return {
    runId: "r1", chatId: "c1", subagentId: "s1", subagentName: "alice",
    provider: "claude", model: "x", status: "running",
    parentUserMessageId: "u1", parentRunId: null, depth: 0,
    startedAt: 0, finishedAt: null, finalText: null,
    error: null, usage: null, entries: [], pendingTool: null,
    ...overrides,
  }
}

describe("SubagentMessage pending tool", () => {
  test("renders AskUserQuestion card when pendingTool set", () => {
    const run = makeRun({
      pendingTool: {
        toolUseId: "t1", toolKind: "ask_user_question",
        input: { questions: [{ id: "q1", question: "Confirm?", options: [{ label: "yes" }, { label: "no" }] }] },
        requestedAt: 0,
      },
    })
    const onAsk = mock(() => {})
    render(
      <SubagentMessage
        run={run} indentDepth={0} localPath="/tmp"
        onSubagentAskUserQuestionSubmit={onAsk}
        onSubagentExitPlanModeSubmit={() => {}}
      />
    )
    expect(screen.getByTestId("subagent-pending-tool:t1")).toBeInTheDocument()
  })

  test("renders persisted tool_result with View Full Output link", () => {
    // processTranscriptMessages folds tool_result INTO the preceding
    // tool_call, propagating `persisted` onto the hydrated tool
    // message (see Task 17). Test the same pairing the real flow
    // produces.
    const run = makeRun({
      entries: [
        {
          kind: "tool_call",
          _id: "call-1",
          createdAt: 0,
          tool: {
            toolKind: "bash",
            toolName: "Bash",
            toolId: "tool-big",
            input: { command: "find /" },
          },
        } as TranscriptEntry,
        {
          kind: "tool_result",
          _id: "e1",
          createdAt: 0,
          toolId: "tool-big",
          content: "<persisted-output>\nOutput too large (60 KB)…",
          persisted: {
            filepath: "/tmp/foo.txt",
            originalSize: 60_000,
            isJson: false,
            truncated: true,
          },
        } as TranscriptEntry,
      ],
    })
    render(
      <SubagentMessage
        run={run} indentDepth={0} localPath="/tmp"
        onSubagentAskUserQuestionSubmit={() => {}}
        onSubagentExitPlanModeSubmit={() => {}}
      />
    )
    expect(screen.getByText(/Output too large/)).toBeInTheDocument()
    expect(screen.getByText(/View full output/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
bun test src/client/components/messages/SubagentMessage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/messages/SubagentMessage.test.tsx
git commit -m "test(client): SubagentMessage pending card + persisted entry rendering"
```

---

## Task 19 — Render-loop regression check for selector

**Files:**
- Inspect: `src/client/app/useKannaState.ts`

- [ ] **Step 1: Locate the `subagentRuns` selector**

```bash
grep -n "subagentRuns" src/client/app/useKannaState.ts
```

- [ ] **Step 2: Verify stable reference**

If the selector returns `state.subagentRuns ?? {}` inline, replace
with the sentinel pattern per CLAUDE.md:

```ts
const EMPTY_SUBAGENT_RUNS: Record<string, SubagentRunSnapshot> = {}
// inside selector:
return state.subagentRuns ?? EMPTY_SUBAGENT_RUNS
```

Or use `useShallow` if multiple fields are returned.

- [ ] **Step 3: Add a regression test**

Locate `renderForLoopCheck` (per CLAUDE.md):

```bash
grep -rn "renderForLoopCheck" src/client/lib/testing/
```

Add a small test that renders `SubagentMessage` with `pendingTool`
non-null inside `renderForLoopCheck` to assert no error #185 fires.

- [ ] **Step 4: Run lint and tests**

```bash
bun run lint && bun test src/client
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/app/useKannaState.ts src/client/components/messages/SubagentMessage.test.tsx
git commit -m "test(client): render-loop check for SubagentMessage with pendingTool"
```

---

## Task 20 — Cleanup `subagent-results/` on chat delete

**Files:**
- Modify: `src/server/event-store.ts` (chat-delete path)

- [ ] **Step 1: Locate chat delete path**

```bash
grep -n "case \"chat_deleted\"\\|deleteChat\\|chat_removed" src/server/event-store.ts
```

- [ ] **Step 2: Add directory removal**

After the in-memory state cleanup for chat delete, add a best-effort
`rm` of the subagent-results directory:

```ts
import { rm } from "node:fs/promises"
import path from "node:path"

// inside the chat delete handler:
const chat = this.state.chatsById.get(chatId)
if (chat) {
  const dir = path.join(
    this.dataDir, "projects", chat.projectId,
    "chats", chatId, "subagent-results",
  )
  rm(dir, { recursive: true, force: true })
    .catch((err) => console.warn(`${LOG_PREFIX} subagent-results cleanup failed`, { chatId, err }))
}
```

Adjust the kannaRoot accessor to match what Task 7 used. Order
matters: read `chat.projectId` BEFORE the existing state cleanup
removes the chat record.

- [ ] **Step 3: Smoke test manually**

```bash
bun test src/server/event-store.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/event-store.ts
git commit -m "feat(event-store): remove subagent-results dir on chat delete"
```

---

## Task 21 — Final test + lint sweep

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: all pass.

- [ ] **Step 2: Run lint**

```bash
bun run lint
```

Expected: no errors. Warnings ok per CLAUDE.md, but new code should
not introduce them.

- [ ] **Step 3: Run typecheck**

```bash
bun run check
```

Expected: passes.

- [ ] **Step 4: Manual smoke checklist (PR description)**

Document in PR body:

- Create a Claude subagent with system prompt forcing
  `AskUserQuestion`; mention `@agent/<name>`; verify card appears
  inside the envelope; answer; run completes.
- Create a Codex subagent in plan mode; verify `ExitPlanMode` card.
- Force large bash output (`find /` inside subagent); verify
  "Output too large" preview card with working file path.
- Kill server mid-pending; restart; verify run shows
  `INTERRUPTED` error card.

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin plans/model-independent-chat-phase5
gh pr create --repo cuongtranba/kanna --base main --head plans/model-independent-chat-phase5 \
  --title "feat: phase 5 interactive tools forwarding + payload cap" \
  --body "$(cat <<'EOF'
## Summary
- Replace phase-4 auto-deny stub with real AskUserQuestion / ExitPlanMode forwarding from subagents to UI
- Add claude-code-style 50 KB persist-to-disk payload cap for `subagent_entry_appended` events; 2 KB preview kept inline
- Two new events: `subagent_tool_pending`, `subagent_tool_resolved`
- New client component `SubagentPendingToolCard` renders inside `SubagentMessage` envelope
- Sliding-window timeout pause while subagent awaits a tool response
- Restart recovery: orphan pending → `subagent_run_failed { INTERRUPTED }`

Spec: `docs/superpowers/specs/2026-05-14-model-independent-chat-phase5-interactive-tools-payload-cap-design.md`
Plan: `docs/superpowers/plans/2026-05-14-model-independent-chat-phase5-interactive-tools-payload-cap.md`

## Test plan
- [ ] Claude subagent AskUserQuestion → card visible → answer → run completes
- [ ] Codex subagent ExitPlanMode → card visible → confirm → run completes
- [ ] Large bash output (>50 KB) → preview card with file path
- [ ] Kill server mid-pending → restart → run shows INTERRUPTED
- [ ] `bun test`, `bun run lint`, `bun run check` all green
EOF
)"
```

---

## Out of scope (defer to phase 6)

- Per-message aggregate cap
  (`MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000`).
- Retry button wiring on `SubagentErrorCard`.
- Per-row cancel button per `SubagentMessage`.
- Fan-out + primary synthesis.
- `MAX_CHAIN_DEPTH = 2` opt-in.
- Per-subagent credentials picker.
- Subagent session token caching across runs.
- Compaction pass for old `subagent_entry_appended` entries.
- UI for choosing where to view "View full output" (inline modal vs
  external editor). Current task just emits a `file://` link.

---

## Known temporary breakages

- After Task 8 commit (auto-deny removed, resolver wiring added but
  ws handler still pending), any subagent that calls
  `AskUserQuestion` will hang on the Promise indefinitely. Fix lands
  in Task 9. If tests run between Tasks 8 and 9, they should not
  invoke interactive tools — agent.test.ts subagent tests pass
  because phase 3's mention-gating test path uses a stub
  `startProviderRun` that never calls `onToolRequest`.

- Between Tasks 6 and 7, `appendSubagentEvent` doesn't yet apply the
  cap; large tool_results will inflate the test log. This is fine
  for one commit.
