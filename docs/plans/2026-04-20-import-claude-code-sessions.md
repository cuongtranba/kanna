# Import Claude Code Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Import" button to the Kanna sidebar that scans `~/.claude/projects/*/*.jsonl` and bulk-creates Kanna chats from each session with full transcript preloaded, deduped by Claude session ID.

**Architecture:** New server module `claude-session-importer.ts` parses Claude Code session JSONL files, maps records to Kanna `TranscriptEntry` values, and emits events through the existing `EventStore` (`openProject` → `createChat` → `renameChat` → `setChatProvider` → `appendMessage` × N → `setSessionToken`). Dedup uses the `sessionToken` field already present on `ChatRecord` (agent.ts:620 passes it as `resume` to the Claude Agent SDK, so imported chats resume seamlessly). New WS command `sessions.importClaude` handles the request; client adds an icon button next to the existing Add Project button in the sidebar header.

**Tech Stack:** TypeScript, Bun, React 19, Zustand, Vite, WebSocket (custom envelope protocol). Existing test framework: `bun test`.

**Reference design:** `docs/plans/2026-04-20-import-claude-code-sessions-design.md`

---

## Preflight

**Run before starting:** ensure clean `main`, install deps.

```bash
git status                  # expect clean
bun install
bun run check               # typecheck + build baseline passes
bun test                    # baseline green
```

Create a worktree (recommended):

```bash
git worktree add ../kanna-import-sessions -b feat/import-claude-sessions
cd ../kanna-import-sessions
```

All paths below are relative to repo root.

---

## Task 1: Define Claude session record type

**Files:**
- Create: `src/server/claude-session-types.ts`

**Purpose:** Narrow, self-contained TypeScript types for Claude Code JSONL records. Keep parsing strict — only fields we use.

**Step 1: Create the types file.**

```ts
// src/server/claude-session-types.ts

export interface ClaudeSessionRecordBase {
  type: string
  uuid?: string
  parentUuid?: string | null
  sessionId?: string
  timestamp?: string
  cwd?: string
  version?: string
}

export interface ClaudeSessionUserRecord extends ClaudeSessionRecordBase {
  type: "user"
  message: {
    role: "user"
    content: string | Array<
      | { type: "text"; text: string }
      | { type: "tool_result"; tool_use_id: string; content?: unknown; is_error?: boolean }
    >
  }
}

export interface ClaudeSessionAssistantRecord extends ClaudeSessionRecordBase {
  type: "assistant"
  message: {
    role: "assistant"
    id?: string
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    >
  }
}

export interface ClaudeSessionSummaryRecord extends ClaudeSessionRecordBase {
  type: "summary"
  summary?: string
}

export interface ClaudeSessionSystemRecord extends ClaudeSessionRecordBase {
  type: "system"
  content?: string
}

export type ClaudeSessionRecord =
  | ClaudeSessionUserRecord
  | ClaudeSessionAssistantRecord
  | ClaudeSessionSummaryRecord
  | ClaudeSessionSystemRecord
  | ClaudeSessionRecordBase

export interface ParsedClaudeSession {
  sessionId: string
  filePath: string
  cwd: string
  firstTimestamp: number
  lastTimestamp: number
  records: ClaudeSessionRecord[]
}
```

**Step 2: Typecheck.**

```bash
bun run tsc --noEmit
```

Expected: no errors.

**Step 3: Commit.**

```bash
git add src/server/claude-session-types.ts
git commit -m "feat(import): add Claude Code session record types"
```

---

## Task 2: JSONL parser — happy path test first

**Files:**
- Create: `src/server/claude-session-parser.ts`
- Create: `src/server/claude-session-parser.test.ts`
- Create: `src/server/__fixtures__/claude-session-valid.jsonl`

**Step 1: Write the happy-path fixture.**

`src/server/__fixtures__/claude-session-valid.jsonl`:

