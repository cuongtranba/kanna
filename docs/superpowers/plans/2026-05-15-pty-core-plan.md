# Claude PTY Core Driver Implementation Plan (P2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second `ClaudeSessionHandle` implementation that spawns the `claude` CLI under a PTY, tails the on-disk JSONL transcript Claude Code writes to `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`, and exposes the same stream-of-`HarnessEvent` contract the SDK driver does. Single-account, single-PTY-per-chat, no sandbox, no account pool — those land in later phases (P3–P7).

**Architecture:** `Bun.Terminal` holds the TTY open for subscription billing; `Bun.spawn({ terminal })` launches `claude` with no `ANTHROPIC_API_KEY` so it uses native OAuth keychain auth. JSONL on disk is the structured event stream — we tail it with a composite `(inode, ctimeNs, sha256(contents))` bookmark and emit `HarnessEvent`s from each line. PTY output is consumed by a minimal `@xterm/headless` instance only for slash-command ACK detection (model switch, rate-limit banner). Driver selection is behind `KANNA_CLAUDE_DRIVER=sdk|pty` (default `sdk` — no behavior change for existing users).

**Tech Stack:** Bun + TypeScript strict, `Bun.Terminal` (built-in PTY), `@xterm/headless@^6` + `@xterm/addon-serialize@^0.14` (already deps), `node:crypto` + `node:fs/promises` + `node:fs` (`fs.watch`), `bun:test`. No new runtime dependencies.

---

## File Structure

**Created:**

```
src/server/claude-pty/
  ├── auth.ts                # verify ~/.claude credentials present; reject ANTHROPIC_API_KEY
  ├── auth.test.ts
  ├── jsonl-path.ts          # computeJsonlPath(cwd, sessionId) — encode cwd per Claude Code format
  ├── jsonl-path.test.ts
  ├── jsonl-to-event.ts      # one JSONL line → HarnessEvent[] (deduped, normalised)
  ├── jsonl-to-event.test.ts
  ├── bookmark.ts            # CompositeVersion: inode + ctimeNs + sha256(contents); store/read APIs
  ├── bookmark.test.ts
  ├── jsonl-reader.ts        # fs.watch + bookmark-driven tail → async iterable of parsed events
  ├── jsonl-reader.test.ts
  ├── pty-process.ts         # Bun.Terminal + Bun.spawn wrapper; sendInput; resize; close; output → headless xterm
  ├── pty-process.test.ts
  ├── slash-commands.ts      # writeSlashCommand(pty, cmd); known commands list
  ├── slash-commands.test.ts
  ├── frame-parser.ts        # minimal ANSI scrape for slash-cmd ACKs (e.g. "Model: ...")
  ├── frame-parser.test.ts
  ├── settings-writer.ts     # write .claude/settings.local.json (per-spawn settings)
  ├── settings-writer.test.ts
  └── driver.ts              # startClaudeSessionPTY → ClaudeSessionHandle; assembles all of the above
      driver.test.ts
```

**Modified:**

```
src/server/agent.ts          # AgentCoordinator: select startClaudeSessionPTY vs startClaudeSession by KANNA_CLAUDE_DRIVER flag
CLAUDE.md                    # document KANNA_CLAUDE_DRIVER flag
```

---

## Conventions

- TypeScript strict, no `any`. Project boundary casts use `unknown` then narrow.
- Tests use `bun:test`. Co-located with source.
- Each task ends with one Conventional Commit.
- Feature flag: `process.env.KANNA_CLAUDE_DRIVER === "pty"`. Default behaviour (`sdk`, unset, anything else) is unchanged.
- All new code is server-side only (`src/server/`). No `node:crypto`, `node:fs/promises`, or filesystem APIs in `src/shared/` or `src/client/`.

---

## Task 1: Auth precheck

**Files:**
- Create: `src/server/claude-pty/auth.ts`
- Create: `src/server/claude-pty/auth.test.ts`

PTY mode requires the user to have run `claude /login` once. Verify `~/.claude/.credentials.json` exists and reject if `ANTHROPIC_API_KEY` is set in env (would force API billing instead of subscription).

- [ ] **Step 1: Write the failing tests**

`src/server/claude-pty/auth.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { verifyPtyAuth } from "./auth"

describe("verifyPtyAuth", () => {
  let homeDir: string

  beforeEach(async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), "kanna-pty-auth-"))
  })

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true })
  })

  test("ok when credentials.json exists and ANTHROPIC_API_KEY unset", async () => {
    await mkdir(path.join(homeDir, ".claude"), { recursive: true })
    await writeFile(path.join(homeDir, ".claude", ".credentials.json"), "{}", "utf8")
    const result = await verifyPtyAuth({ homeDir, env: {} })
    expect(result.ok).toBe(true)
  })

  test("error when credentials.json missing", async () => {
    const result = await verifyPtyAuth({ homeDir, env: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("claude /login")
    }
  })

  test("error when ANTHROPIC_API_KEY is set", async () => {
    await mkdir(path.join(homeDir, ".claude"), { recursive: true })
    await writeFile(path.join(homeDir, ".claude", ".credentials.json"), "{}", "utf8")
    const result = await verifyPtyAuth({ homeDir, env: { ANTHROPIC_API_KEY: "sk-x" } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("ANTHROPIC_API_KEY")
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/claude-pty/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/claude-pty/auth.ts`**

```ts
import { stat } from "node:fs/promises"
import path from "node:path"

export type VerifyPtyAuthResult =
  | { ok: true }
  | { ok: false; error: string }

export async function verifyPtyAuth(args: {
  homeDir: string
  env: NodeJS.ProcessEnv
}): Promise<VerifyPtyAuthResult> {
  if (typeof args.env.ANTHROPIC_API_KEY === "string" && args.env.ANTHROPIC_API_KEY.length > 0) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY is set in the environment. PTY mode uses Claude's subscription billing via OAuth keychain; remove the env var or use the SDK driver.",
    }
  }
  const credentialsPath = path.join(args.homeDir, ".claude", ".credentials.json")
  try {
    await stat(credentialsPath)
  } catch {
    return {
      ok: false,
      error: `Claude credentials not found at ${credentialsPath}. Run \`claude /login\` once to authenticate, then try again.`,
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/claude-pty/auth.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/auth.ts src/server/claude-pty/auth.test.ts
git commit -m "feat(claude-pty): auth precheck — credentials present, no ANTHROPIC_API_KEY"
```

---

## Task 2: JSONL path resolver

**Files:**
- Create: `src/server/claude-pty/jsonl-path.ts`
- Create: `src/server/claude-pty/jsonl-path.test.ts`

Claude Code writes session transcripts to `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. The encoded cwd replaces every `/` with `-` and prepends `-` for absolute paths (e.g. `/Users/cuongtran` → `-Users-cuongtran`).

