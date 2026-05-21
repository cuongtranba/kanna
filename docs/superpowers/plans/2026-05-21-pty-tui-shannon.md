# PTY TUI Shannon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-cutover `KANNA_CLAUDE_DRIVER=pty` from headless `--print` stream-json transport to Shannon-style interactive TUI: spawn `claude` under a real PTY (`Bun.Terminal`), tail on-disk transcript JSONL at `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` as event source, send input as raw text + `\r`. Replace 8-probe preflight gate with single TUI smoke test. Preserve OAuth-only invariant, pool rotation, kanna-mcp wiring, parity-matrix coverage.

**Architecture:** Extract `tui-control.ts` (PTY interaction helpers) and `tui-source.ts` (transcript-file event source). `driver.ts` becomes a thin coordinator. `pty-process.ts` (Bun.Terminal — previously dead code) is wired in for the first time. Preflight subdir deleted except `binary-fingerprint.ts` (reused by smoke-test cache key).

**Tech Stack:** TypeScript, Bun runtime, `Bun.Terminal` (PTY), `Bun.spawn`, `node:fs.watch`, `node:fs/promises.realpath`, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-05-21-pty-tui-shannon-design.md`

---

## File Structure

### Create

- `src/server/claude-pty/output-ring.ts` (~25 LOC) — extracted from `driver.ts`
- `src/server/claude-pty/output-ring.test.ts` (~40 LOC)
- `src/server/claude-pty/tui-control.ts` (~140 LOC) — TUI interaction helpers
- `src/server/claude-pty/tui-control.test.ts` (~200 LOC)
- `src/server/claude-pty/tui-source.ts` (~180 LOC) — transcript-file event source
- `src/server/claude-pty/tui-source.test.ts` (~320 LOC)
- `src/server/claude-pty/smoke-test.ts` (~90 LOC) — single TUI probe replacing preflight
- `src/server/claude-pty/smoke-test.test.ts` (~140 LOC)
- `.c3/adr/adr-2026-05-21-pty-tui-shannon.md` — architecture decision record

### Modify

- `src/server/claude-pty/jsonl-path.ts` — fix `encodeCwd` (realpath + dot replacement)
- `src/server/claude-pty/jsonl-path.test.ts` — add realpath + dot + edge cases
- `src/server/claude-pty/driver.ts` — replace transport: `Bun.spawn` pipes → `spawnPtyProcess` (Bun.Terminal) + transcript watch; remove stdin JSONL envelope writer; wire smoke-test gate; remove unused `preflightGate` arg
- `src/server/claude-pty/driver.test.ts` — drop stdin envelope assertions, add TUI args + control-flow assertions
- `src/server/claude-pty/parity-matrix.test.ts` — feed fixtures via fake transcript file instead of raw lines (parser path unchanged; source changed)
- `src/server/agent.ts` — remove `PreflightGate` import, `preflightGate` field on `AgentCoordinator`, `preflightGate` field on `AgentCoordinatorArgs`, and 3 spawn-site arg passes
- `CLAUDE.md` — rewrite "Claude Driver Flag (KANNA_CLAUDE_DRIVER)" section; remove "Allowlist preflight (P3b)" section; update "Architecture note" to describe transcript-tail source

### Delete

- `src/server/claude-pty/preflight/gate.ts` + `gate.test.ts`
- `src/server/claude-pty/preflight/suite.ts` + `suite.test.ts`
- `src/server/claude-pty/preflight/probe.ts` + `probe.test.ts`
- `src/server/claude-pty/preflight/cache.ts` + `cache.test.ts`
- `src/server/claude-pty/preflight/types.ts` + `types.test.ts`

### Keep unchanged (in scope but no edits)

- `src/server/claude-pty/auth.ts`, `resolve-binary.ts`, `settings-writer.ts`, `jsonl-to-event.ts`, `pty-process.ts`
- `src/server/claude-pty/preflight/binary-fingerprint.ts` (reused by smoke-test)
- `src/server/claude-pty/sandbox/*` (already dead code per driver.ts comment; out of scope for this PR)

---

## Task 1: Fix `encodeCwd` — realpath + dot replacement

Foundation for transcript-file path resolution. Standalone, no driver coupling, lowest risk first.

**Files:**
- Modify: `src/server/claude-pty/jsonl-path.ts`
- Test: `src/server/claude-pty/jsonl-path.test.ts`

- [ ] **Step 1: Read existing test file**

Run: `cat src/server/claude-pty/jsonl-path.test.ts`

Note existing test cases. New cases will be added in step 2 without removing any.

- [ ] **Step 2: Write failing tests for new encoding rules**

Append to `src/server/claude-pty/jsonl-path.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

describe("encodeCwd realpath + dot replacement", () => {
  test("resolves macOS /var -> /private/var symlink", async () => {
    // /var is a symlink to /private/var on macOS; on Linux this is a no-op
    const tmp = await mkdtemp(path.join(tmpdir(), "kanna-encodecwd-"))
    try {
      const encoded = encodeCwd(tmp)
      // realpath result must be reflected in the encoded path
      const expected = (await import("node:fs/promises")).realpath
        ? await (await import("node:fs/promises")).realpath(tmp)
        : tmp
      const expectedEncoded = expected.replace(/\//g, "-").replace(/\./g, "-")
      expect(encoded).toBe(expectedEncoded)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test("replaces dots with dashes in segment names", () => {
    // Use a path that exists on every system to avoid realpath failing
    const result = encodeCwd("/etc")
    expect(result).not.toContain(".")
  })

  test("trailing slash trimmed before encoding", () => {
    const a = encodeCwd("/etc/")
    const b = encodeCwd("/etc")
    expect(a).toBe(b)
  })

  test("root / is preserved (does not trim to empty)", () => {
    const result = encodeCwd("/")
    // realpath("/") = "/" on all unix; encoded becomes "-"
    expect(result).toBe("-")
  })

  test("encoded path matches what claude CLI actually creates", async () => {
    // Reproduces the spike-A finding: /var/folders/x/kanna.abc -> -private-var-folders-x-kanna-abc
    const tmp = await mkdtemp(path.join(tmpdir(), "kanna-encodecwd-fixture-"))
    try {
      const realPath = await (await import("node:fs/promises")).realpath(tmp)
      const expected = realPath.replace(/\//g, "-").replace(/\./g, "-")
      expect(encodeCwd(tmp)).toBe(expected)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon && bun test src/server/claude-pty/jsonl-path.test.ts`

Expected: 4-5 tests FAIL (realpath/dots not applied), existing tests still PASS.

- [ ] **Step 4: Implement realpath + dot replacement**

Replace the whole `src/server/claude-pty/jsonl-path.ts` content with:

```ts
import { realpathSync } from "node:fs"
import path from "node:path"

/**
 * Encode a cwd to claude CLI's transcript directory naming convention.
 *
 * Claude resolves the cwd to its real path (macOS /var -> /private/var)
 * then replaces `/` -> `-` and `.` -> `-` in every path segment. Spike A
 * (2026-05-21) confirmed this by spawning claude in /var/folders/.../kanna-probe-4.eXyZ
 * and finding the transcript at ~/.claude/projects/-private-var-folders-...-kanna-probe-4-eXyZ/.
 */