```jsonl
{"type":"user","uuid":"u1","sessionId":"sess-abc","cwd":"/tmp/kanna-test-proj","timestamp":"2026-04-20T10:00:00.000Z","message":{"role":"user","content":"hello"}}
{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"sess-abc","timestamp":"2026-04-20T10:00:01.000Z","message":{"role":"assistant","id":"msg-1","content":[{"type":"text","text":"hi back"}]}}
{"type":"user","uuid":"u2","parentUuid":"a1","sessionId":"sess-abc","timestamp":"2026-04-20T10:00:02.000Z","message":{"role":"user","content":"run ls"}}
{"type":"assistant","uuid":"a2","parentUuid":"u2","sessionId":"sess-abc","timestamp":"2026-04-20T10:00:03.000Z","message":{"role":"assistant","id":"msg-2","content":[{"type":"tool_use","id":"tu-1","name":"Bash","input":{"command":"ls","description":"list files"}}]}}
{"type":"user","uuid":"u3","parentUuid":"a2","sessionId":"sess-abc","timestamp":"2026-04-20T10:00:04.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu-1","content":"file1\nfile2"}]}}
{"type":"assistant","uuid":"a3","parentUuid":"u3","sessionId":"sess-abc","timestamp":"2026-04-20T10:00:05.000Z","message":{"role":"assistant","id":"msg-3","content":[{"type":"text","text":"done"}]}}
```

**Step 2: Write failing test.**

`src/server/claude-session-parser.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { parseClaudeSessionFile } from "./claude-session-parser"

const FIXTURE_DIR = path.join(__dirname, "__fixtures__")

describe("parseClaudeSessionFile", () => {
  test("parses valid session with user, assistant, tool_use, tool_result", () => {
    const parsed = parseClaudeSessionFile(path.join(FIXTURE_DIR, "claude-session-valid.jsonl"))
    expect(parsed).not.toBeNull()
    if (!parsed) return
    expect(parsed.sessionId).toBe("sess-abc")
    expect(parsed.cwd).toBe("/tmp/kanna-test-proj")
    expect(parsed.records.length).toBe(6)
    expect(parsed.firstTimestamp).toBeGreaterThan(0)
    expect(parsed.lastTimestamp).toBeGreaterThanOrEqual(parsed.firstTimestamp)
  })
})
```

Run: `bun test src/server/claude-session-parser.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement minimal parser.**

`src/server/claude-session-parser.ts`:

```ts
import { readFileSync, statSync } from "node:fs"
import type { ClaudeSessionRecord, ParsedClaudeSession } from "./claude-session-types"

function tryParse(line: string): ClaudeSessionRecord | null {
  try {
    const parsed = JSON.parse(line)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    if (typeof (parsed as ClaudeSessionRecord).type !== "string") return null
    return parsed as ClaudeSessionRecord
  } catch {
    return null
  }
}

