# Drop xterm-headless from claude-pty (P3a.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove `@xterm/headless` + `frame-parser.ts` from the claude-pty driver. JSONL is the single source of truth for events (model switches, rate limits, permission-mode changes); xterm parsing was redundant complexity.

**Architecture:** `pty-process.ts` simplifies to a raw subprocess holder: `Bun.Terminal` (still required for TTY billing) but no headless xterm instance and no SerializeAddon. Subprocess stdout/stderr are consumed but discarded (drained to avoid backpressure). `driver.ts` drops the `onOutput` slash-cmd ACK + rate-limit detection — those signals now come from the JSONL reader. `setModel` resolves on next assistant message with matching `message.model` in JSONL.

**Tech Stack:** Bun + TypeScript strict. No new deps. `terminal-manager.ts` (separate from claude-pty) still uses xterm-headless — untouched.

---

## File Structure

**Deleted:**

```
src/server/claude-pty/frame-parser.ts
src/server/claude-pty/frame-parser.test.ts
```

**Modified:**

```
src/server/claude-pty/pty-process.ts        # drop headless xterm + serializer
src/server/claude-pty/pty-process.test.ts   # update test for new shape
src/server/claude-pty/driver.ts             # JSONL-driven setModel + rate-limit
src/server/claude-pty/driver.test.ts        # adapt
src/server/claude-pty/jsonl-to-event.ts     # emit rate_limit from system events
src/server/claude-pty/jsonl-to-event.test.ts
CLAUDE.md                                   # update PTY section
```

---

## Task 1: Simplify `pty-process.ts` — drop headless xterm

**Files:**
- Modify: `src/server/claude-pty/pty-process.ts`
- Modify: `src/server/claude-pty/pty-process.test.ts`

The current shape exposes `headless: Terminal` and `serializer: SerializeAddon`. After this task `PtyProcess` only exposes `sendInput`, `resize`, `exited`, `close`, and the optional `onOutput` callback. The `Bun.Terminal` data handler still calls `onOutput` (so callers can observe raw output if they want), but the headless instance is gone.

- [ ] **Step 1: Update test expectations**

Replace `src/server/claude-pty/pty-process.test.ts` body:

```ts
import { describe, expect, test } from "bun:test"
import { spawnPtyProcess } from "./pty-process"

describe("spawnPtyProcess", () => {
  test("spawns a child process and exits cleanly", async () => {
    if (process.platform === "win32") return
    if (typeof Bun.Terminal !== "function") return
    const handle = await spawnPtyProcess({
      command: "/bin/sh",
      args: ["-c", "echo hello"],
      cwd: "/tmp",
      env: process.env,
    })
    const exitCode = await handle.exited
    expect(exitCode).toBe(0)
    handle.close()
  })

  test("captures output via onOutput callback", async () => {
    if (process.platform === "win32" || typeof Bun.Terminal !== "function") return
    const chunks: string[] = []
    const handle = await spawnPtyProcess({
      command: "/bin/sh",
      args: ["-c", "echo hi"],
      cwd: "/tmp",
      env: process.env,
      onOutput: (chunk) => chunks.push(chunk),
    })
    await handle.exited
    handle.close()
    expect(chunks.join("")).toContain("hi")
  })
})
```

(No `headless`/`serializer` assertions.)

- [ ] **Step 2: Rewrite `src/server/claude-pty/pty-process.ts`**

```ts
export interface PtyProcess {
  sendInput(data: string): Promise<void>
  resize(cols: number, rows: number): void
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

  const terminal = new Bun.Terminal({
    cols,
    rows,
    name: "xterm-256color",
    data: (_t, data) => {
      if (opts.onOutput) {
        const chunk = Buffer.from(data).toString("utf8")
        opts.onOutput(chunk)
      }
      // If no callback, the data is silently drained — required to avoid pipe backpressure.
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
    },
    exited: proc.exited,
    close() {
      try { terminal.close() } catch { /* swallow */ }
      try { proc.kill() } catch { /* swallow */ }
    },
  }
}
```

Remove `@xterm/headless` + `@xterm/addon-serialize` imports.

- [ ] **Step 3: Run tests**