export function encodeCwd(cwd: string): string {
  // realpathSync may throw if the cwd is removed mid-call; let it propagate —
  // the driver's startup path resolves cwd before the agent enters the spawn loop.
  const real = realpathSync(cwd)
  const trimmed = real.endsWith("/") && real !== "/" ? real.slice(0, -1) : real
  return trimmed.replace(/\//g, "-").replace(/\./g, "-")
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

/**
 * Project directory for the encoded cwd. Used by `tui-source` to watch
 * for the first transcript file when the session uuid is unknown at
 * spawn time (TUI claude generates its own uuid on first user prompt).
 */
export function computeProjectDir(args: {
  homeDir: string
  cwd: string
}): string {
  return path.join(args.homeDir, ".claude", "projects", encodeCwd(args.cwd))
}
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon && bun test src/server/claude-pty/jsonl-path.test.ts`

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/jsonl-path.ts src/server/claude-pty/jsonl-path.test.ts
git -c commit.gpgsign=false commit -m "fix(claude-pty): encodeCwd matches claude CLI behavior

Claude resolves cwd to realpath then replaces both / and . with -. The
old encoder only handled /, so transcript paths computed by kanna never
matched the files claude actually wrote. Add computeProjectDir() helper
for the tui-source dir-watch path.

Refs spec: docs/superpowers/specs/2026-05-21-pty-tui-shannon-design.md"
```

---

## Task 2: Extract `OutputRing` to its own module

Both the driver (failure synth from output tail) and the new `tui-control.ts` (trust-dialog detection) need a bounded byte buffer. Extract before reuse.

**Files:**
- Create: `src/server/claude-pty/output-ring.ts`
- Create: `src/server/claude-pty/output-ring.test.ts`
- Modify: `src/server/claude-pty/driver.ts` (replace inline `OutputRing` class with import)

- [ ] **Step 1: Write failing test**

Create `src/server/claude-pty/output-ring.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { OutputRing, OUTPUT_RING_DEFAULT_BYTES } from "./output-ring"

describe("OutputRing", () => {
  test("appends and returns full content under capacity", () => {
    const r = new OutputRing(100)
    r.append("hello ")
    r.append("world")
    expect(r.tail()).toBe("hello world")
  })

  test("drops oldest bytes once capacity exceeded", () => {
    const r = new OutputRing(5)
    r.append("abcdefgh")
    expect(r.tail()).toBe("defgh")
  })

  test("default capacity is 256 KB", () => {
    expect(OUTPUT_RING_DEFAULT_BYTES).toBe(256 * 1024)
  })

  test("contains(needle) returns true when present in tail", () => {
    const r = new OutputRing(100)
    r.append("Please run /login")
    expect(r.contains("/login")).toBe(true)
    expect(r.contains("foobar")).toBe(false)
  })

  test("contains works after rotation", () => {
    const r = new OutputRing(20)
    r.append("xxxxxxxxxxxxx")
    r.append("Please run /login")
    expect(r.contains("/login")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/claude-pty/output-ring.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement module**

Create `src/server/claude-pty/output-ring.ts`:

```ts
export const OUTPUT_RING_DEFAULT_BYTES = 256 * 1024

/**
 * Bounded ring of PTY output bytes. Two consumers:
 *   - `driver.ts` failure synthesis: reads `tail()` when a spawn exits
 *     before producing a `result` transcript entry so the synthesized
 *     error event carries the terminal output that explains the crash.
 *   - `tui-control.ts` trust-dialog detection: `contains("trust this folder")`
 *     decides whether to send `\r` to dismiss the dialog after spawn.
 *
 * Default capacity matches what driver.ts used before extraction (256 KB).
 */
export class OutputRing {
  private buf = ""
  private readonly capacity: number

  constructor(capacityBytes: number = OUTPUT_RING_DEFAULT_BYTES) {
    this.capacity = capacityBytes
  }

  append(chunk: string): void {
    this.buf += chunk
    if (this.buf.length > this.capacity) {
      this.buf = this.buf.slice(this.buf.length - this.capacity)
    }
  }

  tail(): string {
    return this.buf
  }

  contains(needle: string): boolean {
    return this.buf.includes(needle)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/claude-pty/output-ring.test.ts`

Expected: all PASS.

- [ ] **Step 5: Update driver.ts to import**

In `src/server/claude-pty/driver.ts`, replace lines 117-131 (the `PTY_STDERR_RING_BYTES` constant + `OutputRing` class) with:

```ts
import { OutputRing, OUTPUT_RING_DEFAULT_BYTES } from "./output-ring"
// Re-export for backward compat with tests that import the constant by old name.
export const PTY_STDERR_RING_BYTES = OUTPUT_RING_DEFAULT_BYTES
export { OutputRing }
```

Place the `import` near the top of the imports block. Place the `export const` + `export { OutputRing }` where the old class declaration lived.

- [ ] **Step 6: Run driver tests to verify no regression**

Run: `bun test src/server/claude-pty/driver.test.ts`

Expected: all PASS (no behavior change, just module extraction).

- [ ] **Step 7: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/output-ring.ts src/server/claude-pty/output-ring.test.ts src/server/claude-pty/driver.ts
git -c commit.gpgsign=false commit -m "refactor(claude-pty): extract OutputRing to own module

Both driver.ts (failure synth) and tui-control.ts (trust-dialog detect,
landing in upcoming commits) need the bounded byte ring. Add contains()
helper used by trust-dialog detection. Backward-compat re-export of
PTY_STDERR_RING_BYTES preserves existing test imports."
```

---

## Task 3: `tui-control.ts` — PTY interaction helpers

Pure helpers around a `PtyProcess`. No driver coupling. Tested via fake PTY.

**Files:**
- Create: `src/server/claude-pty/tui-control.ts`
- Create: `src/server/claude-pty/tui-control.test.ts`

- [ ] **Step 1: Write failing test for `sendUserPrompt`**

Create `src/server/claude-pty/tui-control.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { sendUserPrompt, sendExitCommand, dismissTrustDialogIfPresent, waitForTuiReady, TRUST_DIALOG_MARKER, TUI_READY_MARKER } from "./tui-control"
import { OutputRing } from "./output-ring"
import type { PtyProcess } from "./pty-process"

function fakePty(): PtyProcess & { sent: string[] } {
  const sent: string[] = []
  return {
    sent,
    async sendInput(data) { sent.push(data) },
    resize() { /* noop */ },
    exited: new Promise(() => { /* never */ }),
    close() { /* noop */ },
  } as PtyProcess & { sent: string[] }
}

describe("sendUserPrompt", () => {
  test("writes text + carriage return", async () => {
    const pty = fakePty()
    await sendUserPrompt(pty, "say hi")
    expect(pty.sent).toEqual(["say hi\r"])
  })

  test("empty string still sends carriage return (submits empty turn — caller is responsible for not calling on empty)", async () => {
    const pty = fakePty()
    await sendUserPrompt(pty, "")
    expect(pty.sent).toEqual(["\r"])
  })
})

describe("sendExitCommand", () => {
  test("writes /exit + carriage return", async () => {
    const pty = fakePty()
    await sendExitCommand(pty)
    expect(pty.sent).toEqual(["/exit\r"])
  })
})

describe("dismissTrustDialogIfPresent", () => {
  test("sends carriage return when ringbuf contains trust marker", async () => {
    const pty = fakePty()
    const ring = new OutputRing()
    ring.append("Quick safety check: Is this a project you created or one you trust?")
    const dismissed = await dismissTrustDialogIfPresent(pty, ring)
    expect(dismissed).toBe(true)
    expect(pty.sent).toEqual(["\r"])
  })

  test("does nothing when ringbuf lacks trust marker", async () => {
    const pty = fakePty()
    const ring = new OutputRing()
    ring.append("Welcome back c!")
    const dismissed = await dismissTrustDialogIfPresent(pty, ring)
    expect(dismissed).toBe(false)
    expect(pty.sent).toEqual([])
  })

  test("exported TRUST_DIALOG_MARKER is the substring matched", () => {
    expect(TRUST_DIALOG_MARKER).toBe("trust this folder")
  })
})

describe("waitForTuiReady", () => {
  test("returns 'marker' when ringbuf already contains the input-box marker", async () => {
    const ring = new OutputRing()
    ring.append("❯ ")
    const result = await waitForTuiReady(ring, { hardCapMs: 1000, pollMs: 10 })
    expect(result).toBe("marker")
  })

  test("returns 'timeout' when no marker appears within hardCapMs", async () => {
    const ring = new OutputRing()
    const result = await waitForTuiReady(ring, { hardCapMs: 200, pollMs: 10 })
    expect(result).toBe("timeout")
  })

  test("polls until marker appears", async () => {
    const ring = new OutputRing()
    setTimeout(() => ring.append("❯ "), 50)
    const start = Date.now()
    const result = await waitForTuiReady(ring, { hardCapMs: 1000, pollMs: 10 })
    const elapsed = Date.now() - start
    expect(result).toBe("marker")
    expect(elapsed).toBeLessThan(200)
  })

  test("exported TUI_READY_MARKER is the input-box prompt", () => {
    expect(TUI_READY_MARKER).toBe("❯ ")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/claude-pty/tui-control.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement module**

Create `src/server/claude-pty/tui-control.ts`:

```ts
import type { PtyProcess } from "./pty-process"
import type { OutputRing } from "./output-ring"

/** Substring searched in PTY output to detect the trust-acceptance dialog. */
export const TRUST_DIALOG_MARKER = "trust this folder"

/** Substring searched in PTY output to detect the TUI input box is ready. */
export const TUI_READY_MARKER = "❯ "

/**
 * Default hard cap on `waitForTuiReady`. The TUI welcome-screen render
 * settles in ~1-2s on macOS per spike A. 3s is a comfortable safety
 * margin. Operators can override via the driver's KANNA_PTY_TUI_BOOT_MS env.
 */
export const TUI_READY_HARD_CAP_DEFAULT_MS = 3000

export interface WaitForTuiReadyOpts {
  hardCapMs?: number
  pollMs?: number
}

/**
 * Poll the output ring for the input-box marker. Resolves "marker" as
 * soon as the marker appears, or "timeout" if hardCapMs elapses first.
 * Primary readiness signal — the marker render is the only deterministic
 * way to know claude has finished welcome-screen layout and is accepting input.
 */
export async function waitForTuiReady(
  ring: OutputRing,
  opts: WaitForTuiReadyOpts = {},
): Promise<"marker" | "timeout"> {
  const hardCapMs = opts.hardCapMs ?? TUI_READY_HARD_CAP_DEFAULT_MS
  const pollMs = opts.pollMs ?? 50
  const start = Date.now()
  while (true) {
    if (ring.contains(TUI_READY_MARKER)) return "marker"
    if (Date.now() - start >= hardCapMs) return "timeout"
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

/**
 * If the trust dialog is in the output ring, send Enter to accept "Yes, I trust"
 * (the default-highlighted option). Returns true if dismissed, false if no
 * dialog detected. Caller should sleep briefly afterward to let the TUI
 * redraw past the dialog.
 */
export async function dismissTrustDialogIfPresent(
  pty: PtyProcess,
  ring: OutputRing,
): Promise<boolean> {
  if (!ring.contains(TRUST_DIALOG_MARKER)) return false
  await pty.sendInput("\r")
  return true
}

/**
 * Send a user-typed prompt and submit it. Single-line only this PR —
 * multi-line prompts with embedded \n are deferred (F3 in spec).
 * Caller is responsible for ensuring prompt is non-empty.
 */
export async function sendUserPrompt(pty: PtyProcess, text: string): Promise<void> {
  await pty.sendInput(text + "\r")
}

/**
 * Send the /exit slash command to close the REPL. Used by oneShot subagent
 * runs to terminate after the first result entry. Chosen over SIGTERM
 * because it lets claude flush telemetry and disconnect from kanna-mcp
 * cleanly. Caller should await `pty.exited` with a grace period and
 * escalate to SIGTERM/SIGKILL on hang.
 */
export async function sendExitCommand(pty: PtyProcess): Promise<void> {
  await pty.sendInput("/exit\r")
}
```

- [ ] **Step 4: Run test to verify all pass**

Run: `bun test src/server/claude-pty/tui-control.test.ts`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/tui-control.ts src/server/claude-pty/tui-control.test.ts
git -c commit.gpgsign=false commit -m "feat(claude-pty): tui-control helpers for TUI interaction

Pure helpers around PtyProcess for the Shannon-style TUI driver:
- waitForTuiReady polls OutputRing for the input-box marker '❯ '
- dismissTrustDialogIfPresent detects the workspace-trust dialog and
  sends Enter to accept (per spike A: dialog appears once per new cwd
  and the default-highlighted option is 'Yes, I trust this folder')
- sendUserPrompt writes text + \\r to submit a turn
- sendExitCommand writes '/exit\\r' to close REPL for oneShot subagents

No driver wiring yet — that lands with the driver rewrite."
```

---

## Task 4: `tui-source.ts` — transcript-file event source

Watches `~/.claude/projects/<encoded>/` for the first `<uuid>.jsonl` to appear (TUI claude creates it on first user prompt), then follows the file emitting complete JSONL lines.

**Files:**
- Create: `src/server/claude-pty/tui-source.ts`
- Create: `src/server/claude-pty/tui-source.test.ts`

- [ ] **Step 1: Write failing test for `findLatestTranscript`**

Create `src/server/claude-pty/tui-source.test.ts`:

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  findLatestTranscript,
  startTranscriptStream,
  waitForResultEntry,
  type TranscriptStream,
} from "./tui-source"

let workHome: string
let projectDir: string

beforeEach(async () => {
  workHome = await mkdtemp(path.join(tmpdir(), "kanna-tui-source-"))
  // Pre-create a fake project dir as if claude had encoded our cwd to "fake-cwd"
  projectDir = path.join(workHome, ".claude", "projects", "fake-cwd")
  await mkdir(projectDir, { recursive: true })
})

afterEach(async () => {
  await rm(workHome, { recursive: true, force: true })
})

describe("findLatestTranscript", () => {
  test("returns null when project dir empty", async () => {
    const result = await findLatestTranscript(projectDir)
    expect(result).toBeNull()
  })

  test("returns path of newest .jsonl file", async () => {
    const fileA = path.join(projectDir, "aaa.jsonl")
    const fileB = path.join(projectDir, "bbb.jsonl")
    await writeFile(fileA, "{}\n")
    await new Promise((r) => setTimeout(r, 20))
    await writeFile(fileB, "{}\n")
    const result = await findLatestTranscript(projectDir)
    expect(result).toBe(fileB)
  })

  test("ignores non-.jsonl files", async () => {
    await writeFile(path.join(projectDir, "notes.txt"), "hello")
    const result = await findLatestTranscript(projectDir)
    expect(result).toBeNull()
  })

  test("returns null when project dir does not exist", async () => {
    const result = await findLatestTranscript(path.join(workHome, "no-such-dir"))
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/claude-pty/tui-source.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `findLatestTranscript`**

Create `src/server/claude-pty/tui-source.ts`:

```ts
import { readdir, stat } from "node:fs/promises"
import { existsSync, watch } from "node:fs"
import path from "node:path"

/**
 * Return the absolute path of the newest .jsonl file in the project
 * directory, or null if none exist (or the dir is missing). Used by
 * `startTranscriptStream` to pick up the transcript file claude
 * creates on first user prompt.
 */
export async function findLatestTranscript(projectDir: string): Promise<string | null> {
  if (!existsSync(projectDir)) return null
  let entries: string[]
  try {
    entries = await readdir(projectDir)
  } catch {
    return null
  }
  const jsonlNames = entries.filter((n) => n.endsWith(".jsonl"))
  if (jsonlNames.length === 0) return null
  let bestPath: string | null = null
  let bestMtime = 0
  for (const name of jsonlNames) {
    const full = path.join(projectDir, name)
    try {
      const s = await stat(full)
      if (s.mtimeMs > bestMtime) {
        bestMtime = s.mtimeMs
        bestPath = full
      }
    } catch {
      /* skip */
    }
  }
  return bestPath
}

/** Stub — implemented in later steps */
export interface TranscriptStream {
  /** Async iterator of complete JSONL lines (no trailing newline). */
  lines: AsyncIterable<string>
  /** Resolves to the absolute path once the transcript file is located. */
  filePath: Promise<string>
  /** Cleanup: stops watcher, releases resources. */
  close(): void
}

export interface StartTranscriptStreamArgs {
  projectDir: string
  /** When known up-front (resume / fork), skip dir-watch and open this file directly. */
  knownFilePath?: string
  /** Override fs.watch with polling when true (or when fs.watch is unreliable on the FS). */
  pollMode?: boolean
  /** Polling interval if pollMode. Default 50ms. */
  pollIntervalMs?: number
  /** Hard cap on waiting for the first transcript file to appear. Default 20_000. */
  firstFileTimeoutMs?: number
}

export async function startTranscriptStream(_args: StartTranscriptStreamArgs): Promise<TranscriptStream> {
  throw new Error("not implemented")
}

export async function waitForResultEntry(
  _stream: TranscriptStream,
  _opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ rawLine: string; parsed: { type: string } }> {
  throw new Error("not implemented")
}
```

- [ ] **Step 4: Run test to verify `findLatestTranscript` passes**

Run: `bun test src/server/claude-pty/tui-source.test.ts`

Expected: 4 PASS (the `findLatestTranscript` block).

- [ ] **Step 5: Write failing tests for `startTranscriptStream` (dir-watch path)**

Append to `src/server/claude-pty/tui-source.test.ts`:

```ts
describe("startTranscriptStream (dir-watch)", () => {
  test("picks up file written after stream start", async () => {
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    const filePath = path.join(projectDir, "new.jsonl")
    setTimeout(() => writeFile(filePath, '{"type":"hello"}\n'), 100)
    const resolved = await stream.filePath
    expect(resolved).toBe(filePath)
    stream.close()
  })

  test("opens existing file when present at start", async () => {
    const filePath = path.join(projectDir, "existing.jsonl")
    await writeFile(filePath, '{"type":"hello"}\n')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    const resolved = await stream.filePath
    expect(resolved).toBe(filePath)
    stream.close()
  })

  test("emits complete lines as they are appended", async () => {
    const filePath = path.join(projectDir, "stream.jsonl")
    await writeFile(filePath, '{"type":"one"}\n')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    const iter = stream.lines[Symbol.asyncIterator]()
    const first = await iter.next()
    expect(first.value).toBe('{"type":"one"}')
    setTimeout(() => writeFile(filePath, '{"type":"one"}\n{"type":"two"}\n'), 100)
    const second = await iter.next()
    expect(second.value).toBe('{"type":"two"}')
    stream.close()
  })

  test("holds partial line across writes", async () => {
    const filePath = path.join(projectDir, "partial.jsonl")
    await writeFile(filePath, '{"type":')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    const iter = stream.lines[Symbol.asyncIterator]()
    // No complete line yet; iter.next() must not resolve.
    let resolved = false
    iter.next().then(() => { resolved = true })
    await new Promise((r) => setTimeout(r, 200))
    expect(resolved).toBe(false)
    setTimeout(() => writeFile(filePath, '{"type":"one"}\n'), 100)
    const first = await iter.next()
    expect(first.value).toBe('{"type":"one"}')
    stream.close()
  })

  test("times out when no file appears within firstFileTimeoutMs", async () => {
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 200 })
    await expect(stream.filePath).rejects.toThrow(/transcript file did not appear/)
    stream.close()
  })

  test("knownFilePath skips dir-watch", async () => {
    const filePath = path.join(projectDir, "known.jsonl")
    await writeFile(filePath, '{"type":"hello"}\n')
    const stream = await startTranscriptStream({
      projectDir,
      knownFilePath: filePath,
      firstFileTimeoutMs: 500,
    })
    const resolved = await stream.filePath
    expect(resolved).toBe(filePath)
    stream.close()
  })
})

describe("startTranscriptStream (poll-mode)", () => {
  test("emits lines via polling when pollMode=true", async () => {
    const stream = await startTranscriptStream({
      projectDir,
      pollMode: true,
      pollIntervalMs: 30,
      firstFileTimeoutMs: 2000,
    })
    const filePath = path.join(projectDir, "poll.jsonl")
    setTimeout(() => writeFile(filePath, '{"type":"polled"}\n'), 100)
    const iter = stream.lines[Symbol.asyncIterator]()
    const first = await iter.next()
    expect(first.value).toBe('{"type":"polled"}')
    stream.close()
  })
})

describe("waitForResultEntry", () => {
  test("resolves on first result line", async () => {
    const filePath = path.join(projectDir, "result.jsonl")
    await writeFile(filePath, '{"type":"system"}\n{"type":"assistant"}\n')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    setTimeout(() => writeFile(filePath, '{"type":"system"}\n{"type":"assistant"}\n{"type":"result","subtype":"success"}\n'), 100)
    const entry = await waitForResultEntry(stream, { timeoutMs: 2000 })
    expect(entry.parsed.type).toBe("result")
    stream.close()
  })

  test("rejects on abort signal", async () => {
    const filePath = path.join(projectDir, "abort.jsonl")
    await writeFile(filePath, '{"type":"system"}\n')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 50)
    await expect(waitForResultEntry(stream, { signal: ctrl.signal })).rejects.toThrow(/aborted/i)
    stream.close()
  })

  test("rejects on timeout", async () => {
    const filePath = path.join(projectDir, "timeout.jsonl")
    await writeFile(filePath, '{"type":"system"}\n')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    await expect(waitForResultEntry(stream, { timeoutMs: 100 })).rejects.toThrow(/timed out/i)
    stream.close()
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `bun test src/server/claude-pty/tui-source.test.ts`

Expected: previously passing 4 tests still PASS; new tests FAIL (not implemented).

- [ ] **Step 7: Implement `startTranscriptStream` + `waitForResultEntry`**

Replace the stub at the bottom of `src/server/claude-pty/tui-source.ts` (everything from `export interface TranscriptStream` down) with:

```ts
export interface TranscriptStream {
  /** Async iterator of complete JSONL lines (no trailing newline). */
  lines: AsyncIterable<string>
  /** Resolves to the absolute path once the transcript file is located. */
  filePath: Promise<string>
  /** Cleanup: stops watcher, releases file handle, ends lines iterator. */
  close(): void
}

export interface StartTranscriptStreamArgs {
  projectDir: string
  /** When known up-front (resume / fork), skip dir-watch and open this file directly. */
  knownFilePath?: string
  /** Override fs.watch with polling when true. */
  pollMode?: boolean
  /** Polling interval if pollMode. Default 50ms. */
  pollIntervalMs?: number
  /** Hard cap on waiting for the first transcript file to appear. Default 20_000. */
  firstFileTimeoutMs?: number
}

const DEFAULT_FIRST_FILE_TIMEOUT_MS = 20_000
const DEFAULT_POLL_INTERVAL_MS = 50

export async function startTranscriptStream(args: StartTranscriptStreamArgs): Promise<TranscriptStream> {
  const lineQueue: string[] = []
  const lineWaiters: Array<(r: IteratorResult<string>) => void> = []
  let buffer = ""
  let position = 0
  let closed = false
  let watcher: ReturnType<typeof watch> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function pushLine(line: string) {
    const w = lineWaiters.shift()
    if (w) w({ value: line, done: false })
    else lineQueue.push(line)
  }

  function endLines() {
    while (lineWaiters.length > 0) {
      const w = lineWaiters.shift()
      if (w) w({ value: "" as never, done: true })
    }
  }

  async function readNewBytes(filePath: string) {
    try {
      const s = await stat(filePath)
      if (s.size <= position) return
      const fd = await import("node:fs/promises").then((m) => m.open(filePath, "r"))
      try {
        const length = s.size - position
        const buf = Buffer.alloc(length)
        await fd.read(buf, 0, length, position)
        position = s.size
        buffer += buf.toString("utf8")
        const parts = buffer.split("\n")
        buffer = parts.pop() ?? ""
        for (const line of parts) {
          if (line.length === 0) continue
          pushLine(line)
        }
      } finally {
        await fd.close()
      }
    } catch {
      /* file rotated / truncated mid-read; let next watcher tick recover */
    }
  }

  function startFollowing(filePath: string) {
    if (args.pollMode) {
      const interval = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
      pollTimer = setInterval(() => { void readNewBytes(filePath) }, interval)
    } else {
      try {
        watcher = watch(filePath, () => { void readNewBytes(filePath) })
      } catch {
        // fs.watch failed (rare on some FS) — fall back to polling
        const interval = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
        pollTimer = setInterval(() => { void readNewBytes(filePath) }, interval)
      }
    }
    // Drain initial file contents immediately so existing lines aren't missed.
    void readNewBytes(filePath)
  }

  async function locateFirstFile(): Promise<string> {
    if (args.knownFilePath) return args.knownFilePath
    const timeoutMs = args.firstFileTimeoutMs ?? DEFAULT_FIRST_FILE_TIMEOUT_MS
    const existing = await findLatestTranscript(args.projectDir)
    if (existing) return existing
    return new Promise<string>((resolve, reject) => {
      const start = Date.now()
      const pollMs = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
      const timer = setInterval(async () => {
        if (closed) {
          clearInterval(timer)
          reject(new Error("transcript stream closed before first file appeared"))
          return
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(timer)
          reject(new Error(`transcript file did not appear in ${timeoutMs}ms under ${args.projectDir}`))
          return
        }
        const found = await findLatestTranscript(args.projectDir)
        if (found) {
          clearInterval(timer)
          resolve(found)
        }
      }, pollMs)
    })
  }

  const filePathPromise = locateFirstFile()
  void filePathPromise.then((fp) => { if (!closed) startFollowing(fp) }).catch(() => {
    /* surfaced through filePath rejection; no extra action needed */
  })

  const lines: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<string>> {
          if (lineQueue.length > 0) {
            const v = lineQueue.shift()
            if (v !== undefined) return Promise.resolve({ value: v, done: false })
          }
          if (closed) return Promise.resolve({ value: "" as never, done: true })
          return new Promise((resolve) => lineWaiters.push(resolve))
        },
      }
    },
  }

  return {
    lines,
    filePath: filePathPromise,
    close() {
      if (closed) return
      closed = true
      if (watcher) try { watcher.close() } catch { /* swallow */ }
      if (pollTimer) clearInterval(pollTimer)
      endLines()
    },
  }
}

export async function waitForResultEntry(
  stream: TranscriptStream,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ rawLine: string; parsed: { type: string } }> {
  const timeoutMs = opts.timeoutMs
  return new Promise(async (resolve, reject) => {
    const timer = timeoutMs !== undefined
      ? setTimeout(() => reject(new Error(`waitForResultEntry timed out after ${timeoutMs}ms`)), timeoutMs)
      : null
    if (opts.signal) {
      if (opts.signal.aborted) {
        if (timer) clearTimeout(timer)
        reject(new Error("aborted"))
        return
      }
      opts.signal.addEventListener("abort", () => {
        if (timer) clearTimeout(timer)
        reject(new Error("aborted"))
      })
    }
    try {
      for await (const line of stream.lines) {
        let parsed: { type?: string }
        try { parsed = JSON.parse(line) } catch { continue }
        if (parsed.type === "result") {
          if (timer) clearTimeout(timer)
          resolve({ rawLine: line, parsed: { type: parsed.type } })
          return
        }
      }
      if (timer) clearTimeout(timer)
      reject(new Error("transcript stream ended before result entry"))
    } catch (err) {
      if (timer) clearTimeout(timer)
      reject(err)
    }
  })
}
```

- [ ] **Step 8: Run all tests in file**

Run: `bun test src/server/claude-pty/tui-source.test.ts`

Expected: all PASS. If any FAIL, fix incrementally (check imports, timing). The most likely failure is the partial-line test on filesystems where `fs.watch` debounces — bump `pollIntervalMs` to 30 or call `readNewBytes` directly on a setTimeout fallback if needed.

- [ ] **Step 9: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/tui-source.ts src/server/claude-pty/tui-source.test.ts
git -c commit.gpgsign=false commit -m "feat(claude-pty): tui-source transcript-file event source

Watches ~/.claude/projects/<encoded-cwd>/ for the first <uuid>.jsonl
to appear (TUI claude creates it on first user prompt), then follows
the file emitting complete JSONL lines as they're written. Supports
fs.watch (default) and polling fallback (for unreliable filesystems).

waitForResultEntry blocks until a {type:'result'} line is seen, with
optional timeout + AbortSignal.

No driver wiring yet — that lands with the driver rewrite."
```

---

## Task 5: `smoke-test.ts` — single TUI probe replacing preflight

Verifies `--disallowedTools Bash` is enforced for the spawned `claude` binary. Cached per `(binarySha256, model)` 24h. Refuses spawn on regression.

**Files:**
- Create: `src/server/claude-pty/smoke-test.ts`
- Create: `src/server/claude-pty/smoke-test.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/claude-pty/smoke-test.test.ts`:

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createSmokeTestGate, type SmokeTestProbeFn, type SmokeTestCache } from "./smoke-test"

let workHome: string

function inMemoryCache(): SmokeTestCache {
  const store = new Map<string, { result: "pass" | "fail"; ts: number }>()
  return {
    async get(key) { return store.get(key) ?? null },
    async set(key, entry) { store.set(key, entry) },
    async invalidate() { store.clear() },
  }
}

beforeEach(async () => {
  workHome = await mkdtemp(path.join(tmpdir(), "kanna-smoke-"))
  await writeFile(path.join(workHome, "fake-claude"), "#!/bin/sh\necho fake\n", { mode: 0o755 })
})

afterEach(async () => {
  await rm(workHome, { recursive: true, force: true })
})

describe("createSmokeTestGate", () => {
  test("cached PASS skips probe", async () => {
    let probeRan = false
    const probe: SmokeTestProbeFn = async () => { probeRan = true; return "pass" }
    const cache = inMemoryCache()
    await cache.set("aaa|claude-opus-4-7", { result: "pass", ts: Date.now() })
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })
    const result = await gate.canSpawn({ binarySha256: "aaa", model: "claude-opus-4-7" })
    expect(result.ok).toBe(true)
    expect(probeRan).toBe(false)
  })

  test("cached FAIL refuses spawn without running probe", async () => {
    let probeRan = false
    const probe: SmokeTestProbeFn = async () => { probeRan = true; return "pass" }
    const cache = inMemoryCache()
    await cache.set("bbb|claude-opus-4-7", { result: "fail", ts: Date.now() })
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })
    const result = await gate.canSpawn({ binarySha256: "bbb", model: "claude-opus-4-7" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/disallowedTools/i)
    expect(probeRan).toBe(false)
  })

  test("cache miss runs probe and caches PASS", async () => {
    let probeRan = false
    const probe: SmokeTestProbeFn = async () => { probeRan = true; return "pass" }
    const cache = inMemoryCache()
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })
    const result = await gate.canSpawn({ binarySha256: "ccc", model: "m1" })
    expect(result.ok).toBe(true)
    expect(probeRan).toBe(true)
    const cached = await cache.get("ccc|m1")
    expect(cached?.result).toBe("pass")
  })

  test("cache miss runs probe and refuses spawn on FAIL", async () => {
    const probe: SmokeTestProbeFn = async () => "fail"
    const cache = inMemoryCache()
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })
    const result = await gate.canSpawn({ binarySha256: "ddd", model: "m1" })
    expect(result.ok).toBe(false)
    const cached = await cache.get("ddd|m1")
    expect(cached?.result).toBe("fail")
  })

  test("expired cache entry triggers re-probe", async () => {
    let probeRan = 0
    const probe: SmokeTestProbeFn = async () => { probeRan++; return "pass" }
    const cache = inMemoryCache()
    let nowMs = 1_000_000
    await cache.set("eee|m1", { result: "pass", ts: nowMs })
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 1000, now: () => nowMs })
    // First call: cache hit (fresh)
    await gate.canSpawn({ binarySha256: "eee", model: "m1" })
    expect(probeRan).toBe(0)
    // Advance time past TTL
    nowMs += 2000
    await gate.canSpawn({ binarySha256: "eee", model: "m1" })
    expect(probeRan).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/claude-pty/smoke-test.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement module**