export function parseClaudeSessionFile(filePath: string): ParsedClaudeSession | null {
  let raw: string
  try {
    raw = readFileSync(filePath, "utf8")
  } catch {
    return null
  }

  const records: ClaudeSessionRecord[] = []
  let sessionId: string | null = null
  let cwd: string | null = null
  let first = Number.POSITIVE_INFINITY
  let last = 0

  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const record = tryParse(trimmed)
    if (!record) continue

    if (!sessionId && typeof record.sessionId === "string") sessionId = record.sessionId
    if (!cwd && typeof record.cwd === "string") cwd = record.cwd

    const ts = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN
    if (!Number.isNaN(ts)) {
      if (ts < first) first = ts
      if (ts > last) last = ts
    }

    records.push(record)
  }

  if (!sessionId) return null
  if (records.length === 0) return null

  const mtime = statSync(filePath).mtimeMs
  return {
    sessionId,
    filePath,
    cwd: cwd ?? "",
    firstTimestamp: Number.isFinite(first) ? first : mtime,
    lastTimestamp: last > 0 ? last : mtime,
    records,
  }
}
```

**Step 4: Run test — expect PASS.**

```bash
bun test src/server/claude-session-parser.test.ts
```

**Step 5: Commit.**

```bash
git add src/server/claude-session-parser.ts src/server/claude-session-parser.test.ts src/server/__fixtures__/claude-session-valid.jsonl
git commit -m "feat(import): parse Claude Code session JSONL files"
```

---

## Task 3: Parser edge cases — malformed / empty

**Files:**
- Create: `src/server/__fixtures__/claude-session-malformed.jsonl`
- Create: `src/server/__fixtures__/claude-session-empty.jsonl`
- Modify: `src/server/claude-session-parser.test.ts`

**Step 1: Add fixtures.**

`claude-session-malformed.jsonl`:

```jsonl
{"type":"user","uuid":"u1","sessionId":"sess-bad","cwd":"/tmp/x","timestamp":"2026-04-20T10:00:00.000Z","message":{"role":"user","content":"ok"}}
not valid json at all
{"type":"assistant","uuid":"a1","sessionId":"sess-bad","timestamp":"2026-04-20T10:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"still works"}]}}
```

`claude-session-empty.jsonl`: create an empty file.

```bash
: > src/server/__fixtures__/claude-session-empty.jsonl
```

**Step 2: Add tests.**

Append to `claude-session-parser.test.ts`:

```ts
  test("skips malformed lines, keeps valid ones", () => {
    const parsed = parseClaudeSessionFile(path.join(FIXTURE_DIR, "claude-session-malformed.jsonl"))
    expect(parsed).not.toBeNull()
    if (!parsed) return
    expect(parsed.records.length).toBe(2)
    expect(parsed.sessionId).toBe("sess-bad")
  })

  test("returns null for empty file", () => {
    const parsed = parseClaudeSessionFile(path.join(FIXTURE_DIR, "claude-session-empty.jsonl"))
    expect(parsed).toBeNull()
  })

  test("returns null for missing file", () => {
    const parsed = parseClaudeSessionFile(path.join(FIXTURE_DIR, "does-not-exist.jsonl"))
    expect(parsed).toBeNull()
  })
```

**Step 3: Run — expect PASS without code changes (parser already handles these).**

```bash
bun test src/server/claude-session-parser.test.ts
```

**Step 4: Commit.**

```bash
git add src/server/claude-session-parser.test.ts src/server/__fixtures__/claude-session-malformed.jsonl src/server/__fixtures__/claude-session-empty.jsonl
git commit -m "test(import): cover malformed and empty Claude session files"
```

---

## Task 4: Map Claude records → Kanna TranscriptEntry

**Files:**
- Create: `src/server/claude-session-mapper.ts`
- Create: `src/server/claude-session-mapper.test.ts`

**Step 1: Write failing test.**

```ts
import { describe, expect, test } from "bun:test"
import { mapClaudeRecordsToEntries } from "./claude-session-mapper"
import type { ClaudeSessionRecord } from "./claude-session-types"

describe("mapClaudeRecordsToEntries", () => {
  const baseTs = "2026-04-20T10:00:00.000Z"

  test("user message → user_prompt entry", () => {
    const records: ClaudeSessionRecord[] = [
      { type: "user", uuid: "u1", timestamp: baseTs, message: { role: "user", content: "hello" } },
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("user_prompt")
    if (entries[0].kind === "user_prompt") {
      expect(entries[0].content).toBe("hello")
    }
  })

  test("assistant text → assistant_text entry", () => {
    const records: ClaudeSessionRecord[] = [
      {
        type: "assistant",
        uuid: "a1",
        timestamp: baseTs,
        message: { role: "assistant", id: "m1", content: [{ type: "text", text: "hi" }] },
      },
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("assistant_text")
    if (entries[0].kind === "assistant_text") {
      expect(entries[0].text).toBe("hi")
    }
  })

  test("assistant tool_use → tool_call entry with normalized Bash tool", () => {
    const records: ClaudeSessionRecord[] = [
      {
        type: "assistant",
        uuid: "a2",
        timestamp: baseTs,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls" } }],
        },
      },
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("tool_call")
    if (entries[0].kind === "tool_call") {
      expect(entries[0].tool.toolKind).toBe("bash")
      expect(entries[0].tool.toolId).toBe("tu-1")
    }
  })

  test("user tool_result → tool_result entry", () => {
    const records: ClaudeSessionRecord[] = [
      {
        type: "user",
        uuid: "u1",
        timestamp: baseTs,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu-1", content: "file1\nfile2" }],
        },
      },
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("tool_result")
    if (entries[0].kind === "tool_result") {
      expect(entries[0].toolId).toBe("tu-1")
      expect(entries[0].content).toBe("file1\nfile2")
    }
  })

  test("skips summary and system records", () => {
    const records: ClaudeSessionRecord[] = [
      { type: "summary", summary: "x" },
      { type: "system", content: "y" },
      { type: "user", uuid: "u1", timestamp: baseTs, message: { role: "user", content: "hi" } },
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
  })
})
```

Run: `bun test src/server/claude-session-mapper.test.ts` — expect FAIL.

**Step 2: Implement mapper.**

`src/server/claude-session-mapper.ts`:

```ts
import { normalizeToolCall } from "../shared/tools"
import type {
  AssistantTextEntry,
  ToolCallEntry,
  ToolResultEntry,
  TranscriptEntry,
  UserPromptEntry,
} from "../shared/types"
import type {
  ClaudeSessionAssistantRecord,
  ClaudeSessionRecord,
  ClaudeSessionUserRecord,
} from "./claude-session-types"

function toMillis(value: string | undefined): number {
  if (!value) return Date.now()
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function makeId(uuid: string | undefined, suffix: string): string {
  if (uuid) return `${uuid}-${suffix}`
  return `${crypto.randomUUID()}-${suffix}`
}

function mapUserRecord(record: ClaudeSessionUserRecord): TranscriptEntry[] {
  const createdAt = toMillis(record.timestamp)
  const content = record.message.content

  if (typeof content === "string") {
    const entry: UserPromptEntry = {
      _id: makeId(record.uuid, "user"),
      kind: "user_prompt",
      createdAt,
      content,
    }
    return [entry]
  }

  const entries: TranscriptEntry[] = []
  for (let i = 0; i < content.length; i += 1) {
    const block = content[i]
    if (block.type === "tool_result") {
      const resultEntry: ToolResultEntry = {
        _id: makeId(record.uuid, `tool_result-${i}`),
        kind: "tool_result",
        createdAt,
        toolId: block.tool_use_id,
        content: typeof block.content === "string" ? block.content : block.content ?? null,
        isError: block.is_error === true,
      }
      entries.push(resultEntry)
    }
  }
  return entries
}

function mapAssistantRecord(record: ClaudeSessionAssistantRecord): TranscriptEntry[] {
  const createdAt = toMillis(record.timestamp)
  const messageId = record.message.id

  const entries: TranscriptEntry[] = []
  for (let i = 0; i < record.message.content.length; i += 1) {
    const block = record.message.content[i]
    if (block.type === "text") {
      const entry: AssistantTextEntry = {
        _id: makeId(record.uuid, `text-${i}`),
        messageId,
        kind: "assistant_text",
        createdAt,
        text: block.text,
      }
      entries.push(entry)
      continue
    }
    if (block.type === "tool_use") {
      const tool = normalizeToolCall({
        toolName: block.name,
        toolId: block.id,
        input: block.input ?? {},
      })
      const entry: ToolCallEntry = {
        _id: makeId(record.uuid, `tool_call-${i}`),
        messageId,
        kind: "tool_call",
        createdAt,
        tool,
      }
      entries.push(entry)
    }
  }
  return entries
}

export function mapClaudeRecordsToEntries(records: ClaudeSessionRecord[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (const record of records) {
    if (record.type === "user") {
      entries.push(...mapUserRecord(record as ClaudeSessionUserRecord))
    } else if (record.type === "assistant") {
      entries.push(...mapAssistantRecord(record as ClaudeSessionAssistantRecord))
    }
    // summary/system/other: skipped
  }
  return entries
}
```

**Step 3: Run test — expect PASS.**

```bash
bun test src/server/claude-session-mapper.test.ts
```

**Step 4: Commit.**

```bash
git add src/server/claude-session-mapper.ts src/server/claude-session-mapper.test.ts
git commit -m "feat(import): map Claude session records to Kanna transcript entries"
```

---

## Task 5: Scanner — walk ~/.claude/projects/

**Files:**
- Create: `src/server/claude-session-scanner.ts`
- Create: `src/server/claude-session-scanner.test.ts`

**Step 1: Failing test using a temp dir.**

```ts
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { scanClaudeSessions } from "./claude-session-scanner"

function makeTempClaudeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(path.join(tmpdir(), "kanna-claude-home-"))
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

describe("scanClaudeSessions", () => {
  test("returns empty list when ~/.claude/projects missing", () => {
    const { home, cleanup } = makeTempClaudeHome()
    try {
      expect(scanClaudeSessions(home)).toEqual([])
    } finally {
      cleanup()
    }
  })

  test("discovers session files inside project folders", () => {
    const { home, cleanup } = makeTempClaudeHome()
    try {
      const realProj = mkdtempSync(path.join(tmpdir(), "kanna-proj-"))
      const folderName = realProj.replace(/\//g, "-")
      const projDir = path.join(home, ".claude", "projects", folderName)
      mkdirSync(projDir, { recursive: true })
      const sessionPath = path.join(projDir, "sess-abc.jsonl")
      const line = JSON.stringify({
        type: "user",
        uuid: "u1",
        sessionId: "sess-abc",
        cwd: realProj,
        timestamp: "2026-04-20T10:00:00.000Z",
        message: { role: "user", content: "hi" },
      })
      writeFileSync(sessionPath, `${line}\n`, "utf8")

      const sessions = scanClaudeSessions(home)
      expect(sessions.length).toBe(1)
      expect(sessions[0].sessionId).toBe("sess-abc")
      expect(sessions[0].filePath).toBe(sessionPath)
      rmSync(realProj, { recursive: true, force: true })
    } finally {
      cleanup()
    }
  })
})
```

Run: expect FAIL.

**Step 2: Implement scanner.**

`src/server/claude-session-scanner.ts`:

```ts
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { ParsedClaudeSession } from "./claude-session-types"
import { parseClaudeSessionFile } from "./claude-session-parser"

export function scanClaudeSessions(homeDir: string = homedir()): ParsedClaudeSession[] {
  const projectsDir = path.join(homeDir, ".claude", "projects")
  if (!existsSync(projectsDir)) return []

  const sessions: ParsedClaudeSession[] = []
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const projDir = path.join(projectsDir, entry.name)

    for (const file of readdirSync(projDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue
      const parsed = parseClaudeSessionFile(path.join(projDir, file.name))
      if (parsed) sessions.push(parsed)
    }
  }

  return sessions
}
```

**Step 3: Run — PASS.**

```bash
bun test src/server/claude-session-scanner.test.ts
```

**Step 4: Commit.**

```bash
git add src/server/claude-session-scanner.ts src/server/claude-session-scanner.test.ts
git commit -m "feat(import): scan ~/.claude/projects for session files"
```

---

## Task 6: Importer orchestrator — dedup + event emission

**Files:**
- Create: `src/server/claude-session-importer.ts`
- Create: `src/server/claude-session-importer.test.ts`

This module glues scan → parse → map → store. Dedup on `chat.sessionToken === sessionId`. Skip sessions whose `cwd` doesn't exist on disk.

**Step 1: Failing test using real `EventStore` with temp data dir.**

```ts
import { describe, expect, test, beforeEach } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import { importClaudeSessions } from "./claude-session-importer"

function fresh() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "kanna-data-"))
  const homeDir = mkdtempSync(path.join(tmpdir(), "kanna-home-"))
  const realProj = mkdtempSync(path.join(tmpdir(), "kanna-proj-"))
  return { dataDir, homeDir, realProj, cleanup: () => {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(realProj, { recursive: true, force: true })
  } }
}

function seedSession(homeDir: string, realProj: string, sessionId: string) {
  const folderName = realProj.replace(/\//g, "-")
  const projDir = path.join(homeDir, ".claude", "projects", folderName)
  mkdirSync(projDir, { recursive: true })
  const line1 = JSON.stringify({
    type: "user", uuid: "u1", sessionId, cwd: realProj,
    timestamp: "2026-04-20T10:00:00.000Z",
    message: { role: "user", content: "hi" },
  })
  const line2 = JSON.stringify({
    type: "assistant", uuid: "a1", sessionId, cwd: realProj,
    timestamp: "2026-04-20T10:00:01.000Z",
    message: { role: "assistant", id: "m1", content: [{ type: "text", text: "hello" }] },
  })
  writeFileSync(path.join(projDir, `${sessionId}.jsonl`), `${line1}\n${line2}\n`, "utf8")
}

describe("importClaudeSessions", () => {
  test("imports a session, creating project + chat + messages", async () => {
    const ctx = fresh()
    try {
      seedSession(ctx.homeDir, ctx.realProj, "sess-aaa")
      const store = new EventStore({ dataDir: ctx.dataDir })
      await store.initialize()

      const result = await importClaudeSessions({ store, homeDir: ctx.homeDir })

      expect(result.imported).toBe(1)
      expect(result.skipped).toBe(0)
      expect(result.failed).toBe(0)

      const chats = [...store.state.chatsById.values()].filter((c) => !c.deletedAt)
      expect(chats.length).toBe(1)
      expect(chats[0].sessionToken).toBe("sess-aaa")
      expect(chats[0].provider).toBe("claude")
      expect(store.getMessages(chats[0].id).length).toBe(2)
    } finally {
      ctx.cleanup()
    }
  })

  test("re-import is a no-op (dedup by sessionToken)", async () => {
    const ctx = fresh()
    try {
      seedSession(ctx.homeDir, ctx.realProj, "sess-bbb")
      const store = new EventStore({ dataDir: ctx.dataDir })
      await store.initialize()

      await importClaudeSessions({ store, homeDir: ctx.homeDir })
      const second = await importClaudeSessions({ store, homeDir: ctx.homeDir })

      expect(second.imported).toBe(0)
      expect(second.skipped).toBe(1)
    } finally {
      ctx.cleanup()
    }
  })

  test("skips session whose cwd no longer exists", async () => {
    const ctx = fresh()
    try {
      seedSession(ctx.homeDir, ctx.realProj, "sess-ccc")
      rmSync(ctx.realProj, { recursive: true, force: true })
      const store = new EventStore({ dataDir: ctx.dataDir })
      await store.initialize()

      const result = await importClaudeSessions({ store, homeDir: ctx.homeDir })
      expect(result.imported).toBe(0)
      expect(result.failed).toBe(1)
    } finally {
      ctx.cleanup()
    }
  })
})
```

Check `EventStore` constructor shape in `src/server/event-store.ts` (look for `constructor(...)` near line 120-180) — if it takes a different shape, adjust the test. If `initialize()` isn't the entry, use whatever the existing code calls on startup (see `src/server/server.ts`).

Run: expect FAIL — module missing.

**Step 2: Implement importer.**

`src/server/claude-session-importer.ts`:

```ts
import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import type { EventStore } from "./event-store"
import { mapClaudeRecordsToEntries } from "./claude-session-mapper"
import { scanClaudeSessions } from "./claude-session-scanner"
import type { ParsedClaudeSession } from "./claude-session-types"

export interface ImportClaudeSessionsResult {
  imported: number
  skipped: number
  failed: number
  newProjects: number
}

export interface ImportClaudeSessionsArgs {
  store: EventStore
  homeDir?: string
  onProgress?: (update: { scanned: number; imported: number }) => void
}

function cwdExists(cwd: string): boolean {
  if (!cwd) return false
  try {
    return statSync(cwd).isDirectory()
  } catch {
    return false
  }
}

function deriveTitle(session: ParsedClaudeSession): string {
  for (const record of session.records) {
    if (record.type !== "user") continue
    const content = (record as { message?: { content?: unknown } }).message?.content
    if (typeof content === "string") {
      const trimmed = content.trim()
      if (trimmed) return trimmed.slice(0, 60)
    }
  }
  return "Imported session"
}

export async function importClaudeSessions(args: ImportClaudeSessionsArgs): Promise<ImportClaudeSessionsResult> {
  const { store, homeDir = homedir(), onProgress } = args
  const sessions = scanClaudeSessions(homeDir)

  let imported = 0
  let skipped = 0
  let failed = 0
  let newProjects = 0

  const existingSessionTokens = new Set<string>()
  for (const chat of store.state.chatsById.values()) {
    if (chat.deletedAt) continue
    if (chat.sessionToken) existingSessionTokens.add(chat.sessionToken)
  }

  let scanned = 0
  for (const session of sessions) {
    scanned += 1
    if (onProgress) onProgress({ scanned, imported })

    if (existingSessionTokens.has(session.sessionId)) {
      skipped += 1
      continue
    }
    if (!cwdExists(session.cwd)) {
      failed += 1
      continue
    }

    const entries = mapClaudeRecordsToEntries(session.records)
    if (entries.length === 0) {
      skipped += 1
      continue
    }

    try {
      const projectBefore = store.state.projectIdsByPath.get(session.cwd)
      const project = await store.openProject(session.cwd)
      if (!projectBefore) newProjects += 1

      const chat = await store.createChat(project.id)
      await store.setChatProvider(chat.id, "claude")
      await store.renameChat(chat.id, deriveTitle(session))

      for (const entry of entries) {
        await store.appendMessage(chat.id, entry)
      }

      await store.setSessionToken(chat.id, session.sessionId)
      existingSessionTokens.add(session.sessionId)
      imported += 1
      if (onProgress) onProgress({ scanned, imported })
    } catch (error) {
      console.error("[kanna/import] failed to import session", session.filePath, error)
      failed += 1
    }
  }

  return { imported, skipped, failed, newProjects }
}
```

**Step 3: Run — PASS.**

```bash
bun test src/server/claude-session-importer.test.ts
```

If `EventStore` constructor signature differs, read `src/server/event-store.ts` around the constructor definition (search for `class EventStore`, then `constructor(`). Adjust the test setup to match (e.g. `new EventStore(dataDir)` vs `new EventStore({ dataDir })`).

**Step 4: Commit.**

```bash
git add src/server/claude-session-importer.ts src/server/claude-session-importer.test.ts
git commit -m "feat(import): orchestrate import with dedup and event emission"
```

---

## Task 7: Add WS protocol command

**Files:**
- Modify: `src/shared/protocol.ts`

**Step 1: Add the command and progress event to the union.**

In `ClientCommand` union, add:

```ts
  | { type: "sessions.importClaude" }
```

Keep the rest untouched. Place the new variant near `project.create` for locality.

**Step 2: Typecheck.**

```bash
bun run tsc --noEmit
```

Expected: no errors. If there are exhaustive switch statements over `ClientCommand` (search `ws-router.ts` for `switch (command.type)`), TypeScript will flag missing case — we handle that in Task 8, so a failure here is only acceptable in `ws-router.ts`.

**Step 3: Commit.**

```bash
git add src/shared/protocol.ts
git commit -m "feat(import): add sessions.importClaude WS command"
```

---

## Task 8: Wire WS handler

**Files:**
- Modify: `src/server/ws-router.ts`

**Step 1: Add import.**

Near the top of `ws-router.ts`, add:

```ts
import { importClaudeSessions } from "./claude-session-importer"
```

**Step 2: Add the command case.**

Find the big `switch (command.type)` (look for `case "chat.create"` around line 802). Add a new case near `project.create`:

```ts
        case "sessions.importClaude": {
          const result = await importClaudeSessions({ store })
          if (result.newProjects > 0) {
            await refreshDiscovery()
          }
          send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result })
          await broadcastSidebarToAll()
          break
        }
```

If the existing file has a helper named `broadcastSidebarToAll` or similar, use it. Otherwise look for how `chat.create` or `project.create` broadcasts sidebar updates (`broadcastChatAndSidebar` or `broadcastSidebar`) and mirror it. Grep first:

```bash
grep -n "broadcastSidebar\|broadcastChatAndSidebar\|refreshDiscovery" src/server/ws-router.ts
```

Use whichever matches the existing pattern for sidebar invalidation.

**Step 3: Typecheck + test.**

```bash
bun run tsc --noEmit
bun test
```

Expected: all green (prior tests should still pass; no new server test added here).

**Step 4: Commit.**

```bash
git add src/server/ws-router.ts
git commit -m "feat(import): handle sessions.importClaude over WebSocket"
```

---

## Task 9: Client state hook wiring

**Files:**
- Modify: `src/client/app/useKannaState.ts`

The hook exposes WS command senders. Add `importClaudeSessions` that sends the new command and returns the ack result.

**Step 1: Locate the existing command-sender pattern.**

```bash
grep -n "project.create\|chat.create" src/client/app/useKannaState.ts
```

Copy the style used by `project.create`.

**Step 2: Add the sender.**

Inside the hook, near the other command senders:

```ts
  const importClaudeSessions = useCallback(async () => {
    const result = await sendCommand({ type: "sessions.importClaude" })
    return result as { imported: number; skipped: number; failed: number; newProjects: number }
  }, [sendCommand])
```

Return `importClaudeSessions` from the hook's return object (add it alongside `createProject`, `removeProject`, etc.).

**Step 3: Typecheck.**

```bash
bun run tsc --noEmit
```

**Step 4: Commit.**

```bash
git add src/client/app/useKannaState.ts
git commit -m "feat(import): add importClaudeSessions state hook"
```

---

## Task 10: Sidebar Import button

**Files:**
- Modify: `src/client/app/KannaSidebar.tsx` (or wherever Add Project button lives — confirm first)
- Modify: `src/client/app/App.tsx` if needed to pass the handler

**Step 1: Locate Add Project button.**

```bash
grep -rn "onOpenAddProjectModal\|NewProjectModal" src/client
```

The sidebar renders the Add Project button (likely as an icon-only button in a header row). Add a sibling button.

**Step 2: Add Import button.**

Import a suitable icon from `lucide-react`:

```ts
import { Download } from "lucide-react"
```

Inside the sidebar header, next to the Add Project button, add:

```tsx
<button
  type="button"
  className="<same classes as Add Project button>"
  title="Import Claude Code sessions"
  aria-label="Import Claude Code sessions"
  disabled={isImporting}
  onClick={handleImportClick}
>
  <Download size={16} />
</button>
```

Wire `handleImportClick`:

```ts
const [isImporting, setIsImporting] = useState(false)

const handleImportClick = async () => {
  if (isImporting) return
  const confirmed = window.confirm(
    "Scan ~/.claude/projects/ and import all sessions into Kanna? Already-imported sessions are skipped.",
  )
  if (!confirmed) return
  setIsImporting(true)
  try {
    const result = await importClaudeSessions()
    alert(
      `Imported ${result.imported}, skipped ${result.skipped}, failed ${result.failed}.`
      + (result.newProjects > 0 ? ` (${result.newProjects} new projects)` : ""),
    )
  } catch (error) {
    console.error("[kanna/import] failed", error)
    alert("Import failed. See console for details.")
  } finally {
    setIsImporting(false)
  }
}
```

`importClaudeSessions` arrives from `useKannaState` — pass it through props if the sidebar doesn't already consume the hook directly (mirror how Add Project is wired).

**Step 3: Typecheck + build.**

```bash
bun run check
```

Expected: success.

**Step 4: Commit.**

```bash
git add src/client/app/KannaSidebar.tsx src/client/app/App.tsx
git commit -m "feat(import): add Import button to sidebar header"
```

> Note: `window.confirm` / `window.alert` are used for minimal friction. Swap to a proper modal/toast later if the rest of the app uses a toast system — confirm by searching for existing toast components before rewriting.

---

## Task 11: Manual verification

**Files:** none.

**Step 1: Build + run dev.**

```bash
bun run dev
```

Visit `http://localhost:5174`.

**Step 2: Verify preconditions.**

```bash
ls ~/.claude/projects/ | head
```

Expect at least one project directory with `.jsonl` files. If empty, copy one of your own sessions or create a minimal fixture before testing.

**Step 3: Click Import.**

- Confirm dialog appears
- After accept, alert shows `Imported N, skipped 0, failed 0`
- Sidebar refreshes — imported chats appear grouped under their project (project auto-created if needed)
- Open an imported chat — transcript preloads (user messages, assistant text, tool calls render correctly)

**Step 4: Verify dedup.**

- Click Import again
- Expect `Imported 0, skipped N`

**Step 5: Verify resume.**

- Open an imported chat
- Send a follow-up message
- Inspect `~/.claude/projects/<folder>/<same-session-id>.jsonl` — new lines should be appended by the Agent SDK (no new JSONL file created)

**Step 6: Verify edge case — missing project.**

- Temporarily rename a project directory whose sessions you've not imported
- Click Import again — that session should count toward `failed` without crashing

No commit for this task.

---

## Task 12: Docs update

**Files:**
- Modify: `README.md`

**Step 1: Add import to Features section.**

Under `## Features`, insert a bullet:

```markdown
- **Bulk import Claude Code sessions** — one-click import of existing `~/.claude/projects/` sessions with full transcript and seamless resume via the Claude Agent SDK
```

**Step 2: Commit.**

```bash
git add README.md
git commit -m "docs: mention Claude Code session import feature"
```

---

## Task 13: Final check

```bash
bun run check               # typecheck + build
bun test                    # all unit tests
git log --oneline           # verify commit history is clean and linear
```

All green → feature is ready for PR.

---

## Deferred / explicitly out of scope

- Process scan / live CLI session detection
- Separate "CLI sessions" sidebar section before import
- Codex session import (Codex uses a different format in `~/.codex/sessions/`)
- Bulk undo / unimport (use per-chat delete)
- Progress streaming via WS events (single ack is sufficient for v1)
- Toast-based progress UI (using `confirm`/`alert` for v1; switch to in-app toasts if the codebase adds them)

## Skills referenced

- `superpowers:executing-plans` — to run this plan task-by-task
- `superpowers:subagent-driven-development` — if executing with fresh subagents per task
- `superpowers:test-driven-development` — each task follows red-green-commit
- `superpowers:verification-before-completion` — Task 11 gates completion on browser verification