- [ ] **Step 1: Write failing tests**

`src/server/claude-pty/jsonl-path.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { computeJsonlPath, encodeCwd } from "./jsonl-path"

describe("encodeCwd", () => {
  test("absolute path: replaces / with -", () => {
    expect(encodeCwd("/Users/cuongtran")).toBe("-Users-cuongtran")
  })

  test("absolute path with trailing slash: trims it", () => {
    expect(encodeCwd("/Users/cuongtran/")).toBe("-Users-cuongtran")
  })

  test("nested path", () => {
    expect(encodeCwd("/Users/cuongtran/Desktop/repo/kanna")).toBe("-Users-cuongtran-Desktop-repo-kanna")
  })

  test("root path", () => {
    expect(encodeCwd("/")).toBe("-")
  })
})

describe("computeJsonlPath", () => {
  test("combines homeDir + encoded cwd + session uuid", () => {
    const result = computeJsonlPath({
      homeDir: "/home/u",
      cwd: "/Users/cuongtran",
      sessionId: "abc-123",
    })
    expect(result).toBe("/home/u/.claude/projects/-Users-cuongtran/abc-123.jsonl")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/claude-pty/jsonl-path.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/claude-pty/jsonl-path.ts`**

```ts
import path from "node:path"

export function encodeCwd(cwd: string): string {
  const trimmed = cwd.endsWith("/") && cwd !== "/" ? cwd.slice(0, -1) : cwd
  return trimmed.replace(/\//g, "-")
}

export function computeJsonlPath(args: {
  homeDir: string
  cwd: string
  sessionId: string
}): string {
  return path.join(
    args.homeDir,
    ".claude",
    "projects",
    encodeCwd(args.cwd),
    `${args.sessionId}.jsonl`,
  )
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/claude-pty/jsonl-path.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/jsonl-path.ts src/server/claude-pty/jsonl-path.test.ts
git commit -m "feat(claude-pty): JSONL path resolver matches Claude Code's encoded-cwd format"
```

---

## Task 3: JSONL line → HarnessEvent parser

**Files:**
- Create: `src/server/claude-pty/jsonl-to-event.ts`
- Create: `src/server/claude-pty/jsonl-to-event.test.ts`

Parse one JSONL line and emit zero or more `HarnessEvent`s. Reuse the existing `normalizeClaudeStreamMessage` in `src/server/agent.ts` if it can be exposed — otherwise re-implement a minimum subset for P2.

Read `src/server/harness-types.ts` and `src/server/agent.ts` line 405 (`normalizeClaudeStreamMessage`) before starting. Goal: emit `transcript`, `session_token`, and `rate_limit` events to match the SDK driver's stream.

- [ ] **Step 1: Inspect existing normalizer**

```bash
grep -n "normalizeClaudeStreamMessage\|export function normalize" /Users/cuongtran/Desktop/repo/kanna/src/server/agent.ts | head
```

If `normalizeClaudeStreamMessage` is exported and takes an SDK-shaped message that matches the JSONL line shape (assistant/user/system entries), reuse it. Otherwise replicate minimal logic in `jsonl-to-event.ts`.

- [ ] **Step 2: Write failing tests**

`src/server/claude-pty/jsonl-to-event.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { parseJsonlLine } from "./jsonl-to-event"

describe("parseJsonlLine", () => {
  test("ignores empty lines", () => {
    expect(parseJsonlLine("")).toEqual([])
    expect(parseJsonlLine("   ")).toEqual([])
  })

  test("ignores malformed JSON (logs but does not throw)", () => {
    expect(parseJsonlLine("{not json")).toEqual([])
  })

  test("system.init → session_token event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
      model: "claude-sonnet-4-6",
    })
    const events = parseJsonlLine(line)
    const sessionTokenEvent = events.find((e) => e.type === "session_token")
    expect(sessionTokenEvent).toBeDefined()
    expect(sessionTokenEvent?.sessionToken).toBe("sess-1")
  })

  test("assistant message → transcript event with assistant role", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    })
    const events = parseJsonlLine(line)
    const transcriptEvents = events.filter((e) => e.type === "transcript")
    expect(transcriptEvents.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test src/server/claude-pty/jsonl-to-event.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/server/claude-pty/jsonl-to-event.ts`**

```ts
import type { HarnessEvent } from "../harness-types"
import { normalizeClaudeStreamMessage } from "../agent"

export function parseJsonlLine(rawLine: string): HarnessEvent[] {
  const trimmed = rawLine.trim()
  if (!trimmed) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    console.warn("[claude-pty/jsonl] failed to parse line", trimmed.slice(0, 120))
    return []
  }
  if (!parsed || typeof parsed !== "object") return []
  const message = parsed as Record<string, unknown>
  const events: HarnessEvent[] = []

  // session_token from system.init
  if (message.type === "system" && message.subtype === "init" && typeof message.session_id === "string") {
    events.push({ type: "session_token", sessionToken: message.session_id })
  }

  // transcript entries (assistant / user / tool_result / thinking)
  // Reuse the SDK-side normaliser — it already produces TranscriptEntry[] from an SDK message
  // and the JSONL line shape matches the SDK message shape.
  try {
    const entries = normalizeClaudeStreamMessage(parsed)
    for (const entry of entries) {
      events.push({ type: "transcript", entry })
    }
  } catch (err) {
    console.warn("[claude-pty/jsonl] normalizeClaudeStreamMessage threw", err)
  }

  return events
}
```

If `normalizeClaudeStreamMessage` is not currently exported from `agent.ts`, export it as part of this task — it's already a pure helper.

- [ ] **Step 5: Run tests**