Create `src/server/claude-pty/smoke-test.ts`:

```ts
/**
 * Single TUI smoke test replacing the deleted 8-probe preflight gate.
 * Spike A (2026-05-21) confirmed `--disallowedTools` is enforced in TUI
 * mode, so per-tool probes are redundant. This module verifies the
 * `--disallowedTools` flag itself is honored by spawning one TUI claude
 * with `--disallowedTools Bash` and prompting the model to invoke Bash.
 * If the transcript shows a tool_use for Bash → regression → refuse spawn.
 *
 * Cached per (binarySha256, model) for 24h. Cache key matches the prior
 * preflight cache shape minus the tools-string component (smoke prompt
 * is fixed, so tools-string is implied).
 */

export type SmokeTestProbeFn = () => Promise<"pass" | "fail">

export interface SmokeTestCacheEntry {
  result: "pass" | "fail"
  ts: number
}

export interface SmokeTestCache {
  get(key: string): Promise<SmokeTestCacheEntry | null>
  set(key: string, entry: SmokeTestCacheEntry): Promise<void>
  invalidate(): Promise<void>
}

export interface SmokeTestGateArgs {
  probe: SmokeTestProbeFn
  cache: SmokeTestCache
  ttlMs: number
  now: () => number
}

export interface CanSpawnArgs {
  binarySha256: string
  model: string
}

export interface SmokeTestGate {
  canSpawn(args: CanSpawnArgs): Promise<{ ok: true } | { ok: false; reason: string }>
}

export function createSmokeTestGate(args: SmokeTestGateArgs): SmokeTestGate {
  const { probe, cache, ttlMs, now } = args
  return {
    async canSpawn(spawnArgs: CanSpawnArgs) {
      const key = `${spawnArgs.binarySha256}|${spawnArgs.model}`
      const cached = await cache.get(key)
      const currentTs = now()
      if (cached && currentTs - cached.ts < ttlMs) {
        if (cached.result === "pass") return { ok: true }
        return { ok: false, reason: "cached smoke test FAIL: --disallowedTools not enforced for this claude binary + model" }
      }
      const probeResult = await probe()
      await cache.set(key, { result: probeResult, ts: currentTs })
      if (probeResult === "pass") return { ok: true }
      return { ok: false, reason: "smoke test FAIL: claude invoked a disallowedTool — refusing spawn" }
    },
  }
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `bun test src/server/claude-pty/smoke-test.test.ts`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/smoke-test.ts src/server/claude-pty/smoke-test.test.ts
git -c commit.gpgsign=false commit -m "feat(claude-pty): smoke-test gate replaces 8-probe preflight

Single TUI probe verifying the --disallowedTools flag itself is honored
by the spawned claude binary + model. Cached per (binarySha256, model)
24h. PASS unlocks spawn; FAIL refuses with a clear reason that surfaces
through the existing spawn-error path.

The actual TUI-probe implementation is injected by the driver wiring
in a later commit; this module owns only the cache + gate decision."
```