`bun test src/server/claude-pty/pty-process.test.ts` → both PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/claude-pty/pty-process.ts src/server/claude-pty/pty-process.test.ts
git commit -m "refactor(claude-pty): drop xterm-headless from PtyProcess (JSONL is single event source)"
```

---

## Task 2: Extend `jsonl-to-event.ts` for rate-limit events

**Files:**
- Modify: `src/server/claude-pty/jsonl-to-event.ts`
- Modify: `src/server/claude-pty/jsonl-to-event.test.ts`

Claude Code emits `{type:"system", subtype:"...", ...}` entries for various lifecycle events. For rate-limit, the exact shape isn't documented stably — at minimum we should look for `subtype` matches like `"rate_limit"`, `"usage_limit"`, or `"informational"` with a content string containing "rate limit". Conservative path: only emit a `rate_limit` HarnessEvent when we see an explicit `"rate_limit"` subtype. Other matches stay as transcript-only.

- [ ] **Step 1: Append failing tests**

```ts
test("system.rate_limit subtype → rate_limit event", () => {
  const line = JSON.stringify({
    type: "system",
    subtype: "rate_limit",
    resetAt: 1748800000000,
    tz: "PT",
  })
  const events = parseJsonlLine(line)
  const rl = events.find((e) => e.type === "rate_limit")
  expect(rl).toBeDefined()
  expect(rl?.rateLimit?.tz).toBe("PT")
})

test("system.informational without rate-limit content → no rate_limit event", () => {
  const line = JSON.stringify({
    type: "system",
    subtype: "informational",
    content: "Remote Control failed to connect",
  })
  const events = parseJsonlLine(line)
  const rl = events.find((e) => e.type === "rate_limit")
  expect(rl).toBeUndefined()
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Extend `parseJsonlLine` in `jsonl-to-event.ts`**

After the existing `system.init` handling, add:

```ts
if (message.type === "system" && message.subtype === "rate_limit") {
  const resetAt = typeof message.resetAt === "number" ? message.resetAt : Date.now()
  const tz = typeof message.tz === "string" ? message.tz : "UTC"
  events.push({ type: "rate_limit", rateLimit: { resetAt, tz } })
}
```

(If Claude Code uses a different field name for rate-limit, this will need adaptation — but the structure is correct. The conservative subtype match means we don't false-positive on `informational`.)

- [ ] **Step 4: Run tests** → 2 new + 4 existing PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/jsonl-to-event.ts src/server/claude-pty/jsonl-to-event.test.ts
git commit -m "feat(claude-pty/jsonl): emit rate_limit event from system.rate_limit subtype"
```

---

## Task 3: Rewrite `driver.ts` — drop frame-parser; setModel via JSONL

**Files:**
- Modify: `src/server/claude-pty/driver.ts`
- Modify: `src/server/claude-pty/driver.test.ts`

Current `driver.ts` uses `detectModelSwitch(frame)` / `detectRateLimit(frame)` inside `onOutput`, and `setModel` waits on a `pendingModelAck` promise resolved from there. After this task:
- Drop `frame-parser` imports.
- Drop `onOutput` callback entirely (no PTY-side output processing needed).
- `setModel(model)` writes the slash command, then awaits the next assistant message in the JSONL stream whose `entry.message.model === model` (or 3 s timeout).
- Rate-limit events flow through naturally from JSONL via Task 2.

- [ ] **Step 1: Update imports + drop onOutput**

In `src/server/claude-pty/driver.ts`:

1. Remove import: `import { detectModelSwitch, detectRateLimit } from "./frame-parser"`.
2. Remove `pendingModelAck` state.
3. Pass `spawnPtyProcess({ ..., })` WITHOUT `onOutput` callback (or pass `onOutput: () => {}` to keep the parameter; cleaner is to omit since pty-process accepts it as optional).
4. Drop the `pty.serializer.serialize()` calls from the previous `onOutput` body — gone with the callback.

- [ ] **Step 2: Implement model-switch ACK via JSONL**

Inside `pushMerged`, after the existing `account_info` handling, watch for assistant messages carrying a model and resolve any pending switch promise:

```ts
let pendingModelSwitch: { model: string; resolve: () => void; timer: ReturnType<typeof setTimeout> } | null = null

function pushMerged(ev: HarnessEvent) {
  // ... existing account_info handling
  if (pendingModelSwitch && ev.type === "transcript" && ev.entry) {
    const entry = ev.entry as { kind?: string; message?: { model?: string } }
    if (entry.kind === "assistant" && typeof entry.message?.model === "string" && entry.message.model === pendingModelSwitch.model) {
      clearTimeout(pendingModelSwitch.timer)
      pendingModelSwitch.resolve()
      pendingModelSwitch = null
    }
  }
  // ... existing waiter/queue dispatch
}
```

Re-implement `setModel`:

```ts
setModel: async (model) => {
  await writeSlashCommand(pty, "model", model)
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (pendingModelSwitch && pendingModelSwitch.model === model) {
        pendingModelSwitch.resolve()
        pendingModelSwitch = null
      }
    }, 10_000)
    pendingTimers.add(timer)
    pendingModelSwitch = { model, resolve: () => { pendingTimers.delete(timer); resolve() }, timer }
  })
},
```

(Bump timeout from 3s → 10s because JSONL flush + first assistant turn can take longer than xterm-side echo.)

Note: the field name on `TranscriptEntry` for assistant role is project-specific. Check what `normalizeClaudeStreamMessage` produces — likely `entry.kind === "assistant"` with `entry.message.model`. Verify by reading `normalizeClaudeStreamMessage` once before implementing. If the actual shape differs, adapt.

Also: in `close()`, ensure `pendingModelSwitch` is cleared (if non-null, resolve it to unblock any pending awaiter):

```ts
close: () => {
  if (closed) return
  closed = true
  if (pendingModelSwitch) {
    clearTimeout(pendingModelSwitch.timer)
    pendingModelSwitch.resolve()
    pendingModelSwitch = null
  }
  // ... existing close path
},
```

- [ ] **Step 3: Update `driver.test.ts`**

If any test references `pty.serializer` or `pty.headless`, update or delete. The two existing auth-precheck tests don't reach the spawn path so they should still pass unchanged.

- [ ] **Step 4: Verify**

```bash
bun test src/server/claude-pty/         # all PASS
bun test src/server                     # no regressions
bun x tsc --noEmit                      # clean
bun run lint                            # clean
bun run check                           # full gate
```

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/driver.ts src/server/claude-pty/driver.test.ts
git commit -m "refactor(claude-pty): setModel ACK + rate-limit via JSONL (drop frame-parser)"
```