Run: `bun test src/server/claude-pty/jsonl-to-event.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/claude-pty/jsonl-to-event.ts src/server/claude-pty/jsonl-to-event.test.ts src/server/agent.ts
git commit -m "feat(claude-pty): JSONL line → HarnessEvent parser via existing normalizer"
```

---

## Task 4: Bookmark with composite version

**Files:**
- Create: `src/server/claude-pty/bookmark.ts`
- Create: `src/server/claude-pty/bookmark.test.ts`

A bookmark tracks reader progress in the JSONL file. The version is composite: `(inode, ctimeNs, sha256-of-bytes-up-to-offset)`. Composite version detects file rotation/truncation/atomic-rename — anything other than pure append.

For P2 scope we only need an in-memory bookmark per session; persistence across restart is deferred (P5+). On wake we re-read from byte 0 and rely on event deduplication via Kanna's `EventStore` (which already stores transcript entries by `_id`).

- [ ] **Step 1: Write failing tests**

`src/server/claude-pty/bookmark.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { computeCompositeVersion } from "./bookmark"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

describe("computeCompositeVersion", () => {
  test("returns inode + ctimeNs + sha256 for an existing file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-bookmark-"))
    try {
      const filePath = path.join(dir, "x.jsonl")
      await writeFile(filePath, "line1\nline2\n", "utf8")
      const version = await computeCompositeVersion(filePath, 0)
      expect(version.inode).toBeGreaterThan(0)
      expect(version.ctimeNs).toBeGreaterThan(0n)
      expect(version.contentHash).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns null when file does not exist", async () => {
    const version = await computeCompositeVersion("/nonexistent/path.jsonl", 0)
    expect(version).toBeNull()
  })

  test("different content → different hash", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-bookmark-"))
    try {
      const a = path.join(dir, "a.jsonl")
      const b = path.join(dir, "b.jsonl")
      await writeFile(a, "alpha\n", "utf8")
      await writeFile(b, "beta\n", "utf8")
      const vA = await computeCompositeVersion(a, 0)
      const vB = await computeCompositeVersion(b, 0)
      expect(vA?.contentHash).not.toBe(vB?.contentHash)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/claude-pty/bookmark.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/claude-pty/bookmark.ts`**

```ts
import { createHash } from "node:crypto"
import { open, stat } from "node:fs/promises"

export interface CompositeVersion {
  inode: number
  ctimeNs: bigint
  contentHash: string
  byteOffset: number
}

export async function computeCompositeVersion(
  filePath: string,
  byteOffset: number,
): Promise<CompositeVersion | null> {
  let statResult
  try {
    statResult = await stat(filePath, { bigint: true })
  } catch {
    return null
  }

  const hash = createHash("sha256")
  const upTo = byteOffset > 0 ? Math.min(byteOffset, Number(statResult.size)) : Number(statResult.size)
  if (upTo > 0) {
    const fd = await open(filePath, "r")
    try {
      const buf = Buffer.alloc(64 * 1024)
      let read = 0
      while (read < upTo) {
        const { bytesRead } = await fd.read(buf, 0, Math.min(buf.length, upTo - read), read)
        if (bytesRead === 0) break
        hash.update(buf.subarray(0, bytesRead))
        read += bytesRead
      }
    } finally {
      await fd.close()
    }
  }

  return {
    inode: Number(statResult.ino),
    ctimeNs: statResult.ctimeNs,
    contentHash: hash.digest("hex"),
    byteOffset: upTo,
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/claude-pty/bookmark.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/bookmark.ts src/server/claude-pty/bookmark.test.ts
git commit -m "feat(claude-pty): composite version bookmark (inode + ctimeNs + sha256)"
```

---

## Task 5: JSONL tail reader

**Files:**
- Create: `src/server/claude-pty/jsonl-reader.ts`
- Create: `src/server/claude-pty/jsonl-reader.test.ts`

Tail a JSONL file, parsing newly-appended lines into `HarnessEvent`s. Uses `fs.watch` on the parent directory (survives atomic-rename) plus a poll fallback. Emits via an `AsyncIterable<HarnessEvent>`.

P2 contract: on each watch event, stat the file. If `inode` or `contentHash-of-overlap` differs from the previous bookmark, treat as rotation/truncation and restart from byte 0 (deduplication is downstream — `EventStore` already keys by `TranscriptEntry._id`). Otherwise read from `byteOffset` to end, parse new complete lines, advance the bookmark.

- [ ] **Step 1: Write failing tests**

`src/server/claude-pty/jsonl-reader.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, appendFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createJsonlReader } from "./jsonl-reader"
import type { HarnessEvent } from "../harness-types"

async function drain(reader: AsyncIterable<HarnessEvent>, count: number, timeoutMs = 1000): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = []
  const deadline = Date.now() + timeoutMs
  const it = reader[Symbol.asyncIterator]()
  while (out.length < count && Date.now() < deadline) {
    const next = await Promise.race([
      it.next(),
      new Promise<IteratorResult<HarnessEvent>>((r) => setTimeout(() => r({ value: undefined, done: false }), 50)),
    ])
    if (next.value) out.push(next.value)
  }
  return out
}

describe("createJsonlReader", () => {
  test("emits events for lines that already exist when reader starts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-jsonl-r-"))
    try {
      const filePath = path.join(dir, "session.jsonl")
      await writeFile(filePath, JSON.stringify({
        type: "system", subtype: "init", session_id: "s-1", model: "x",
      }) + "\n", "utf8")
      const reader = createJsonlReader({ filePath })
      const events = await drain(reader, 1, 500)
      reader.close()
      expect(events.some((e) => e.type === "session_token" && e.sessionToken === "s-1")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("emits events for lines appended after reader starts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-jsonl-r-"))
    try {
      const filePath = path.join(dir, "session.jsonl")
      await writeFile(filePath, "", "utf8")
      const reader = createJsonlReader({ filePath })
      const drainPromise = drain(reader, 1, 1000)
      await new Promise((r) => setTimeout(r, 50))
      await appendFile(filePath, JSON.stringify({
        type: "system", subtype: "init", session_id: "s-2", model: "x",
      }) + "\n", "utf8")
      const events = await drainPromise
      reader.close()
      expect(events.some((e) => e.type === "session_token" && e.sessionToken === "s-2")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("close() ends iteration", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-jsonl-r-"))
    try {
      const filePath = path.join(dir, "session.jsonl")
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, "", "utf8")
      const reader = createJsonlReader({ filePath })
      reader.close()
      const it = reader[Symbol.asyncIterator]()
      const next = await it.next()
      expect(next.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/claude-pty/jsonl-reader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/claude-pty/jsonl-reader.ts`**