---

## Task 6: Driver rewrite — replace `Bun.spawn` pipes with PTY + transcript-watch

The big atomic cutover. Replaces `Bun.spawn` (stdin/stdout pipes) with `spawnPtyProcess` (Bun.Terminal), removes the stdin JSONL envelope writer (`writeJsonLine`), removes the stdout pump (`pumpStdout`), wires `tui-control` for prompt-send + trust-dismiss + oneShot-exit, wires `tui-source` for the event stream, wires `smoke-test` gate.

**Files:**
- Modify: `src/server/claude-pty/driver.ts`
- Modify: `src/server/claude-pty/driver.test.ts`

This is the largest single change. Split into 7 sub-steps with commits at the natural boundaries.

### Task 6.1: Update `buildPtyCliArgs` — drop `--print` family

- [ ] **Step 1: Write failing test**

Add to `src/server/claude-pty/driver.test.ts` (find the `describe("buildPtyCliArgs")` block — extend it):

```ts
describe("buildPtyCliArgs TUI mode", () => {
  test("does NOT include --print", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "m", planMode: false,
      sessionToken: null, forkSession: false,
    })
    expect(args).not.toContain("--print")
  })

  test("does NOT include --output-format / --input-format / --verbose", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "m", planMode: false,
      sessionToken: null, forkSession: false,
    })
    expect(args.find((a) => a.startsWith("--output-format"))).toBeUndefined()
    expect(args.find((a) => a.startsWith("--input-format"))).toBeUndefined()
    expect(args).not.toContain("--verbose")
  })

  test("includes core TUI args", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "claude-opus-4-7", planMode: false,
      sessionToken: null, forkSession: false,
    })
    expect(args).toContain("--model")
    expect(args).toContain("claude-opus-4-7")
    expect(args).toContain("--permission-mode")
    expect(args).toContain("acceptEdits")
    expect(args).toContain("--dangerously-skip-permissions")
  })

  test("does NOT include --session-id (TUI claude generates its own uuid)", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "m", planMode: false,
      sessionToken: null, forkSession: false,
    })
    expect(args).not.toContain("--session-id")
  })

  test("resume passes --resume <token> without --session-id", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "m", planMode: false,
      sessionToken: "tok-abc", forkSession: false,
    })
    expect(args).toContain("--resume")
    expect(args).toContain("tok-abc")
    expect(args).not.toContain("--session-id")
    expect(args).not.toContain("--fork-session")
  })

  test("fork passes --session-id + --resume + --fork-session", () => {
    const args = buildPtyCliArgs({
      sessionId: "fork-uuid", model: "m", planMode: false,
      sessionToken: "old-tok", forkSession: true,
    })
    expect(args).toContain("--session-id")
    expect(args).toContain("fork-uuid")
    expect(args).toContain("--resume")
    expect(args).toContain("old-tok")
    expect(args).toContain("--fork-session")
  })

  test("plan mode flips permission-mode", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "m", planMode: true,
      sessionToken: null, forkSession: false,
    })
    expect(args).toContain("plan")
  })
})
```