---

## Task 4: Delete `frame-parser.ts` + tests

**Files:**
- Delete: `src/server/claude-pty/frame-parser.ts`
- Delete: `src/server/claude-pty/frame-parser.test.ts`

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -rn "frame-parser\|detectModelSwitch\|detectRateLimit\|stripAnsi" src/ docs/
```

If any production code outside `frame-parser.ts` itself still imports these, remove the references first.

- [ ] **Step 2: Delete the files**

```bash
rm src/server/claude-pty/frame-parser.ts src/server/claude-pty/frame-parser.test.ts
```

- [ ] **Step 3: Verify**

```bash
bun x tsc --noEmit && bun test src/server && bun run lint && bun run check
```

All pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(claude-pty): delete frame-parser.ts (replaced by JSONL events)"
```

---

## Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the PTY section**

Locate the existing `# Claude Driver Flag (KANNA_CLAUDE_DRIVER)` block. Append a note:

```md
**Architecture note:** PTY mode uses the on-disk JSONL transcript at
`~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` as the sole event
source. The PTY is a subprocess holder + input channel only; output is
drained, not parsed. Model switches, rate-limit signals, and permission
changes all surface through JSONL.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: claude-pty uses JSONL as sole event source"
```

---

## Self-review

**1. Spec coverage:** P2's "minimal frame parser for slash-cmd ACKs" requirement is the only piece this plan removes. Replaced with JSONL-driven `setModel` ACK + native rate-limit emission. Permission-mode changes already flow as `type:"permission-mode"` transcript entries.

**2. Placeholder scan:** No TBD/TODO.

**3. Type consistency:** `PtyProcess` interface narrows (removes `headless`, `serializer`). No external callers of those fields exist outside `driver.ts` (verified by `grep` before deletion).

**4. Risk:** Model-switch ACK now takes up to 10 s (real-world JSONL flush + first turn after `/model`). Previously 3 s via xterm. UX impact: `setModel` slash-command in Kanna UI may show a longer "switching..." indicator. Acceptable for v1.

---