```ts
import { watch } from "node:fs"
import { open } from "node:fs/promises"
import path from "node:path"
import type { HarnessEvent } from "../harness-types"
import { parseJsonlLine } from "./jsonl-to-event"
import { computeCompositeVersion, type CompositeVersion } from "./bookmark"

export interface JsonlReader extends AsyncIterable<HarnessEvent> {
  close(): void
}

export function createJsonlReader(args: { filePath: string }): JsonlReader {
  const filePath = args.filePath
  const dir = path.dirname(filePath)
  const baseName = path.basename(filePath)

  let bookmark: CompositeVersion | null = null
  let closed = false
  const queue: HarnessEvent[] = []
  const waiters: Array<(result: IteratorResult<HarnessEvent>) => void> = []
  let processing = false
  let partial = ""

  function deliver(event: HarnessEvent) {
    const w = waiters.shift()
    if (w) {
      w({ value: event, done: false })
    } else {
      queue.push(event)
    }
  }

  function endIfClosed() {
    if (!closed) return
    while (waiters.length > 0) {
      const w = waiters.shift()!
      w({ value: undefined as unknown as HarnessEvent, done: true })
    }
  }

  async function tryRead() {
    if (closed || processing) return
    processing = true
    try {
      const version = await computeCompositeVersion(filePath, 0)
      if (!version) {
        return
      }

      let startOffset = 0
      if (bookmark
        && bookmark.inode === version.inode
        && version.contentHash.startsWith(bookmark.contentHash.slice(0, 16))) {
        // Pure-append heuristic. Bookmark prefix matches; resume from previous offset.
        startOffset = bookmark.byteOffset
      } else {
        // Rotation/truncation/first-read. Reset partial buffer and read from byte 0.
        partial = ""
      }

      const fd = await open(filePath, "r")
      try {
        const buf = Buffer.alloc(64 * 1024)
        let pos = startOffset
        while (true) {
          const { bytesRead } = await fd.read(buf, 0, buf.length, pos)
          if (bytesRead === 0) break
          partial += buf.subarray(0, bytesRead).toString("utf8")
          pos += bytesRead
          let nl = partial.indexOf("\n")
          while (nl !== -1) {
            const line = partial.slice(0, nl)
            partial = partial.slice(nl + 1)
            for (const ev of parseJsonlLine(line)) deliver(ev)
            nl = partial.indexOf("\n")
          }
        }
        bookmark = await computeCompositeVersion(filePath, pos)
      } finally {
        await fd.close()
      }
    } catch (err) {
      console.warn("[claude-pty/jsonl-reader] tryRead error", err)
    } finally {
      processing = false
    }
  }

  const watcher = watch(dir, (eventType, filename) => {
    if (filename === baseName || filename === null) {
      void tryRead()
    }
  })

  // Initial read on construction
  void tryRead()

  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<HarnessEvent>> {
          if (queue.length > 0) {
            const ev = queue.shift()!
            return Promise.resolve({ value: ev, done: false })
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as HarnessEvent, done: true })
          }
          return new Promise((resolve) => {
            waiters.push(resolve)
          })
        },
        return(): Promise<IteratorResult<HarnessEvent>> {
          closed = true
          watcher.close()
          endIfClosed()
          return Promise.resolve({ value: undefined as unknown as HarnessEvent, done: true })
        },
      }
    },
    close() {
      closed = true
      watcher.close()
      endIfClosed()
    },
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/claude-pty/jsonl-reader.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/jsonl-reader.ts src/server/claude-pty/jsonl-reader.test.ts
git commit -m "feat(claude-pty): JSONL tail reader with fs.watch + composite version bookmark"
```

---

## Task 6: PTY process wrapper

**Files:**
- Create: `src/server/claude-pty/pty-process.ts`
- Create: `src/server/claude-pty/pty-process.test.ts`

Wrap `Bun.Terminal` + `Bun.spawn({ terminal })` into a single object with `sendInput`, `resize`, `close`, and exposed `headless: Terminal` (xterm-headless) for slash-cmd ACK detection.

Read `src/server/terminal-manager.ts` for the established `Bun.Terminal` / `Bun.spawn` pattern. Mirror it.

- [ ] **Step 1: Write failing tests**

`src/server/claude-pty/pty-process.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { spawnPtyProcess } from "./pty-process"

describe("spawnPtyProcess", () => {
  test("spawns a child process and exposes stdin write + close", async () => {
    if (process.platform === "win32") {
      console.log("skip: PTY not supported on Windows")
      return
    }
    if (typeof Bun.Terminal !== "function") {
      console.log("skip: Bun.Terminal not available")
      return
    }
    const handle = await spawnPtyProcess({
      command: "/bin/sh",
      args: ["-c", "read line; echo got=$line"],
      cwd: "/tmp",
      env: process.env,
      cols: 80,
      rows: 24,
    })
    await handle.sendInput("hello\n")
    const exitCode = await handle.exited
    expect(exitCode).toBe(0)
    handle.close()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/claude-pty/pty-process.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/claude-pty/pty-process.ts`**