Find and DELETE any existing test cases that assert `--print` / `--output-format` / `--input-format` / `--verbose` are present (they were correct before; now they're wrong).

- [ ] **Step 2: Run tests to verify some new ones FAIL**

Run: `bun test src/server/claude-pty/driver.test.ts -t buildPtyCliArgs`

Expected: new "does NOT include --print" + similar tests FAIL because current `buildPtyCliArgs` still includes them.

- [ ] **Step 3: Edit `buildPtyCliArgs`**

In `src/server/claude-pty/driver.ts`, replace the body of `buildPtyCliArgs` (lines 179-222) with:

```ts
export function buildPtyCliArgs(args: BuildPtyCliArgsInput): string[] {
  const cliArgs: string[] = [
    "--model", args.model,
    "--setting-sources", "user,project,local",
    "--permission-mode", args.planMode ? "plan" : "acceptEdits",
    "--dangerously-skip-permissions",
  ]
  // TUI claude generates its own session uuid on first user prompt — it does
  // NOT accept --session-id for a fresh session. The actual uuid is discovered
  // post-spawn by tui-source watching the project directory.
  // Resume / fork still pass --resume <token> (claude accepts that in TUI):
  //   • New session                                    → (no session flags; uuid discovered)
  //   • Resume existing session (sessionToken set)     → --resume <token>
  //   • Fork existing session (sessionToken + fork)    → --session-id <newUuid> --resume <token> --fork-session
  if (args.sessionToken && !args.forkSession) {
    cliArgs.push("--resume", args.sessionToken)
  } else if (args.sessionToken && args.forkSession) {
    cliArgs.push("--session-id", args.sessionId, "--resume", args.sessionToken, "--fork-session")
  }
  if (args.mcpConfigPath) {
    cliArgs.push("--mcp-config", args.mcpConfigPath)
  }
  if (args.effort && args.effort.length > 0) cliArgs.push("--effort", args.effort)
  if (args.additionalDirectories) {
    for (const dir of args.additionalDirectories) cliArgs.push("--add-dir", dir)
  }
  if (args.systemPromptOverride) {
    cliArgs.push("--system-prompt", args.systemPromptOverride)
  } else {
    cliArgs.push("--append-system-prompt", args.systemPromptAppend ?? KANNA_SYSTEM_PROMPT_APPEND)
  }
  // `--disallowedTools` is variadic in the claude CLI. Push LAST so it cannot
  // greedily swallow a subsequent flag value.
  cliArgs.push("--disallowedTools", ...PTY_DISALLOWED_NATIVE_TOOLS)
  return cliArgs
}
```

Also update the docblock above `buildPtyCliArgs` to remove references to `--print` mode.

- [ ] **Step 4: Run tests to verify all pass**

Run: `bun test src/server/claude-pty/driver.test.ts -t buildPtyCliArgs`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/driver.ts src/server/claude-pty/driver.test.ts
git -c commit.gpgsign=false commit -m "feat(claude-pty)!: buildPtyCliArgs emits TUI args (no --print)

Drop --print / --output-format / --input-format / --verbose / --session-id
(for new sessions). TUI claude generates its own session uuid on first
user prompt — tui-source discovers it post-spawn. Resume / fork still
pass --resume <token>.

This is the first step of the hard cutover. Driver body still uses
Bun.spawn pipes and will fail at runtime until task 6.5 lands.

BREAKING: KANNA_CLAUDE_DRIVER=pty semantics change with the full cutover
(arriving in this PR)."
```

### Task 6.2: Remove the unused `preflightGate` arg

- [ ] **Step 1: Remove `preflightGate` field from `StartClaudeSessionPtyArgs`**

In `src/server/claude-pty/driver.ts`, delete the `preflightGate?: PreflightGate` property from the `StartClaudeSessionPtyArgs` interface (around line 58). Delete the import of `PreflightGate` (line 11).

Also delete the `void args.preflightGate` line inside `startClaudeSessionPTY` (~line 295) and its surrounding comment.

- [ ] **Step 2: Update agent.ts to drop preflightGate plumbing**

In `src/server/agent.ts`:

- Delete the import: `import type { PreflightGate } from "./claude-pty/preflight/gate"` (line ~61)
- Delete `preflightGate?: PreflightGate` from `AgentCoordinatorArgs` (line ~237)
- Delete `private readonly preflightGate: PreflightGate | null` (line ~1111)
- Delete `this.preflightGate = args.preflightGate ?? null` (line ~1175)
- Find each of the 3 sites that pass `preflightGate: this.preflightGate ?? undefined` to `startClaudeSessionPTY*` (lines ~1540, ~2157, ~2390 per the earlier grep) and delete just that one property from each object literal.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon && bun test src/server/`

Expected: tests under `src/server/claude-pty/preflight/` may now have import errors — that's fine, they're deleted in task 8. All other tests must pass.

If tests fail because some test file still passes `preflightGate` to `startClaudeSessionPTY` constructor, delete those test args too.

- [ ] **Step 4: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/driver.ts src/server/claude-pty/driver.test.ts src/server/agent.ts
git -c commit.gpgsign=false commit -m "refactor(claude-pty): drop unused preflightGate arg from driver+agent

driver.ts has not consumed preflightGate since the inline preflight
removal — arg was dead code. Agent coordinator + 3 spawn sites also
drop the field. preflight subdir files themselves removed in a later
commit so this stays surgical."
```

### Task 6.3: Wire smoke-test gate + binary fingerprint into driver

- [ ] **Step 1: Add cache implementation and probe injection point**

Append to `src/server/claude-pty/smoke-test.ts`:

```ts
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { existsSync } from "node:fs"

/**
 * On-disk smoke-test cache: one JSON file per (binarySha256, model) under
 * `${homeDir}/.kanna/cache/smoke-test/`. JSON shape matches SmokeTestCacheEntry.
 * Used by the driver in production; in-memory cache used by tests.
 */
export function createFileSmokeTestCache(args: { cacheDir: string }): SmokeTestCache {
  const dir = args.cacheDir
  const fileFor = (key: string) => path.join(dir, `${key.replace(/[^a-z0-9._-]/gi, "_")}.json`)
  return {
    async get(key) {
      const fp = fileFor(key)
      if (!existsSync(fp)) return null
      try {
        const raw = await readFile(fp, "utf8")
        const parsed = JSON.parse(raw) as SmokeTestCacheEntry
        if (parsed.result !== "pass" && parsed.result !== "fail") return null
        if (typeof parsed.ts !== "number") return null
        return parsed
      } catch {
        return null
      }
    },
    async set(key, entry) {
      await mkdir(dir, { recursive: true })
      await writeFile(fileFor(key), JSON.stringify(entry), { encoding: "utf8", mode: 0o600 })
    },
    async invalidate() {
      try { await rm(dir, { recursive: true, force: true }) } catch { /* swallow */ }
    },
  }
}
```

- [ ] **Step 2: Add cache test**

Append to `src/server/claude-pty/smoke-test.test.ts`:

```ts
import { createFileSmokeTestCache } from "./smoke-test"

describe("createFileSmokeTestCache", () => {
  test("round-trips an entry through disk", async () => {
    const dir = path.join(workHome, "smoke-cache")
    const cache = createFileSmokeTestCache({ cacheDir: dir })
    await cache.set("abc|m1", { result: "pass", ts: 1234 })
    const got = await cache.get("abc|m1")
    expect(got).toEqual({ result: "pass", ts: 1234 })
  })

  test("returns null on missing key", async () => {
    const cache = createFileSmokeTestCache({ cacheDir: path.join(workHome, "smoke-cache-2") })
    const got = await cache.get("missing|m1")
    expect(got).toBeNull()
  })

  test("invalidate wipes the dir", async () => {
    const dir = path.join(workHome, "smoke-cache-3")
    const cache = createFileSmokeTestCache({ cacheDir: dir })
    await cache.set("xxx|m", { result: "pass", ts: 1 })
    await cache.invalidate()
    expect(await cache.get("xxx|m")).toBeNull()
  })
})
```

- [ ] **Step 3: Run smoke-test tests**

Run: `bun test src/server/claude-pty/smoke-test.test.ts`

Expected: all PASS (including the new file-cache tests).

- [ ] **Step 4: Add smoke-test gate plumbing to driver (still using old pipes — wiring only)**

In `src/server/claude-pty/driver.ts`, near the other imports, add:

```ts
import { createSmokeTestGate, createFileSmokeTestCache, type SmokeTestGate, type SmokeTestProbeFn } from "./smoke-test"
import { computeBinarySha256 } from "./preflight/binary-fingerprint"
```

Add a new optional arg to `StartClaudeSessionPtyArgs`:

```ts
  /**
   * Override the smoke-test gate. Production callers leave this undefined;
   * tests inject a permissive gate so they don't have to spawn a real claude
   * binary just to run a unit test. Default behavior: gate constructed from
   * a real probe (Task 6.6 wires the probe implementation).
   */
  smokeTestGate?: SmokeTestGate
```

For now, in `startClaudeSessionPTY`, after `resolveClaudeBinary` succeeds but BEFORE spawning, add:

```ts
  // Smoke test: confirm --disallowedTools is honored by this binary + model.
  // Replaces the deleted 8-probe preflight gate. Cached per (binarySha256, model).
  const binarySha256 = await computeBinarySha256(claudeBinAbs)
  if (args.smokeTestGate) {
    const smoke = await args.smokeTestGate.canSpawn({ binarySha256, model: args.model })
    if (!smoke.ok) {
      console.error("[kanna/pty] smoke-test refused spawn", { chatId: args.chatId, reason: smoke.reason })
      throw new Error(`PTY smoke-test refused spawn: ${smoke.reason}`)
    }
  }
  // Note: default-gate construction (probe implementation) lands in Task 6.6
  // alongside the live TUI integration.
```

- [ ] **Step 5: Add driver test for smoke-test refusal**

Append to `src/server/claude-pty/driver.test.ts`:

```ts
import { createSmokeTestGate } from "./smoke-test"

describe("startClaudeSessionPTY smoke-test gate", () => {
  test("refuses spawn when gate returns ok:false", async () => {
    const failingGate = createSmokeTestGate({
      probe: async () => "fail",
      cache: {
        async get() { return null },
        async set() { /* noop */ },
        async invalidate() { /* noop */ },
      },
      ttlMs: 1000,
      now: () => 0,
    })
    await expect(startClaudeSessionPTY({
      chatId: "c1", projectId: "p1", localPath: "/tmp",
      model: "claude-opus-4-7", planMode: false, forkSession: false,
      oauthToken: "test-token", sessionToken: null,
      onToolRequest: async () => null,
      smokeTestGate: failingGate,
      env: { CLAUDE_EXECUTABLE: "/bin/true", HOME: "/tmp" },
    })).rejects.toThrow(/smoke-test refused/i)
  })
})
```

(`/bin/true` is portable on macOS/Linux and acts as a placeholder binary for the sha256 step; the smoke-test refusal triggers before the actual spawn.)

- [ ] **Step 6: Run driver tests**

Run: `bun test src/server/claude-pty/driver.test.ts -t smoke-test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/smoke-test.ts src/server/claude-pty/smoke-test.test.ts src/server/claude-pty/driver.ts src/server/claude-pty/driver.test.ts
git -c commit.gpgsign=false commit -m "feat(claude-pty): wire smoke-test gate into driver

Driver now refuses spawn when smoke-test gate returns ok:false. Gate
is optional/injectable; production wiring (with the real TUI probe
implementation) lands in the driver rewrite commit. File-backed cache
lives under \${homeDir}/.kanna/cache/smoke-test/.

binary-fingerprint.ts (only surviving preflight module) supplies the
sha256 used as the cache key."
```

### Task 6.4: Replace `Bun.spawn` pipes with `spawnPtyProcess` and remove stdin envelope writer

This is the cutover step. Touches the most lines.

- [ ] **Step 1: Write failing integration test for new flow**

Append to `src/server/claude-pty/driver.test.ts`:

```ts
import { spawnPtyProcess } from "./pty-process"
import type { PtyProcess } from "./pty-process"

describe("startClaudeSessionPTY TUI flow integration", () => {
  test("spawns via spawnPtyProcess, sends prompt as text, drains transcript", async () => {
    // Fake pty captures input + lets us script output
    const sent: string[] = []
    let onOutputCb: ((chunk: string) => void) | null = null
    let exitResolver: (n: number) => void
    const fakeExited = new Promise<number>((r) => { exitResolver = r })
    const fakePty: PtyProcess = {
      async sendInput(d) { sent.push(d) },
      resize() { /* noop */ },
      exited: fakeExited,
      close() { exitResolver(0) },
    }
    const fakeSpawn: typeof spawnPtyProcess = async (opts) => {
      onOutputCb = opts.onOutput ?? null
      // Simulate trust-dialog + welcome render
      setTimeout(() => {
        onOutputCb?.("Quick safety check: Is this a project you created or one you trust?")
        onOutputCb?.("\n❯ ")
      }, 10)
      return fakePty
    }
    // ... assertions below; full test wired after Step 2 implementation
    expect(typeof fakeSpawn).toBe("function")
  })
})
```

This test is a placeholder; the full integration assertions come after the driver is rewritten in Step 3. The test exists to lock in the injection-point shape.

- [ ] **Step 2: Add `spawnPtyProcess` injection arg**

In `src/server/claude-pty/driver.ts`, add to `StartClaudeSessionPtyArgs`:

```ts
  /**
   * Inject a fake spawnPtyProcess for tests. Production uses the real
   * Bun.Terminal implementation from ./pty-process.
   */
  spawnPtyProcess?: typeof spawnPtyProcess
```

Add the import: `import { spawnPtyProcess as defaultSpawnPtyProcess, type PtyProcess } from "./pty-process"` near the other imports.

- [ ] **Step 3: Replace the spawn block in `startClaudeSessionPTY`**

This is the core rewrite. In `src/server/claude-pty/driver.ts`, replace EVERYTHING from the `let proc: SpawnedProcess` declaration (~line 413) through the end of the `pumpStdout` / `pumpStderr` setup (~line 514) with:

```ts
  const ring = new OutputRing()
  const spawnPty = args.spawnPtyProcess ?? defaultSpawnPtyProcess
  let pty: PtyProcess
  try {
    console.log("[kanna/pty] spawn begin", {
      chatId: args.chatId,
      command: claudeBin,
      cwd: args.localPath,
      argCount: cliArgs.length,
    })
    pty = await spawnPty({
      command: claudeBin,
      args: cliArgs,
      cwd: args.localPath,
      env: spawnEnv,
      onOutput: (chunk) => { ring.append(chunk) },
    })
    console.log("[kanna/pty] pty spawned", { chatId: args.chatId, sessionId })
  } catch (err) {
    console.error("[kanna/pty] spawn failed", {
      chatId: args.chatId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    try { await mcpHandle.close() } catch { /* swallow */ }
    try { await rm(runtimeDir, { recursive: true, force: true }) } catch { /* swallow */ }
    throw err
  }

  // Wait for the TUI to render its input box (or hard-cap timeout).
  const tuiReadyMs = Number(env.KANNA_PTY_TUI_BOOT_MS ?? 3000)
  const readyResult = await waitForTuiReady(ring, { hardCapMs: tuiReadyMs })
  if (readyResult === "timeout") {
    console.warn("[kanna/pty] TUI ready marker not detected within hard cap", { chatId: args.chatId, hardCapMs: tuiReadyMs })
  }

  // Dismiss trust dialog if present (first spawn per cwd only — claude
  // persists trust across spawns in the same cwd).
  const trustDismiss = env.KANNA_PTY_TRUST_DISMISS ?? "enabled"
  if (trustDismiss !== "disabled") {
    const dismissed = await dismissTrustDialogIfPresent(pty, ring)
    if (dismissed) {
      console.log("[kanna/pty] trust dialog dismissed", { chatId: args.chatId })
      // Let TUI redraw past the dialog
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  // Open transcript-file event stream. For resume / fork, the file path is
  // known up front. For new sessions, tui-source watches the project dir
  // and discovers the file on first user prompt.
  const projectDir = computeProjectDir({ homeDir: home, cwd: args.localPath })
  const knownFilePath = args.sessionToken && !args.forkSession
    ? computeJsonlPath({ homeDir: home, cwd: args.localPath, sessionId: args.sessionToken })
    : undefined
  const transcriptStream = await startTranscriptStream({
    projectDir,
    knownFilePath,
    pollMode: env.KANNA_PTY_TRANSCRIPT_WATCH === "poll",
  })

  // Pipe JSONL lines through the parser into the merged event queue.
  void (async () => {
    try {
      for await (const line of transcriptStream.lines) {
        try {
          const events = parser.parse(line)
          for (const ev of events) pushMerged(ev)
        } catch (err) {
          console.warn("[kanna/pty] parser threw on line", err)
        }
      }
    } catch (err) {
      console.warn("[kanna/pty] transcript stream errored", err)
    }
  })()
```

Also REMOVE:

- `interface StdinWriter { ... }` and `interface SpawnedProcess { ... }` declarations (no longer needed).
- The whole `pumpStdout` function (~lines 461-493).
- The whole `pumpStderr` function (~lines 495-507).
- The `void pumpStdout(...)` and `void pumpStderr(...)` calls (~lines 509-514).

Add the imports for the new helpers at the top of the file:

```ts
import { OutputRing } from "./output-ring"
import { waitForTuiReady, dismissTrustDialogIfPresent, sendUserPrompt, sendExitCommand } from "./tui-control"
import { startTranscriptStream } from "./tui-source"
import { encodeCwd, computeJsonlPath, computeProjectDir } from "./jsonl-path"
```

Remove the old `import { OutputRing, OUTPUT_RING_DEFAULT_BYTES } from "./output-ring"` re-export line added in Task 2.5 (no longer needed since we import directly).

- [ ] **Step 4: Replace stdin envelope writer with text-prompt writer**

In `src/server/claude-pty/driver.ts`, delete the `writeJsonLine` function entirely (~lines 553-558).

Replace the `if (args.initialPrompt)` block with:

```ts
  if (args.initialPrompt) {
    try {
      await sendUserPrompt(pty, args.initialPrompt)
    } catch (err) {
      console.warn("[kanna/pty] initialPrompt write failed", err)
    }
  }
```

Replace the `sendPrompt` returned method with:

```ts
    sendPrompt: async (content) => {
      // Content from agent.ts can be string or content-block array. TUI mode
      // submits raw text only — flatten any block array to its text segments.
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((c) => (c && typeof c === "object" && "type" in c && (c as { type: string }).type === "text" ? ((c as { text?: string }).text ?? "") : ""))
              .join("\n")
          : String(content)
      await sendUserPrompt(pty, text)
    },
```

Replace the `interrupt` returned method body — keep SIGINT signal behavior but issue via `pty.close()` (Bun.Terminal lacks a kill(signal) — close() terminates). For graceful interrupt in TUI mode, send Ctrl+C (0x03):

```ts
    interrupt: async () => {
      try { await pty.sendInput("\x03") } catch { /* swallow */ }
    },
```

Replace the `setModel` returned method body (no longer can send `control_request` envelopes — TUI uses `/model` slash command):

```ts
    setModel: async (model) => {
      try {
        await pty.sendInput(`/model ${model}\r`)
      } catch (err) {
        console.warn("[kanna/pty] setModel via /model slash command failed", err)
      }
    },
```

Replace the `setPermissionMode` returned method body:

```ts
    setPermissionMode: async (planMode) => {
      if (planMode) {
        try { await pty.sendInput("/plan\r") } catch (err) {
          console.warn("[kanna/pty] /plan slash command failed", err)
        }
        return
      }
      // Exiting plan mode requires the Shift+Tab TUI cycle whose keypress
      // count depends on unobservable TUI state. Deferred per spec F1.
      console.warn(PLAN_MODE_EXIT_UNSUPPORTED)
    },
```

Replace the `close` returned method body:

```ts
    close: () => {
      if (closed) return
      closed = true
      void (async () => {
        try { await sendExitCommand(pty) } catch { /* swallow */ }
        const sigkillTimer = { ref: null as ReturnType<typeof setTimeout> | null }
        const termTimer = setTimeout(() => {
          try { pty.close() } catch { /* swallow */ }
          sigkillTimer.ref = setTimeout(() => {
            try { pty.close() } catch { /* swallow */ }
          }, 3000)
        }, 2000)
        try {
          await pty.exited
          clearTimeout(termTimer)
          if (sigkillTimer.ref !== null) clearTimeout(sigkillTimer.ref)
        } catch { /* swallow */ }
        try { transcriptStream.close() } catch { /* swallow */ }
        await cleanupResources()
        while (mergedWaiters.length > 0) {
          const w = mergedWaiters.shift()
          if (w) w({ value: undefined as unknown as HarnessEvent, done: true })
        }
      })()
    },
```

Replace the `oneShotClose` function:

```ts
  let oneShotClosing = false
  async function oneShotClose() {
    if (oneShotClosing || closed) return
    oneShotClosing = true
    try { await sendExitCommand(pty) } catch { /* swallow */ }
    try { await pty.exited } catch { /* swallow */ }
    try { transcriptStream.close() } catch { /* swallow */ }
    await cleanupResources()
  }
```

Replace the `drainTerminate` reference to `proc.exited`:

```ts
  void pty.exited
    .then((code) => drainTerminate(typeof code === "number" ? code : null))
    .catch(() => drainTerminate(null))
```

Inside `drainTerminate`, replace `stderrRing.tail().trim()` with `ring.tail().trim()` and remove the `stderrRing` declaration (`const stderrRing = new OutputRing()` near line 356) since `ring` already exists in scope.

- [ ] **Step 5: Update PLAN_MODE_EXIT_UNSUPPORTED text**

Replace the `PLAN_MODE_EXIT_UNSUPPORTED` constant (~line 99-101) with:

```ts
export const PLAN_MODE_EXIT_UNSUPPORTED =
  "[claude-pty] leaving plan mode at runtime is unsupported in TUI mode "
  + "(no slash command exits plan; the only exit is the Shift+Tab TUI cycle "
  + "whose keypress count depends on unobservable TUI state). Restart the session to return to acceptEdits."
```

Delete the `planModeRuntimeAction` function and `PlanModeRuntimeAction` type (~lines 103-115) — no longer used since `setPermissionMode` was rewritten inline above.

If any test in `driver.test.ts` references `planModeRuntimeAction` or `PlanModeRuntimeAction`, delete those tests too.

- [ ] **Step 6: Run all driver tests**

Run: `bun test src/server/claude-pty/driver.test.ts`

Expected: most pass. Failures will be in tests that exercised the deleted stdin-envelope path or the `pumpStdout` behavior. Edit those tests one-by-one:

- Any test asserting `proc.stdin.write` called with a JSON envelope → rewrite to assert `fakePty.sent` contains the user prompt.
- Any test that pushed JSONL into `proc.stdout` → rewrite to write JSONL into a fake transcript file inside `projectDir`, with `startTranscriptStream` watching it.

If the test surface is too large to fix in this commit, mark broken tests with `test.skip(...)` and add a TODO referencing Task 7 (parity-matrix retarget) — Task 7 fixes the broader test infrastructure.

- [ ] **Step 7: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/driver.ts src/server/claude-pty/driver.test.ts
git -c commit.gpgsign=false commit -m "feat(claude-pty)!: cutover driver to TUI + transcript-watch

Replaces Bun.spawn pipes (stdin/stdout) with spawnPtyProcess (Bun.Terminal)
and the on-disk transcript file as event source:

- Spawn via Bun.Terminal so claude renders its interactive TUI
- waitForTuiReady polls the OutputRing for '❯ '
- dismissTrustDialogIfPresent sends Enter if claude shows trust dialog
- tui-source watches ~/.claude/projects/<encoded-cwd>/ for the JSONL
  file claude creates on first user prompt, then follows it
- sendUserPrompt writes 'text\\r' (no JSONL envelopes)
- sendExitCommand for graceful oneShot REPL close
- /model and /plan slash commands replace control_request envelopes
- Ctrl+C (0x03) replaces SIGINT for interrupt
- Plan-mode exit becomes warn-only (deferred to follow-up per spec F1)

Some driver.test.ts cases are skip()'d pending Task 7 retarget; this
commit lands the cutover so end-to-end testing can begin."
```

### Task 6.5: Wire the live smoke-test probe

The smoke-test gate was injected as a stub in Task 6.3. Now provide the production probe that actually spawns a TUI claude with `--disallowedTools Bash` and inspects the transcript.

- [ ] **Step 1: Add probe implementation to smoke-test.ts**

Append to `src/server/claude-pty/smoke-test.ts`:

```ts
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { spawnPtyProcess as defaultSpawnPtyProcess } from "./pty-process"
import { OutputRing } from "./output-ring"
import { waitForTuiReady, dismissTrustDialogIfPresent, sendUserPrompt, sendExitCommand } from "./tui-control"
import { startTranscriptStream, waitForResultEntry } from "./tui-source"
import { computeProjectDir } from "./jsonl-path"

export interface BuildLiveSmokeProbeArgs {
  claudeBinPath: string
  model: string
  oauthToken: string
  homeDir: string
  spawnPtyProcess?: typeof defaultSpawnPtyProcess
}

/**
 * Probe that spawns a real TUI claude with --disallowedTools Bash and asks
 * the model to run a Bash command. PASS = no tool_use for Bash in the
 * resulting transcript. FAIL = tool_use for Bash present (regression).
 *
 * Used by createSmokeTestGate as the probe arg. Burns one real subscription
 * turn per cache miss (~9-12s).
 */
export function buildLiveSmokeProbe(args: BuildLiveSmokeProbeArgs): SmokeTestProbeFn {
  const spawnPty = args.spawnPtyProcess ?? defaultSpawnPtyProcess
  return async () => {
    const tmpCwd = await mkdtemp(path.join(tmpdir(), "kanna-smoke-cwd-"))
    const ring = new OutputRing()
    const cliArgs = [
      "--model", args.model,
      "--permission-mode", "acceptEdits",
      "--dangerously-skip-permissions",
      "--disallowedTools", "Bash",
    ]
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env }
    delete spawnEnv.ANTHROPIC_API_KEY
    spawnEnv.HOME = args.homeDir
    spawnEnv.CLAUDE_CODE_OAUTH_TOKEN = args.oauthToken
    const pty = await spawnPty({
      command: args.claudeBinPath,
      args: cliArgs,
      cwd: tmpCwd,
      env: spawnEnv,
      onOutput: (chunk) => ring.append(chunk),
    })
    let probeResult: "pass" | "fail" = "pass"
    try {
      await waitForTuiReady(ring, { hardCapMs: 8000 })
      await dismissTrustDialogIfPresent(pty, ring)
      await new Promise((r) => setTimeout(r, 500))
      await sendUserPrompt(pty, "Run the command ls -la /tmp using the Bash tool now. Just do it.")
      const projectDir = computeProjectDir({ homeDir: args.homeDir, cwd: tmpCwd })
      const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 15_000 })
      try {
        const filePath = await stream.filePath
        await waitForResultEntry(stream, { timeoutMs: 30_000 })
        // Scan transcript for tool_use of Bash
        const raw = await readFile(filePath, "utf8")
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue
          let parsed: { message?: { content?: Array<{ type?: string; name?: string }> } }
          try { parsed = JSON.parse(line) } catch { continue }
          const blocks = parsed.message?.content
          if (!Array.isArray(blocks)) continue
          for (const b of blocks) {
            if (b?.type === "tool_use" && b.name === "Bash") {
              probeResult = "fail"
            }
          }
        }
      } finally {
        stream.close()
      }
    } catch (err) {
      console.warn("[kanna/pty] smoke probe errored, treating as FAIL", err)
      probeResult = "fail"
    } finally {
      try { await sendExitCommand(pty) } catch { /* swallow */ }
      try { pty.close() } catch { /* swallow */ }
      try { await rm(tmpCwd, { recursive: true, force: true }) } catch { /* swallow */ }
    }
    return probeResult
  }
}
```

- [ ] **Step 2: Wire default smoke-test gate construction in the driver**

In `src/server/claude-pty/driver.ts`, replace the smoke-test gate block from Task 6.3 with:

```ts
  // Smoke test: confirm --disallowedTools is honored by this binary + model.
  // Cached per (binarySha256, model) under ${HOME}/.kanna/cache/smoke-test/.
  // Burns one real subscription turn per cache miss (~9-12s).
  const binarySha256 = await computeBinarySha256(claudeBinAbs)
  const smokeGate = args.smokeTestGate ?? createSmokeTestGate({
    probe: buildLiveSmokeProbe({
      claudeBinPath: claudeBinAbs,
      model: args.model,
      oauthToken: args.oauthToken ?? "",
      homeDir: home,
    }),
    cache: createFileSmokeTestCache({ cacheDir: path.join(home, ".kanna", "cache", "smoke-test") }),
    ttlMs: 24 * 3600 * 1000,
    now: () => Date.now(),
  })
  const smoke = await smokeGate.canSpawn({ binarySha256, model: args.model })
  if (!smoke.ok) {
    console.error("[kanna/pty] smoke-test refused spawn", { chatId: args.chatId, reason: smoke.reason })
    try { await mcpHandle.close() } catch { /* swallow */ }
    try { await rm(runtimeDir, { recursive: true, force: true }) } catch { /* swallow */ }
    throw new Error(`PTY smoke-test refused spawn: ${smoke.reason}`)
  }
```

Add the import: `import { buildLiveSmokeProbe } from "./smoke-test"`.

- [ ] **Step 3: Make sure tests still pass**

Run: `bun test src/server/claude-pty/`

Expected: smoke-test tests pass. Driver tests pass (smoke-test gate is injected in tests). Skip()'d tests from Task 6.4 remain skip()'d.

- [ ] **Step 4: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/smoke-test.ts src/server/claude-pty/driver.ts
git -c commit.gpgsign=false commit -m "feat(claude-pty): live smoke probe for TUI --disallowedTools

buildLiveSmokeProbe spawns a real TUI claude with --disallowedTools Bash
and prompts the model to invoke Bash. PASS if no tool_use for Bash in
transcript; FAIL refuses spawn.

Burns one subscription turn per cache miss (~9-12s). Cached 24h per
(binarySha256, model) under \${HOME}/.kanna/cache/smoke-test/."
```

---

## Task 7: Retarget `parity-matrix.test.ts` to feed via fake transcript file

Spec preserves all 7 fixture assertions. Source changes from "feed raw JSONL lines into `createJsonlEventParser`" to "write JSONL into a fake transcript file, run via `startTranscriptStream`, pipe lines into `createJsonlEventParser`".

**Files:**
- Modify: `src/server/claude-pty/parity-matrix.test.ts`

- [ ] **Step 1: Read the existing test**

Run: `cat src/server/claude-pty/parity-matrix.test.ts`

Find the fixture-iteration block. Currently it serializes each fixture message to JSON and calls `parser.parse(line)` directly. Need to keep that path but ADD a second path that writes the same JSON to a fake transcript file and reads through `startTranscriptStream`.

- [ ] **Step 2: Add the retargeted PTY path**

Replace the existing PTY iteration block in `parity-matrix.test.ts` with:

```ts
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startTranscriptStream } from "./tui-source"

async function ptyEventsViaTranscriptStream(messages: unknown[], configuredContextWindow?: number) {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "kanna-parity-"))
  const projectDir = path.join(tmpDir, "projects", "fake")
  await (await import("node:fs/promises")).mkdir(projectDir, { recursive: true })
  const filePath = path.join(projectDir, "fixture.jsonl")
  await writeFile(filePath, "")
  const stream = await startTranscriptStream({ projectDir, knownFilePath: filePath, firstFileTimeoutMs: 2000 })
  const parser = createJsonlEventParser({ configuredContextWindow })
  const events: HarnessEvent[] = []
  // Write messages with small delays so the watcher emits them as discrete updates
  const writeAll = (async () => {
    for (const m of messages) {
      await appendFile(filePath, JSON.stringify(m) + "\n")
      await new Promise((r) => setTimeout(r, 5))
    }
    // Sentinel: write a final no-op line that the test reads to know all
    // fixture lines have been delivered before we close.
    await appendFile(filePath, '{"type":"__parity_sentinel__"}\n')
  })()
  const collectDone = (async () => {
    for await (const line of stream.lines) {
      let parsed: { type?: string }
      try { parsed = JSON.parse(line) } catch { continue }
      if (parsed.type === "__parity_sentinel__") break
      for (const ev of parser.parse(line)) events.push(ev)
    }
  })()
  await writeAll
  await collectDone
  stream.close()
  await rm(tmpDir, { recursive: true, force: true })
  return events
}
```

For each existing fixture test, replace the `const ptyEvents = ...` line with `const ptyEvents = await ptyEventsViaTranscriptStream(fixtureMessages, configuredContextWindow)`. Keep the SDK path unchanged.

- [ ] **Step 3: Run the test**

Run: `bun test src/server/claude-pty/parity-matrix.test.ts`

Expected: all 7 fixture cases still PASS. The new path exercises `tui-source` end-to-end with real `fs.watch` semantics. If the test is flaky on slow CI, bump the inter-message sleep from 5ms to 20ms.

- [ ] **Step 4: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/parity-matrix.test.ts
git -c commit.gpgsign=false commit -m "test(claude-pty): retarget parity matrix to feed via tui-source

Same 7 SDK↔PTY equivalence fixtures, but the PTY path now writes JSONL
into a tmpdir transcript file and reads back through startTranscriptStream
+ createJsonlEventParser. Confirms end-to-end source-and-parse equivalence
for the new transport.

Sentinel '__parity_sentinel__' line marks fixture-end so the watcher
loop can exit cleanly without polling."
```

---

## Task 8: Delete dead preflight modules

The driver no longer imports anything from `preflight/` except `binary-fingerprint.ts`. Agent.ts already drops its `PreflightGate` import in Task 6.2. Now delete the dead files.

**Files:**
- Delete: `src/server/claude-pty/preflight/gate.ts`, `gate.test.ts`
- Delete: `src/server/claude-pty/preflight/suite.ts`, `suite.test.ts`
- Delete: `src/server/claude-pty/preflight/probe.ts`, `probe.test.ts`
- Delete: `src/server/claude-pty/preflight/cache.ts`, `cache.test.ts`
- Delete: `src/server/claude-pty/preflight/types.ts`, `types.test.ts`

- [ ] **Step 1: Verify no live imports remain**

Run:
```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
grep -rn "preflight/gate\|preflight/suite\|preflight/probe\|preflight/cache\b\|preflight/types" src/ --include="*.ts" | grep -v "/preflight/"
```

Expected: no output (no imports outside the preflight dir itself).

If anything prints, fix that file before deleting.

- [ ] **Step 2: Delete the files**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
rm src/server/claude-pty/preflight/gate.ts
rm src/server/claude-pty/preflight/gate.test.ts
rm src/server/claude-pty/preflight/suite.ts
rm src/server/claude-pty/preflight/suite.test.ts
rm src/server/claude-pty/preflight/probe.ts
rm src/server/claude-pty/preflight/probe.test.ts
rm src/server/claude-pty/preflight/cache.ts
rm src/server/claude-pty/preflight/cache.test.ts
rm src/server/claude-pty/preflight/types.ts
rm src/server/claude-pty/preflight/types.test.ts
```

- [ ] **Step 3: Verify build + tests**

Run:
```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
bun run lint
bun test src/server/claude-pty/
```

Expected: lint PASS, tests PASS (only `binary-fingerprint.test.ts` remains in `preflight/`).

- [ ] **Step 4: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add -A src/server/claude-pty/preflight/
git -c commit.gpgsign=false commit -m "chore(claude-pty): delete preflight subdir (replaced by smoke-test)

8-probe preflight gate is gone — replaced by single TUI smoke test
in Task 5. Keeps binary-fingerprint.ts (still used for smoke-test
cache key). Removes ~700 LOC of code + tests.

KANNA_PTY_PREFLIGHT_MODEL env var also no longer consulted (doc
update in Task 9)."
```

---

## Task 9: Unskip leftover driver tests

Any tests skip()'d in Task 6.4 because they exercised the old stdin-envelope or stdout-pump path must now be either rewritten or deleted. With tui-source + tui-control wired, the proper fake-PTY pattern is available.

**Files:**
- Modify: `src/server/claude-pty/driver.test.ts`

- [ ] **Step 1: List skip()'d tests**

Run:
```bash
grep -n "test.skip\|test\.skip\|it\.skip" src/server/claude-pty/driver.test.ts
```

For each result, decide:
- If the test was asserting old `--print`-mode behavior that no longer makes sense (e.g. "stdin gets a stream-json envelope"), DELETE the test.
- If the test was asserting general driver behavior (cleanup, account info, oneShot, account-info derivation), rewrite to use the fake-PTY + fake-transcript-file pattern from the parity-matrix retarget.

- [ ] **Step 2: Add a shared fake-PTY helper for driver tests**

Near the top of `src/server/claude-pty/driver.test.ts`, add:

```ts
import type { PtyProcess, SpawnPtyProcessArgs } from "./pty-process"
import { mkdtemp, writeFile, appendFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

interface FakePtyHandle {
  sent: string[]
  emit(chunk: string): void
  exit(code: number): void
  exited: Promise<number>
  pty: PtyProcess
}

function makeFakePty(): FakePtyHandle {
  const sent: string[] = []
  let exitResolver: (n: number) => void = () => { /* noop */ }
  const exited = new Promise<number>((r) => { exitResolver = r })
  let onOutput: ((chunk: string) => void) | null = null
  const pty: PtyProcess = {
    async sendInput(d) { sent.push(d) },
    resize() { /* noop */ },
    exited,
    close() { exitResolver(0) },
  }
  // Bind onOutput when spawnPtyProcess fake reads opts
  const handle: FakePtyHandle = {
    sent,
    emit(chunk) { onOutput?.(chunk) },
    exit(code) { exitResolver(code) },
    exited,
    pty,
  }
  // Expose the onOutput setter
  ;(pty as PtyProcess & { __setOnOutput: (cb: (c: string) => void) => void }).__setOnOutput = (cb) => { onOutput = cb }
  return handle
}

function makeFakeSpawnPtyProcess(handle: FakePtyHandle): (opts: SpawnPtyProcessArgs) => Promise<PtyProcess> {
  return async (opts) => {
    if (opts.onOutput) {
      ;(handle.pty as PtyProcess & { __setOnOutput: (cb: (c: string) => void) => void }).__setOnOutput(opts.onOutput)
    }
    // Emit the input-box marker so waitForTuiReady resolves immediately
    setTimeout(() => handle.emit("❯ "), 5)
    return handle.pty
  }
}

interface FakeTranscriptHandle {
  projectDir: string
  filePath: string
  writeLine(obj: unknown): Promise<void>
  cleanup(): Promise<void>
}

async function makeFakeTranscript(): Promise<FakeTranscriptHandle> {
  const tmp = await mkdtemp(path.join(tmpdir(), "kanna-driver-test-"))
  const projectDir = path.join(tmp, ".claude", "projects", "fake")
  await mkdir(projectDir, { recursive: true })
  const filePath = path.join(projectDir, "fixture.jsonl")
  await writeFile(filePath, "")
  return {
    projectDir,
    filePath,
    async writeLine(obj) { await appendFile(filePath, JSON.stringify(obj) + "\n") },
    async cleanup() { await rm(tmp, { recursive: true, force: true }) },
  }
}
```

- [ ] **Step 3: Rewrite each unskip()'d test using the helpers**

For each formerly-skipped test, the pattern is:

```ts
test("driver emits result event end-to-end", async () => {
  const fake = makeFakePty()
  const transcript = await makeFakeTranscript()
  try {
    const handle = await startClaudeSessionPTY({
      chatId: "c1", projectId: "p1", localPath: "/tmp",
      model: "claude-opus-4-7", planMode: false, forkSession: false,
      oauthToken: "test-token", sessionToken: null,
      onToolRequest: async () => null,
      smokeTestGate: { canSpawn: async () => ({ ok: true }) },
      spawnPtyProcess: makeFakeSpawnPtyProcess(fake),
      env: { CLAUDE_EXECUTABLE: "/bin/true", HOME: path.dirname(path.dirname(path.dirname(transcript.projectDir))) },
      // Override the projectDir to point at our fake. The driver computes
      // projectDir via computeProjectDir(homeDir, localPath); supplying
      // a HOME under the same tmp parent and localPath=/tmp/<sub> aligns
      // the encoded path with the fake.
    })
    const iter = handle.stream[Symbol.asyncIterator]()
    await transcript.writeLine({ type: "system", subtype: "init", session_id: "s1" })
    await transcript.writeLine({ type: "result", subtype: "success", duration_ms: 100, result: "ok" })
    const collected: unknown[] = []
    while (true) {
      const next = await Promise.race([
        iter.next(),
        new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), 2000)),
      ])
      if ((next as { done: boolean }).done) break
      collected.push((next as { value: unknown }).value)
      if (collected.length > 10) break
    }
    expect(collected.length).toBeGreaterThan(0)
    handle.close()
  } finally {
    await transcript.cleanup()
  }
})
```

Adapt the assertions for each specific test (oneShot closes after first result, account-info derived from oauthLabel, ringbuf failure synthesis on silent exit, etc.).

**Note about `HOME` and the fake project dir:** the driver computes `projectDir = computeProjectDir({ homeDir: HOME, cwd: localPath })`. The simplest way to make this match a fake transcript dir is to set `localPath` to a real tmpdir and let `encodeCwd` resolve it; then write your fake JSONL into the resulting path. The helper above creates a parent tmp + the encoded subpath as a single layout — adjust the path arithmetic in the test to point at the right place. If this becomes painful, add a `projectDirOverride` test-only arg to `StartClaudeSessionPtyArgs`.

- [ ] **Step 4: Run all tests**

Run: `bun test src/server/claude-pty/`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/driver.test.ts
git -c commit.gpgsign=false commit -m "test(claude-pty): rewrite skip()'d driver tests for TUI transport

Restore coverage that was temporarily skip()'d during the cutover.
Shared fake-PTY + fake-transcript helpers feed events through the
same code path production uses (tui-source + tui-control + parser)."
```

---

## Task 10: OAuth-pool integration tests

Spec mandates explicit tests covering OAuth-only invariant + pool rotation. Add to `driver.test.ts`.

**Files:**
- Modify: `src/server/claude-pty/driver.test.ts`

- [ ] **Step 1: Add tests**

Append to `src/server/claude-pty/driver.test.ts`:

```ts
import { buildPtyEnv } from "./driver"

describe("OAuth-only invariant", () => {
  test("buildPtyEnv strips ANTHROPIC_API_KEY", () => {
    const env = buildPtyEnv({
      baseEnv: { ANTHROPIC_API_KEY: "should-be-deleted", HOME: "/x", PATH: "/usr/bin" },
      homeDir: "/x",
      oauthToken: "tok",
    })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok")
  })

  test("buildPtyEnv strips ANTHROPIC_API_KEY even when empty", () => {
    const env = buildPtyEnv({
      baseEnv: { ANTHROPIC_API_KEY: "", HOME: "/x", PATH: "/usr/bin" },
      homeDir: "/x",
      oauthToken: "tok",
    })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test("spawned env never includes ANTHROPIC_API_KEY even if parent does", async () => {
    const fake = makeFakePty()
    const transcript = await makeFakeTranscript()
    try {
      let observedEnv: NodeJS.ProcessEnv | undefined
      const spawnSpy: typeof spawnPtyProcess = async (opts) => {
        observedEnv = opts.env
        ;(fake.pty as PtyProcess & { __setOnOutput: (cb: (c: string) => void) => void }).__setOnOutput(opts.onOutput!)
        setTimeout(() => fake.emit("❯ "), 5)
        return fake.pty
      }
      await startClaudeSessionPTY({
        chatId: "c1", projectId: "p1", localPath: "/tmp",
        model: "m", planMode: false, forkSession: false,
        oauthToken: "pool-token-xyz", sessionToken: null,
        onToolRequest: async () => null,
        smokeTestGate: { canSpawn: async () => ({ ok: true }) },
        spawnPtyProcess: spawnSpy,
        env: { ANTHROPIC_API_KEY: "garbage-from-parent", HOME: "/tmp" },
      })
      expect(observedEnv?.ANTHROPIC_API_KEY).toBeUndefined()
      expect(observedEnv?.CLAUDE_CODE_OAUTH_TOKEN).toBe("pool-token-xyz")
    } finally {
      await transcript.cleanup()
    }
  })

  test("derived AccountInfo reflects pool token label + masked key", () => {
    const info = deriveAccountInfoFromOauth({ label: "personal", oauthKeyMasked: "sk-ant-oat01...XXXX" })
    expect(info).toEqual({
      tokenSource: "kanna-oauth-pool",
      organization: "personal",
      oauthKeyMasked: "sk-ant-oat01...XXXX",
    })
  })

  test("derived AccountInfo is null when no pool data supplied", () => {
    expect(deriveAccountInfoFromOauth({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run**

Run: `bun test src/server/claude-pty/driver.test.ts -t "OAuth-only"`

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add src/server/claude-pty/driver.test.ts
git -c commit.gpgsign=false commit -m "test(claude-pty): OAuth-only invariant + pool token plumbing

Asserts ANTHROPIC_API_KEY never reaches the spawned env (even when
parent has it set), and CLAUDE_CODE_OAUTH_TOKEN carries the pool
token end-to-end. Verifies AccountInfo derivation from pool label
+ masked key (the only account signals PTY has)."
```

---

## Task 11: Documentation sync — CLAUDE.md, ADR, env var docs

**Files:**
- Modify: `CLAUDE.md`
- Create: `.c3/adr/adr-2026-05-21-pty-tui-shannon.md`

- [ ] **Step 1: Rewrite "Claude Driver Flag" section in CLAUDE.md**

Open `CLAUDE.md` and find the heading `# Claude Driver Flag (KANNA_CLAUDE_DRIVER)`. Replace the entire section (down to the next `# ` heading) with:

```markdown
# Claude Driver Flag (KANNA_CLAUDE_DRIVER)

Setting `KANNA_CLAUDE_DRIVER=pty` launches the `claude` CLI **interactively**
under a Bun.Terminal pseudo-terminal (Shannon-style) and tails the on-disk
transcript JSONL at `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`
as the sole event source. Input is sent as raw text + `\r` (no JSONL
envelopes). PTY mode preserves Pro/Max subscription billing; SDK mode
bills at API rates.

Default is `sdk` (no behaviour change). Authentication requires an OAuth-pool
token configured in Kanna settings; the token is injected via
`CLAUDE_CODE_OAUTH_TOKEN`. The local `claude /login` keychain path is not
supported in this deployment. PTY mode is OAuth-only and NEVER uses an API
key: `buildPtyEnv` unconditionally strips `ANTHROPIC_API_KEY` from the
spawned child env. `verifyPtyAuth` only requires the OAuth-pool token.

Platform support: macOS / Linux only.

**Encoded cwd path:** Claude resolves the cwd to its real path
(`fs.realpathSync` — macOS `/var` → `/private/var`), then replaces both
`/` and `.` with `-`. `src/server/claude-pty/jsonl-path.ts`
(`encodeCwd`, `computeJsonlPath`, `computeProjectDir`) matches this
behaviour exactly. Mismatch = transcript file never found.

**Trust dialog:** TUI claude prompts "Quick safety check: Is this a project
you created or one you trust?" on every previously-unseen cwd. The driver
detects the marker in the PTY output ring buffer and sends `\r` to accept
"Yes, I trust this folder" (the default-highlighted option). Trust persists
across spawns in the same cwd, so the dismiss cost amortises. Set
`KANNA_PTY_TRUST_DISMISS=disabled` to bypass detection (escape hatch if
Anthropic changes the dialog wording).

**TUI ready signal:** Driver polls the output ring for the input-box marker
`❯ ` before sending the first prompt. Hard cap defaults to 3000 ms
(`KANNA_PTY_TUI_BOOT_MS`).

**Transcript watch:** `tui-source.ts` uses `fs.watch` by default; set
`KANNA_PTY_TRANSCRIPT_WATCH=poll` to force 50 ms polling (for unreliable
filesystems like NFS / CIFS).

**oneShot subagent close:** After the first `result` transcript entry on a
one-shot run (Claude subagent), the driver sends `/exit\r` to gracefully
close the REPL, awaits `pty.exited` with 5 s grace, then escalates SIGTERM →
SIGKILL on hang. Matches the SDK driver's prompt-queue close semantics.

**Smoke test (replaces preflight P3b):** Every spawn passes through a
single TUI probe that verifies `--disallowedTools Bash` is honored.
Cached 24 h per (binarySha256, model) under
`${HOME}/.kanna/cache/smoke-test/`. PASS unlocks spawn; FAIL refuses
with a clear reason that surfaces through the existing spawn-error
path. The 8-probe preflight gate is removed (`KANNA_PTY_PREFLIGHT_MODEL`
no longer consulted).

**AskUserQuestion / ExitPlanMode (issue #215 — CLOSED):** Driver disallows
the native built-ins (`--disallowedTools AskUserQuestion ExitPlanMode`)
and force-registers the `mcp__kanna__ask_user_question` /
`mcp__kanna__exit_plan_mode` shims, which route through the durable
approval protocol to the UI — active regardless of `KANNA_MCP_TOOL_CALLBACKS`.
See the Tool Callback Feature Flag section for full wiring.

**setPermissionMode:** Asymmetric.
- ENTER plan (`planMode === true`) sends the `/plan` slash command via
  `pty.sendInput("/plan\r")`.
- EXIT plan (`planMode === false`) is warn-only — no slash command leaves
  plan mode, and the only exit is the relative Shift+Tab TUI cycle whose
  keypress count depends on unobservable TUI state. Restart the session
  to return to acceptEdits. Tracked: anthropics/claude-code#59891.
  Closing this gap is deferred (spec F1).

**setModel:** Sends `/model <name>\r` via the slash command (no stream-json
control_request envelope in TUI mode).

**interrupt:** Sends `Ctrl+C` (0x03) via PTY stdin — TUI claude treats this
as an interactive interrupt, cancelling the current turn.

**getSupportedCommands():** Static four-command list. Live `/help` parsing
is deferred (spec F2).

**SDK ↔ PTY equivalence (Phase 6):** `src/server/claude-pty/parity-matrix.test.ts`
drives both `createClaudeHarnessStream` (SDK) and `createJsonlEventParser`
fed via `startTranscriptStream` (PTY) with the same SDK-message fixtures and
asserts identical `HarnessEvent` sequences. Covers the original 7 cases
unchanged.

**Subagent + prompt + account parity (Phase 5):** unchanged from prior
phases — `buildClaudeSubagentStarter` adapts the SDK-shaped starter to
`StartClaudeSessionPtyArgs` with `oneShot: true`; both drivers append
the shared `KANNA_SYSTEM_PROMPT_APPEND`; PTY derives `AccountInfo` from
the picked OAuth-pool token label + masked key.

**Failure handling:** Every PTY spawn captures terminal output into a 256 KB
ring buffer (`OutputRing` in `output-ring.ts`). Failure synthesis on silent
exit, auth detection (`401`, "Please run /login", "Not logged in"), and
trust-dialog detection all read from this ring. Synthesised error events
feed the same `detectFromResultText` / OAuth-pool rotation path in
`agent.ts` the SDK driver uses.

**Architecture note:** PTY mode parses the on-disk transcript JSONL file
as the sole event source — `src/server/claude-pty/tui-source.ts`
(`startTranscriptStream`) watches `~/.claude/projects/<encoded-cwd>/`
for the file claude creates on first user prompt, then follows it via
`fs.watch` (or polling under `KANNA_PTY_TRANSCRIPT_WATCH=poll`).
`driver.ts` is a thin coordinator: spawn (via `pty-process.ts`
`spawnPtyProcess` + Bun.Terminal) → trust dismiss → first-prompt send →
pipe transcript lines into `createJsonlEventParser` → emit HarnessEvents.
Nothing reads the PTY stdout for events; the output ring only powers
trust detection + failure synth. Spawn-time `--mcp-config` still wires
the kanna-mcp loopback HTTP server (Phase 2) unchanged.

**OAuth pool rotation (P5):** PTY mode honors the same multi-token rotation
the SDK driver uses. `AgentCoordinator` picks an active token from
`OAuthTokenPool` per chat and the PTY driver injects it via the
`CLAUDE_CODE_OAUTH_TOKEN` env var. Auth failures (401 detected in the
output ring) synthesise an `oauth_invalid_token` result event that feeds
the same rotation/retry path the SDK driver uses on thrown stream errors.

**Env vars (PTY-specific):**
- `KANNA_CLAUDE_DRIVER=sdk|pty` — driver selector (default `sdk`).
- `KANNA_MCP_TOOL_CALLBACKS=1` — route built-in shims through durable approval.
- `KANNA_PTY_TRUST_DISMISS=enabled|disabled` — trust-dialog dismiss (default `enabled`).
- `KANNA_PTY_TUI_BOOT_MS=3000` — hard cap on TUI-ready wait (default `3000`).
- `KANNA_PTY_TRANSCRIPT_WATCH=fs|poll` — transcript watch mode (default `fs`).
- `CLAUDE_CODE_OAUTH_TOKEN` — set by driver from pool, NOT a user env var.

Removed in this version (no longer consulted):
- `KANNA_PTY_PREFLIGHT_MODEL` — preflight gone, replaced by smoke-test.
- `KANNA_PTY_SANDBOX` — sandbox already removed in a prior change; flag now inert.
```

Also: find and DELETE the entire `# Allowlist preflight (P3b):` block (a subsection of the old driver-flag section; the new section above replaces it).

- [ ] **Step 2: Create ADR**

Create `.c3/adr/adr-2026-05-21-pty-tui-shannon.md`:

```markdown
# ADR: PTY driver moves to Shannon-style interactive TUI + transcript-file source

**Date:** 2026-05-21
**Status:** Accepted
**Branch:** `feat/pty-tui-shannon`

## Context

`KANNA_CLAUDE_DRIVER=pty` previously spawned `claude` with
`--print --output-format=stream-json --input-format=stream-json`. The PTY
existed only to give claude a TTY; the real transport was headless
stdout-JSONL + stdin-envelope.

`--print` is upstream's secondary codepath. Many CLI features (slash
commands, `/help`, plan-mode exit, the actual TUI behavior users see
locally) are only available in interactive mode.

## Decision

Hard-cutover the PTY driver to **Shannon-style** transport (after
[dexhorthy/shannon](https://github.com/dexhorthy/shannon)):

1. Spawn `claude` interactively under `Bun.Terminal` (real PTY).
2. Tail the on-disk transcript JSONL at
   `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` as the sole
   event source.
3. Send user input as raw text + `\r` (no JSONL envelopes).
4. Replace the 8-probe preflight allowlist gate with a single TUI smoke
   test verifying `--disallowedTools` is honored by the binary + model.

OAuth-only invariant preserved (`ANTHROPIC_API_KEY` strip, pool rotation,
kanna-mcp loopback HTTP server, sandbox-exec/bwrap wrap, parity-matrix
fixtures all unchanged).

## Spike A findings (2026-05-21)

Validated on `claude` CLI v2.1.143:

- `--disallowedTools` enforced in TUI mode — no `tool_use` for disallowed
  built-ins in transcript when model is prompted to invoke them.
- `--append-system-prompt` reaches model context in TUI.
- `--mcp-config` + `--strict-mcp-config` wires up MCP servers in TUI.
- Transcript file created lazily on first user prompt (~0.3 s later).
- Claude encodes cwd via realpath + `/`/`.`→`-` (not just `/`→`-`).
- Trust dialog appears on first spawn per cwd; persists across spawns.
- `--bare` forces API-billing → unusable for OAuth-only kanna.

## Consequences

**Positive:**
- Aligns with upstream's primary tested codepath.
- Unlocks `/plan`, `/model`, `/exit` slash commands as durable runtime APIs.
- Deletes ~700 LOC of preflight scaffolding.
- Opens the door (F1) to closing the plan-mode-exit gap by reading
  `permissionMode` from transcript.

**Negative:**
- Cold spawn → result latency rises ~5-9 s (TUI welcome + trust dismiss).
  Subagent fanout 3-4× slower. Mitigation deferred to F4 (warm pool) if
  measured pain.
- New surface: transcript file watching, partial-line buffering, trust
  dialog wording dependency. Mitigation: smoke test + env-var escape
  hatches.

## Alternatives considered

- **Adopt `@dexh/shannon` directly:** rejected — auth model incompatible
  (Shannon uses local login; kanna needs pool injection), no `--mcp-config`
  hook, no `--disallowedTools` hook, requires tmux dep, agent-SDK facade
  is WIP. Net more code to integrate than to copy the pattern.
- **Dual-path (keep both `--print` and TUI behind a flag):** rejected —
  long-term dual maintenance debt for a hard architectural change.
- **Drop preflight entirely without smoke test:** rejected — silent
  regression risk if Anthropic ships a bug ignoring `--disallowedTools`.

## References

- Spec: `docs/superpowers/specs/2026-05-21-pty-tui-shannon-design.md`
- Plan: `docs/superpowers/plans/2026-05-21-pty-tui-shannon.md`
- Reference architecture: https://github.com/dexhorthy/shannon
- Probe artifacts (local, not committed):
  `/tmp/probe-harness.sh`, `/tmp/probe-{1,2,3,4}-transcript.jsonl`
```

- [ ] **Step 3: Run lint**

Run: `cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon && bun run lint`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git add CLAUDE.md .c3/adr/adr-2026-05-21-pty-tui-shannon.md
git -c commit.gpgsign=false commit -m "docs: PTY TUI cutover — CLAUDE.md rewrite + ADR

Rewrites 'Claude Driver Flag' section to describe TUI transport,
transcript-file source, trust-dismiss, oneShot /exit, smoke-test,
slash-command-based setModel/setPermissionMode/interrupt. Removes
'Allowlist preflight (P3b)' subsection. Documents removed env vars
(KANNA_PTY_PREFLIGHT_MODEL).

ADR captures rationale + Spike A findings + alternatives considered.

C3 component map update (project-relative file moves under
src/server/claude-pty/) is handled by /c3 change in a follow-up
commit (run by the PR author manually)."
```

---

## Task 12: Final full-suite green + PR prep

- [ ] **Step 1: Full lint + tests**

Run:
```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
bun run lint
bun test
```

Expected: PASS on both. The `bun test` run scans the full repo, so this is the integration check.

If any unrelated test fails (per CLAUDE.md "Pre-existing Issues" rule), stop and report it before continuing — do not silently work around.

- [ ] **Step 2: Run /c3 change**

Per CLAUDE.md's MANDATORY workflow: this change touches component boundaries (`claude-pty/` module gained 4 new files + lost 5). Run:

```
/c3 change
```

Apply the suggestions to update `.c3/` docs. Commit any `.c3/*.yaml` updates with message: `docs(c3): sync claude-pty component map for TUI refactor`.

- [ ] **Step 3: Push branch and open PR**

```bash
cd /Users/cuongtran/Desktop/repo/kanna/.worktrees/pty-tui-shannon
git push -u origin feat/pty-tui-shannon
gh pr create --repo cuongtranba/kanna --base main --head feat/pty-tui-shannon \
  --title "feat(claude-pty)!: cutover KANNA_CLAUDE_DRIVER=pty to Shannon-style TUI" \
  --body "$(cat <<'EOF'
## Summary

Hard-cutover of `KANNA_CLAUDE_DRIVER=pty` from `--print` stream-json
transport to interactive TUI + transcript-file tail (Shannon-style).

- Spawn `claude` under `Bun.Terminal` (real PTY)
- Tail `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` as event source
- Send input as raw text + `\r` (no JSONL envelopes)
- Replace 8-probe preflight with single TUI smoke test
- Fix `encodeCwd` (realpath + `.`→`-`)
- Net ~−130 LOC in `claude-pty/`

OAuth-only invariant preserved (pool rotation, ANTHROPIC_API_KEY strip,
kanna-mcp wiring, parity matrix all unchanged).

**Spec:** `docs/superpowers/specs/2026-05-21-pty-tui-shannon-design.md`
**ADR:** `.c3/adr/adr-2026-05-21-pty-tui-shannon.md`
**Plan:** `docs/superpowers/plans/2026-05-21-pty-tui-shannon.md`

## BREAKING

- `KANNA_PTY_PREFLIGHT_MODEL` env var no longer consulted (preflight deleted)
- `setPermissionMode(false)` becomes warn-only (was identical in prior version)
- Subagent fanout latency rises ~5-9s per cold spawn (TUI boot + trust dismiss)

## Test plan

- [ ] `bun run lint` PASS
- [ ] `bun test` PASS (full suite)
- [ ] Parity matrix all 7 fixtures PASS via new tui-source path
- [ ] OAuth-only invariant tests PASS
- [ ] Smoke-test gate refuses spawn when probe returns FAIL
- [ ] Manual smoke: KANNA_CLAUDE_DRIVER=pty kanna --dev — first prompt yields response
- [ ] Manual smoke: chat in same project a second time skips trust dialog
- [ ] Manual smoke: subagent invocation (`@agent/...`) closes REPL after one result
EOF
)"
```

- [ ] **Step 4: Verify PR target**

Check that the PR base is `cuongtranba/kanna:main`, NOT `jakemor/kanna:main`. Per CLAUDE.md project rule.

---

## Done criteria

- [ ] All commits in this plan landed on `feat/pty-tui-shannon`
- [ ] `bun run lint` + `bun test` green
- [ ] PR open against `cuongtranba/kanna:main`
- [ ] CLAUDE.md "Claude Driver Flag" section reflects new architecture
- [ ] ADR committed
- [ ] No `--print` / `--output-format` / `--input-format` references remain in `src/server/claude-pty/`
- [ ] Preflight subdir contains only `binary-fingerprint.ts` + test
- [ ] `bun test src/server/claude-pty/parity-matrix.test.ts` PASS (all 7 fixtures)
- [ ] Manual smoke: cold spawn produces a result event in chat UI
- [ ] Manual smoke: subagent run closes REPL after one result

## Out of scope (do NOT add to this PR)

- F1 plan-mode exit gap closure (Shift+Tab cycle + transcript introspection)
- F2 live `/help` parser
- F3 multi-line prompt input
- F4 warm-pool subagent spawn-ahead
- F5 trust-file preseed
- F6 `--bare` ephemeral runs
- F7 audit of stored encoded-cwd paths under old format
- Sandbox module cleanup (already dead; separate housekeeping PR)