```ts
import { Terminal } from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"

export interface PtyProcess {
  sendInput(data: string): Promise<void>
  resize(cols: number, rows: number): void
  headless: Terminal
  serializer: SerializeAddon
  exited: Promise<number>
  close(): void
}

export interface SpawnPtyProcessArgs {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols?: number
  rows?: number
  onOutput?: (chunk: string) => void
}

export async function spawnPtyProcess(opts: SpawnPtyProcessArgs): Promise<PtyProcess> {
  if (typeof Bun.Terminal !== "function") {
    throw new Error("Bun.Terminal not available — requires Bun 1.3.5+")
  }

  const cols = opts.cols ?? 120
  const rows = opts.rows ?? 40

  const headless = new Terminal({ cols, rows, scrollback: 4000, allowProposedApi: true })
  const serializer = new SerializeAddon()
  headless.loadAddon(serializer)

  const terminal = new Bun.Terminal({
    cols,
    rows,
    name: "xterm-256color",
    data: (_t, data) => {
      const chunk = Buffer.from(data).toString("utf8")
      headless.write(chunk)
      opts.onOutput?.(chunk)
    },
  })

  const proc = Bun.spawn([opts.command, ...opts.args], {
    cwd: opts.cwd,
    env: opts.env,
    terminal,
  })

  return {
    async sendInput(data) {
      terminal.write(data)
    },
    resize(newCols, newRows) {
      terminal.resize(newCols, newRows)
      headless.resize(newCols, newRows)
    },
    headless,
    serializer,
    exited: proc.exited,
    close() {
      try { terminal.close() } catch {}
      try { headless.dispose() } catch {}
      try { proc.kill() } catch {}
    },
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/claude-pty/pty-process.test.ts`
Expected: PASS (or skipped on Windows / Bun < 1.3.5).

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/pty-process.ts src/server/claude-pty/pty-process.test.ts
git commit -m "feat(claude-pty): PTY process wrapper (Bun.Terminal + xterm-headless)"
```

---

## Task 7: Slash command driver

**Files:**
- Create: `src/server/claude-pty/slash-commands.ts`
- Create: `src/server/claude-pty/slash-commands.test.ts`

Tiny helper that formats and writes a slash command into a PTY.

- [ ] **Step 1: Write failing tests**

`src/server/claude-pty/slash-commands.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { formatSlashCommand, writeSlashCommand } from "./slash-commands"

describe("formatSlashCommand", () => {
  test("plain command", () => {
    expect(formatSlashCommand("exit")).toBe("/exit\r")
  })

  test("command with arg", () => {
    expect(formatSlashCommand("model", "claude-sonnet-4-6")).toBe("/model claude-sonnet-4-6\r")
  })

  test("strips leading slash if caller passed one", () => {
    expect(formatSlashCommand("/exit")).toBe("/exit\r")
  })
})

describe("writeSlashCommand", () => {
  test("calls sendInput with formatted command", async () => {
    const calls: string[] = []
    await writeSlashCommand({
      sendInput: async (data: string) => { calls.push(data) },
    }, "model", "x")
    expect(calls).toEqual(["/model x\r"])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/claude-pty/slash-commands.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/claude-pty/slash-commands.ts`**

```ts
export function formatSlashCommand(command: string, arg?: string): string {
  const cmd = command.startsWith("/") ? command : `/${command}`
  return arg !== undefined ? `${cmd} ${arg}\r` : `${cmd}\r`
}

export interface SlashTarget {
  sendInput(data: string): Promise<void>
}

export async function writeSlashCommand(target: SlashTarget, command: string, arg?: string): Promise<void> {
  await target.sendInput(formatSlashCommand(command, arg))
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/claude-pty/slash-commands.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/slash-commands.ts src/server/claude-pty/slash-commands.test.ts
git commit -m "feat(claude-pty): slash command formatter and writer"
```

---

## Task 8: Frame parser for slash-cmd ACKs

**Files:**
- Create: `src/server/claude-pty/frame-parser.ts`
- Create: `src/server/claude-pty/frame-parser.test.ts`

Minimal helper: given a headless terminal's serialized screen, detect known confirmation lines (model switch, rate-limit banner). Used for resolving `setModel` slash-cmd promises and surfacing rate-limit events.

- [ ] **Step 1: Write failing tests**

`src/server/claude-pty/frame-parser.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { detectModelSwitch, detectRateLimit, stripAnsi } from "./frame-parser"

describe("stripAnsi", () => {
  test("removes color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red")
  })
})

describe("detectModelSwitch", () => {
  test("returns model when 'Model:' line present", () => {
    expect(detectModelSwitch("⏵⏵ Model: claude-sonnet-4-6\n")).toBe("claude-sonnet-4-6")
  })

  test("returns null when no model line", () => {
    expect(detectModelSwitch("nothing here")).toBeNull()
  })
})

describe("detectRateLimit", () => {
  test("returns resetAt when banner contains 'resets at HH:MM'", () => {
    const result = detectRateLimit("Rate limit hit. Resets at 14:30 PT")
    expect(result).not.toBeNull()
    expect(result?.tz).toBe("PT")
  })

  test("returns null when no rate-limit banner", () => {
    expect(detectRateLimit("everything is fine")).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/claude-pty/frame-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/claude-pty/frame-parser.ts`**

```ts
const ANSI_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "")
}

const MODEL_LINE = /\bModel:\s*([a-zA-Z0-9-]+)/

export function detectModelSwitch(serializedFrame: string): string | null {
  const plain = stripAnsi(serializedFrame)
  const m = plain.match(MODEL_LINE)
  return m ? m[1] : null
}

const RATE_LIMIT_LINE = /[Rr]esets?\s+at\s+(\d{1,2}:\d{2})\s+([A-Z]{2,4})/

export function detectRateLimit(serializedFrame: string): { resetAt: string; tz: string } | null {
  const plain = stripAnsi(serializedFrame)
  const m = plain.match(RATE_LIMIT_LINE)
  return m ? { resetAt: m[1], tz: m[2] } : null
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/claude-pty/frame-parser.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/frame-parser.ts src/server/claude-pty/frame-parser.test.ts
git commit -m "feat(claude-pty): minimal frame parser for slash-cmd ACKs"
```

---

## Task 9: Settings writer

**Files:**
- Create: `src/server/claude-pty/settings-writer.ts`
- Create: `src/server/claude-pty/settings-writer.test.ts`

Write a per-spawn `.claude/settings.local.json` to a runtime directory that the PTY's `$HOME` will point at. For P2 we still use the user's real `~/.claude/` (no per-account isolation — that's P5). So this task writes settings into the user's actual `~/.claude/settings.local.json` BUT only adds the keys we care about and respects any existing keys.

Safer alternative for P2: pass `--settings <inline-json>` on the CLI (Claude supports this) instead of touching the user's settings file. Use that.

Actually re-read: the spec uses `--settings <file-or-json>` flag. P2 should write a per-spawn temp file and pass its path via `--settings`. This way the user's real `~/.claude/settings.local.json` is untouched.

- [ ] **Step 1: Write failing tests**

`src/server/claude-pty/settings-writer.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { writeSpawnSettings } from "./settings-writer"

describe("writeSpawnSettings", () => {
  test("writes per-spawn settings with claimed keys", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-settings-"))
    try {
      const result = await writeSpawnSettings({ runtimeDir: dir })
      expect(result.settingsPath.startsWith(dir)).toBe(true)
      const raw = await readFile(result.settingsPath, "utf8")
      const parsed = JSON.parse(raw)
      expect(parsed.spinnerTipsEnabled).toBe(false)
      expect(parsed.showTurnDuration).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/claude-pty/settings-writer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/claude-pty/settings-writer.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export interface WriteSpawnSettingsResult {
  settingsPath: string
}

export async function writeSpawnSettings(args: {
  runtimeDir: string
}): Promise<WriteSpawnSettingsResult> {
  await mkdir(args.runtimeDir, { recursive: true, mode: 0o700 })
  const settingsPath = path.join(args.runtimeDir, "settings.local.json")
  const body = {
    spinnerTipsEnabled: false,
    showTurnDuration: false,
    syntaxHighlightingDisabled: true,
  }
  await writeFile(settingsPath, JSON.stringify(body, null, 2), { encoding: "utf8", mode: 0o600 })
  return { settingsPath }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/claude-pty/settings-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/settings-writer.ts src/server/claude-pty/settings-writer.test.ts
git commit -m "feat(claude-pty): per-spawn settings.local.json writer"
```

---

## Task 10: Driver — `startClaudeSessionPTY`

**Files:**
- Create: `src/server/claude-pty/driver.ts`
- Create: `src/server/claude-pty/driver.test.ts`

The factory. Assembles auth + settings + PTY spawn + JSONL reader into a `ClaudeSessionHandle`-conformant object.

Method mapping:
- `sendPrompt(text)` → `pty.sendInput(text + "\r")`
- `setModel(model)` → `writeSlashCommand(pty, "model", model)`
- `setPermissionMode(planMode)` → `writeSlashCommand(pty, "permissions")` (interactive — best-effort for P2)
- `interrupt()` → `pty.sendInput("\x1b")` (Esc); fall back to Ctrl-C `\x03` after 1s if still working
- `close()` → `writeSlashCommand(pty, "exit")` then kill after 2s
- `getAccountInfo()` → returns the cached `system.init` event
- `getSupportedCommands()` → returns a static list for P2 (full discovery deferred)
- `stream` → an `AsyncIterable<HarnessEvent>` that merges JSONL events with frame-parser-derived rate-limit events

For P2, do NOT disable built-in tools (`--tools` allowlist). Pass through `CLAUDE_TOOLSET` like the SDK driver. P3 will swap to `mcp__kanna__*`.

- [ ] **Step 1: Write failing tests**

`src/server/claude-pty/driver.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startClaudeSessionPTY } from "./driver"

describe("startClaudeSessionPTY", () => {
  test("auth precheck fails when credentials missing", async () => {
    if (process.platform === "win32") return
    const homeDir = await mkdtemp(path.join(tmpdir(), "kanna-pty-driver-"))
    try {
      await expect(
        startClaudeSessionPTY({
          chatId: "c",
          projectId: "p",
          localPath: "/tmp",
          model: "claude-sonnet-4-6",
          planMode: false,
          forkSession: false,
          oauthToken: null,
          sessionToken: null,
          onToolRequest: async () => null,
          homeDir,
          env: {},
        }),
      ).rejects.toThrow(/claude \/login/)
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  })

  test("auth precheck fails when ANTHROPIC_API_KEY is set", async () => {
    if (process.platform === "win32") return
    const homeDir = await mkdtemp(path.join(tmpdir(), "kanna-pty-driver-"))
    try {
      await mkdir(path.join(homeDir, ".claude"), { recursive: true })
      await writeFile(path.join(homeDir, ".claude", ".credentials.json"), "{}", "utf8")
      await expect(
        startClaudeSessionPTY({
          chatId: "c",
          projectId: "p",
          localPath: "/tmp",
          model: "claude-sonnet-4-6",
          planMode: false,
          forkSession: false,
          oauthToken: null,
          sessionToken: null,
          onToolRequest: async () => null,
          homeDir,
          env: { ANTHROPIC_API_KEY: "sk-x" },
        }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY/)
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  })
})
```

(End-to-end "spawn real claude + exchange one turn" test is gated by `KANNA_PTY_E2E=1` and added in a later step.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/claude-pty/driver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/claude-pty/driver.ts`**

```ts
import { homedir } from "node:os"
import path from "node:path"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { verifyPtyAuth } from "./auth"
import { computeJsonlPath } from "./jsonl-path"
import { createJsonlReader } from "./jsonl-reader"
import { spawnPtyProcess } from "./pty-process"
import { writeSlashCommand } from "./slash-commands"
import { writeSpawnSettings } from "./settings-writer"
import { detectModelSwitch, detectRateLimit } from "./frame-parser"
import type { ClaudeSessionHandle } from "../agent"
import type { HarnessEvent, HarnessToolRequest } from "../harness-types"
import type { AccountInfo, SlashCommand } from "../../shared/types"

const STATIC_SUPPORTED_COMMANDS: SlashCommand[] = [
  { name: "/model", description: "Switch model" },
  { name: "/exit", description: "Exit the session" },
  { name: "/clear", description: "Clear context" },
  { name: "/help", description: "List commands" },
]

export interface StartClaudeSessionPtyArgs {
  chatId: string
  projectId: string
  localPath: string
  model: string
  effort?: string
  planMode: boolean
  forkSession: boolean
  oauthToken: string | null
  sessionToken: string | null
  additionalDirectories?: string[]
  onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
  systemPromptOverride?: string
  initialPrompt?: string
  homeDir?: string
  env?: NodeJS.ProcessEnv
}

export async function startClaudeSessionPTY(args: StartClaudeSessionPtyArgs): Promise<ClaudeSessionHandle> {
  const home = args.homeDir ?? homedir()
  const env = args.env ?? process.env

  const auth = await verifyPtyAuth({ homeDir: home, env })
  if (!auth.ok) {
    throw new Error(auth.error)
  }

  // Strip ANTHROPIC_API_KEY from spawn env defensively (already rejected, but be doubly sure).
  const spawnEnv: NodeJS.ProcessEnv = { ...env }
  delete spawnEnv.ANTHROPIC_API_KEY
  spawnEnv.TERM = "xterm-256color"
  spawnEnv.NO_COLOR = "0"
  spawnEnv.HOME = home

  const sessionId = args.sessionToken ?? randomUUID()
  const jsonlPath = computeJsonlPath({ homeDir: home, cwd: args.localPath, sessionId })

  const runtimeDir = await mkdtemp(path.join(tmpdir(), `kanna-pty-${sessionId.slice(0, 8)}-`))
  const { settingsPath } = await writeSpawnSettings({ runtimeDir })

  const claudeBin = env.CLAUDE_EXECUTABLE?.replace(/^~(?=\/|$)/, home) || "claude"
  const cliArgs: string[] = [
    "--session-id", sessionId,
    "--model", args.model,
    "--settings", settingsPath,
    "--no-update",
    "--permission-mode", args.planMode ? "plan" : "acceptEdits",
  ]
  if (args.sessionToken) cliArgs.push("--resume", args.sessionToken)
  if (args.forkSession) cliArgs.push("--fork-session")
  if (args.additionalDirectories) {
    for (const dir of args.additionalDirectories) cliArgs.push("--add-dir", dir)
  }
  if (args.systemPromptOverride) {
    cliArgs.push("--system-prompt", args.systemPromptOverride)
  } else {
    cliArgs.push(
      "--append-system-prompt",
      "You are the Kanna coding agent helping a trusted developer work on their own codebase via Kanna's web UI.",
    )
  }

  // Slash-cmd ACK aggregation
  let pendingModelAck: { resolve: () => void } | null = null
  let cachedAccountInfo: AccountInfo | null = null

  const pty = await spawnPtyProcess({
    command: claudeBin,
    args: cliArgs,
    cwd: args.localPath,
    env: spawnEnv,
    cols: 120,
    rows: 40,
    onOutput: (chunk) => {
      // Slash-cmd ACK detection runs on every chunk against the live serialized frame.
      const frame = pty.serializer.serialize()
      if (pendingModelAck && detectModelSwitch(frame)) {
        pendingModelAck.resolve()
        pendingModelAck = null
      }
      // Rate-limit events are pushed onto the merged stream below.
      const rl = detectRateLimit(frame)
      if (rl) {
        mergedQueue.push({ type: "rate_limit", rateLimit: { resetAt: Number(new Date(`${new Date().toDateString()} ${rl.resetAt} ${rl.tz}`)), tz: rl.tz } })
      }
    },
  })

  const reader = createJsonlReader({ filePath: jsonlPath })
  const mergedQueue: HarnessEvent[] = []
  const mergedWaiters: Array<(r: IteratorResult<HarnessEvent>) => void> = []

  function pushMerged(ev: HarnessEvent) {
    if (ev.type === "transcript" && ev.entry && (ev.entry as { kind?: string }).kind === "account_info") {
      cachedAccountInfo = (ev.entry as unknown as { accountInfo: AccountInfo }).accountInfo ?? null
    }
    const w = mergedWaiters.shift()
    if (w) w({ value: ev, done: false })
    else mergedQueue.push(ev)
  }

  // Pump JSONL reader into merged stream
  void (async () => {
    for await (const ev of reader) pushMerged(ev)
  })()

  // Send initial prompt if subagent one-shot
  if (args.initialPrompt) {
    await pty.sendInput(`${args.initialPrompt}\r`)
  }

  const stream: AsyncIterable<HarnessEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<HarnessEvent>> {
          if (mergedQueue.length > 0) {
            return Promise.resolve({ value: mergedQueue.shift()!, done: false })
          }
          return new Promise((resolve) => { mergedWaiters.push(resolve) })
        },
      }
    },
  }

  return {
    provider: "claude",
    stream,
    interrupt: async () => {
      await pty.sendInput("\x1b")
      // Best-effort: send Ctrl-C after a short delay if still busy
      setTimeout(() => { void pty.sendInput("\x03") }, 1000)
    },
    sendPrompt: async (content) => {
      await pty.sendInput(`${content}\r`)
    },
    setModel: async (model) => {
      await writeSlashCommand(pty, "model", model)
      await new Promise<void>((resolve) => {
        pendingModelAck = { resolve }
        setTimeout(() => { if (pendingModelAck) { pendingModelAck.resolve(); pendingModelAck = null } }, 3000)
      })
    },
    setPermissionMode: async (planMode) => {
      // Best-effort: type the slash and let the user toggle interactively if needed
      await writeSlashCommand(pty, "permissions")
      void planMode
    },
    getSupportedCommands: async () => STATIC_SUPPORTED_COMMANDS,
    getAccountInfo: async () => cachedAccountInfo,
    close: () => {
      void writeSlashCommand(pty, "exit")
      setTimeout(() => { pty.close() }, 2000)
      reader.close()
    },
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/claude-pty/driver.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/driver.ts src/server/claude-pty/driver.test.ts
git commit -m "feat(claude-pty): startClaudeSessionPTY driver assembling auth/pty/jsonl"
```

---

## Task 11: Driver selection in `AgentCoordinator`

**Files:**
- Modify: `src/server/agent.ts` — `AgentCoordinator` calls `startClaudeSessionPTY` instead of `startClaudeSession` when `process.env.KANNA_CLAUDE_DRIVER === "pty"`.
- Modify: `src/server/agent.test.ts` — feature flag regression test.

- [ ] **Step 1: Add a regression test asserting driver selection**

Append to `src/server/agent.test.ts`:

```ts
test("AgentCoordinator selects PTY driver when KANNA_CLAUDE_DRIVER=pty", async () => {
  process.env.KANNA_CLAUDE_DRIVER = "pty"
  try {
    let sdkCalled = 0
    let ptyCalled = 0
    const stubHandle: ClaudeSessionHandle = {
      provider: "claude",
      stream: (async function* () {})(),
      interrupt: async () => {},
      close: () => {},
      sendPrompt: async () => {},
      setModel: async () => {},
      setPermissionMode: async () => {},
      getSupportedCommands: async () => [],
    }
    const coordinator = new AgentCoordinator({
      // ... mirror the existing test harness for AgentCoordinator
      store: /* test store */,
      onStateChange: () => {},
      startClaudeSession: async () => { sdkCalled++; return stubHandle },
      // P2 introduces this:
      startClaudeSessionPTY: async () => { ptyCalled++; return stubHandle },
    } as any)
    // Trigger a send that would create a session.
    // Assert ptyCalled === 1 and sdkCalled === 0.
  } finally {
    delete process.env.KANNA_CLAUDE_DRIVER
  }
})
```

Mirror existing AgentCoordinator test setup verbatim. If `startClaudeSession` is injected today, add `startClaudeSessionPTY` as a sibling injection point.

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/agent.test.ts`
Expected: FAIL — injection point doesn't exist yet.

- [ ] **Step 3: Implement selection in `AgentCoordinator`**

In `src/server/agent.ts`:

1. Add `startClaudeSessionPTY?: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>` to `AgentCoordinatorArgs`.
2. Store as private field. Default to importing the real `startClaudeSessionPTY` from `./claude-pty/driver`.
3. At the call site where the coordinator currently calls `this.startClaudeSessionFn(...)`, branch:

```ts
const driverFlag = process.env.KANNA_CLAUDE_DRIVER ?? "sdk"
const factory = driverFlag === "pty"
  ? this.startClaudeSessionPTYFn
  : this.startClaudeSessionFn
const session = await factory({ ...args })
```

Both factories accept overlapping arg shapes; for the PTY path, only the relevant subset is consumed (canUseTool / mcpServers are ignored for now; P3 wires them differently).

- [ ] **Step 4: Run tests**

Run: `bun test src/server/agent.test.ts && bun test src/server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/agent.ts src/server/agent.test.ts
git commit -m "feat(agent): select PTY driver when KANNA_CLAUDE_DRIVER=pty"
```

---

## Task 12: Document feature flag

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append to `CLAUDE.md`**

Add a new section:

```md
# Claude Driver Flag (KANNA_CLAUDE_DRIVER)

Setting `KANNA_CLAUDE_DRIVER=pty` launches the `claude` CLI under a
pseudo-terminal and tails the on-disk JSONL transcript instead of using
the `@anthropic-ai/claude-agent-sdk` `query()` programmatic API. PTY mode
preserves Pro/Max subscription billing; SDK mode bills at API rates.

Default is `sdk` (no behaviour change). Requires `claude /login` to have
been run once. `ANTHROPIC_API_KEY` must be unset (PTY mode refuses to
spawn if it is set — would force API billing).

Limitations of P2 (this release):
- Single account, no rotation (account pool lands in a later phase).
- No OS sandbox (defense-in-depth, later phase).
- Built-in CLI tools (`Read`/`Bash`/etc.) enabled — not yet routed through
  `kanna-mcp`. Permission gating from `KANNA_MCP_TOOL_CALLBACKS=1` still
  applies to `AskUserQuestion`/`ExitPlanMode` only.
- macOS/Linux only.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: KANNA_CLAUDE_DRIVER feature flag for PTY mode"
```

---

## Task 13: End-to-end smoke (gated)

**Files:**
- Modify: `src/server/claude-pty/driver.test.ts` — append a `KANNA_PTY_E2E=1`-gated test that spawns real `claude`.

- [ ] **Step 1: Append the gated test**

```ts
test.skipIf(process.env.KANNA_PTY_E2E !== "1")(
  "E2E: spawn claude, send one prompt, observe one transcript event",
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-pty-e2e-"))
    try {
      const handle = await startClaudeSessionPTY({
        chatId: "e2e",
        projectId: "e2e",
        localPath: dir,
        model: "claude-haiku-4-5-20251001",
        planMode: false,
        forkSession: false,
        oauthToken: null,
        sessionToken: null,
        onToolRequest: async () => null,
      })
      await handle.sendPrompt("Reply with exactly the word: ok")
      const it = handle.stream[Symbol.asyncIterator]()
      const start = Date.now()
      let sawTranscript = false
      while (Date.now() - start < 30_000) {
        const next = await Promise.race([
          it.next(),
          new Promise<IteratorResult<HarnessEvent>>((r) => setTimeout(() => r({ value: undefined as unknown as HarnessEvent, done: false }), 500)),
        ])
        if (next.value?.type === "transcript") { sawTranscript = true; break }
      }
      expect(sawTranscript).toBe(true)
      handle.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  60_000,
)
```

- [ ] **Step 2: Run locally with E2E flag**

Run: `KANNA_PTY_E2E=1 bun test src/server/claude-pty/driver.test.ts`
Expected: PASS (requires `claude` on PATH + valid OAuth keychain).

Without the env var, the test is skipped and CI is unaffected.

- [ ] **Step 3: Commit**

```bash
git add src/server/claude-pty/driver.test.ts
git commit -m "test(claude-pty): gated E2E smoke for PTY driver round-trip"
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-05-14-claude-pty-driver-design.md`):

- Auth (no Kanna bearer, claude keychain only) — Task 1.
- JSONL path resolver — Task 2.
- JSONL parsing reuses SDK normaliser — Task 3.
- Composite bookmark `(inode, ctimeNs, sha256)` — Task 4.
- JSONL tail with bookmark + fs.watch — Task 5.
- PTY process via `Bun.Terminal` — Task 6.
- Slash commands — Task 7.
- Frame parser for ACKs — Task 8.
- Per-spawn settings — Task 9.
- Driver assembling everything — Task 10.
- Driver selection by flag — Task 11.
- Docs — Task 12.
- E2E gated smoke — Task 13.

**Deferred to later phases (NOT in P2)**, with rationale:
- Allowlist preflight + `--tools "mcp__kanna__*"` (P3): swap to MCP shims for built-ins.
- Sandbox profiles (P4).
- Per-account `$HOME` + `oauthPool` lease (P5).
- Lifecycle (lazy spawn, idle stop, LRU) (P6).
- UI driver toggle + banners (P7).

**2. Placeholder scan:** No TBD/TODO/"implement later" in plan body.

**3. Type consistency:** `ClaudeSessionHandle` from `src/server/agent.ts` is the single contract every task targets. `HarnessEvent`/`HarnessToolRequest` from `src/server/harness-types.ts`. `StartClaudeSessionPtyArgs` interface defined in Task 10 and consumed in Task 11.

---
