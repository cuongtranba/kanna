# Background Tasks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the user a unified, calm surface to see and stop every long-lived task Kanna owns (Claude SDK background bash shells, draining streams, terminal PTYs, codex sessions), with graceful stop semantics, persistence across Kanna restarts, and a navbar indicator + dialog UI that follows the Editorial Workspace design system.

**Architecture:** A new `BackgroundTaskRegistry` on the server is the single source of truth for four task kinds. It is owned by `AgentCoordinator` and injected into `TerminalManager` and `CodexAppServerManager`. State diffs are broadcast over a new WebSocket channel `bg-tasks:list`; the client mirrors them in a Zustand store and renders a navbar indicator plus a `Dialog` (sheet on mobile). Stop is graceful (SIGTERM → 3s grace → SIGKILL) with a PID-reuse guard and per-kind strategies. Bash shells survive Kanna restarts via an atomic-write JSON file keyed by listening port; the boot path probes for liveness and surfaces survivors as orphans. All UI complies with `DESIGN.md`: warm-tinted neutrals, restrained color, editorial typography, flat-by-default elevation, color-plus-shape signaling, tabular numerics, project Tooltip not native title, AAA-where-feasible accessibility.

**Tech Stack:** Bun + TypeScript on the server (`src/server/*`), React + Zustand on the client (`src/client/*`), shadcn dialog, Tailwind v4 with OKLCH tokens, `bun test` for unit + integration. Existing `WsRouter` for WebSocket protocol.

**Reference docs in this branch:**
- `docs/plans/2026-05-07-background-tasks-design.md` — design source of truth
- `PRODUCT.md` — strategic register, voice, anti-references
- `DESIGN.md` — visual tokens and component vocabulary

---

## Task 0: Fix six pre-existing baseline test failures

The branch was created from `main@bd13004` where the following six tests fail. Per `CLAUDE.md` "bun test MUST pass before push or PR" they must be green before the PR. Each must be investigated; if a test is environment-dependent (e.g. needs a live Claude provider), the fix is to skip or mock at the test level, not in the implementation. If a test is a real regression on main, fix the underlying code in this branch and call it out in the commit body.

**Failing tests:**
- `password auth > serves the app shell to unauthenticated browser requests`
- `runCli > starts normally when no newer version exists`
- `runCli > returns restarting when a newer version is available`
- `runCli > falls back to current version when install fails`
- `runCli > falls back to current version when the registry check fails`
- `uploads > rejects oversized uploads before reading them into memory`

**Step 1: Run each test in isolation to capture full failure output**

For each failing test, run:

```bash
bun test src/server/<file>.test.ts -t "<test name>" 2>&1 | tee /tmp/bg-tasks-baseline-<n>.log
```

Read the failure carefully. Categorize as: (a) needs network/provider, (b) flaky timing, (c) real regression on main.

**Step 2: Fix per category**

- **(a) needs network/provider:** wrap in `it.skipIf` with an env-var gate, or replace the live call with the existing `quick-response` mock pattern used in the project. Document the skip reason inline.
- **(b) flaky timing:** raise the timeout, replace `setTimeout` with `Bun.sleep`, or convert to fake timers if the codebase uses them. No `await sleep(N)` retries.
- **(c) real regression:** read the surrounding code via LSP `goToDefinition` / `findReferences`, write a focused fix, run the single test green, run the whole file green.

**Step 3: Run only the changed tests**

```bash
bun test src/server/<file>.test.ts
```

Expected: PASS.

**Step 4: Commit each fix as a separate commit with `fix(test):` prefix**

```bash
git add src/server/<file>.test.ts src/server/<file>.ts
git commit -F- <<'MSG'
fix(test): <one-line summary>

<one-paragraph why; mention this was failing on main@bd13004 and unblocks the bg-tasks PR>
MSG
```

**Step 5: After all six are green, run the full suite once**

```bash
bun test
```

Expected: 0 fail. Proceed only when clean.

---

## Task 1: BackgroundTaskRegistry — types and skeleton

**Files:**
- Create: `src/server/background-tasks.ts`
- Test: `src/server/background-tasks.test.ts`

**Step 1: Write the failing test (skeleton + register/list)**

```ts
// src/server/background-tasks.test.ts
import { describe, expect, it } from "bun:test"
import { BackgroundTaskRegistry, type BackgroundTask } from "./background-tasks"

const sample = (): BackgroundTask => ({
  kind: "draining_stream",
  id: "ds-1",
  chatId: "chat-1",
  startedAt: 1_700_000_000_000,
  lastOutput: "",
})

describe("BackgroundTaskRegistry", () => {
  it("registers and lists a task", () => {
    const r = new BackgroundTaskRegistry()
    r.register(sample())
    expect(r.list()).toHaveLength(1)
    expect(r.list()[0].id).toBe("ds-1")
  })

  it("filters by chatId", () => {
    const r = new BackgroundTaskRegistry()
    r.register(sample())
    r.register({ ...sample(), id: "ds-2", chatId: "chat-2" })
    expect(r.listByChat("chat-1").map((t) => t.id)).toEqual(["ds-1"])
  })

  it("unregisters a task", () => {
    const r = new BackgroundTaskRegistry()
    r.register(sample())
    r.unregister("ds-1")
    expect(r.list()).toHaveLength(0)
  })

  it("emits added/updated/removed events in order", () => {
    const r = new BackgroundTaskRegistry()
    const events: string[] = []
    r.on("added", () => events.push("added"))
    r.on("updated", () => events.push("updated"))
    r.on("removed", () => events.push("removed"))
    r.register(sample())
    r.update("ds-1", { lastOutput: "hi" })
    r.unregister("ds-1")
    expect(events).toEqual(["added", "updated", "removed"])
  })
})
```

**Step 2: Run test, verify it fails**

```bash
bun test src/server/background-tasks.test.ts
```

Expected: FAIL with "Cannot find module './background-tasks'".

**Step 3: Implement the minimal registry**

```ts
// src/server/background-tasks.ts
export type BackgroundTask =
  | {
      kind: "bash_shell"
      id: string
      chatId: string | null
      command: string
      shellId: string
      pid: number | null
      startedAt: number
      lastOutput: string
      status: "running" | "stopping"
      orphan?: boolean
    }
  | {
      kind: "draining_stream"
      id: string
      chatId: string
      startedAt: number
      lastOutput: string
    }
  | {
      kind: "terminal_pty"
      id: string
      ptyId: string
      cwd: string
      startedAt: number
      lastOutput: string
    }
  | {
      kind: "codex_session"
      id: string
      chatId: string
      pid: number | null
      startedAt: number
      lastOutput: string
    }

export type RegistryEvent = "added" | "updated" | "removed"
export type Listener = (task: BackgroundTask) => void
export type Unsubscribe = () => void

export class BackgroundTaskRegistry {
  private tasks = new Map<string, BackgroundTask>()
  private listeners: Record<RegistryEvent, Set<Listener>> = {
    added: new Set(),
    updated: new Set(),
    removed: new Set(),
  }

  list(): BackgroundTask[] {
    return Array.from(this.tasks.values())
  }

  listByChat(chatId: string): BackgroundTask[] {
    return this.list().filter((t) => "chatId" in t && t.chatId === chatId)
  }

  register(task: BackgroundTask): void {
    this.tasks.set(task.id, task)
    this.emit("added", task)
  }

  update(id: string, patch: Partial<BackgroundTask>): void {
    const prev = this.tasks.get(id)
    if (!prev) return
    const next = { ...prev, ...patch } as BackgroundTask
    this.tasks.set(id, next)
    this.emit("updated", next)
  }

  unregister(id: string): void {
    const prev = this.tasks.get(id)
    if (!prev) return
    this.tasks.delete(id)
    this.emit("removed", prev)
  }

  on(event: RegistryEvent, cb: Listener): Unsubscribe {
    this.listeners[event].add(cb)
    return () => this.listeners[event].delete(cb)
  }

  private emit(event: RegistryEvent, task: BackgroundTask): void {
    for (const cb of this.listeners[event]) cb(task)
  }
}
```

**Step 4: Run test, verify pass**

```bash
bun test src/server/background-tasks.test.ts
```

Expected: 4 pass.

**Step 5: Commit**

```bash
git add src/server/background-tasks.ts src/server/background-tasks.test.ts
git commit -F- <<'MSG'
feat(bg-tasks): add BackgroundTaskRegistry skeleton with typed events

Types cover all four kinds (bash_shell, draining_stream, terminal_pty,
codex_session). Registry emits added/updated/removed; consumers
subscribe with on().
MSG
```

---

## Task 2: Stop semantics — graceful TERM/KILL with PID-reuse guard

**Files:**
- Modify: `src/server/background-tasks.ts`
- Test: `src/server/background-tasks.test.ts`
- Possibly create: `src/server/process-utils.ts` (extend existing)

**Step 1: Read existing process utilities via LSP**

Use LSP `documentSymbol` on `src/server/process-utils.ts` to learn what is available. Reuse before adding new helpers.

**Step 2: Write failing tests for stop()**

Add to `background-tasks.test.ts`:

```ts
import { spawn } from "bun"

describe("BackgroundTaskRegistry.stop", () => {
  it("sends SIGTERM, then SIGKILL after grace, on a real process", async () => {
    // Spawn a Bun script that ignores SIGTERM and stays alive.
    const child = spawn({
      cmd: ["bun", "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      stdin: "ignore",
    })
    const r = new BackgroundTaskRegistry()
    r.register({
      kind: "bash_shell",
      id: "sh-1",
      chatId: null,
      command: "test",
      shellId: "shell-1",
      pid: child.pid!,
      startedAt: Date.now(),
      lastOutput: "",
      status: "running",
    })
    const result = await r.stop("sh-1", { graceMs: 200 })
    expect(result.ok).toBe(true)
    expect(result.method).toBe("sigkill")
    await child.exited
  }, 5000)

  it("force: true uses SIGKILL immediately", async () => {
    const child = spawn({
      cmd: ["bun", "-e", "setInterval(() => {}, 1000);"],
      stdin: "ignore",
    })
    const r = new BackgroundTaskRegistry()
    r.register({
      kind: "bash_shell",
      id: "sh-2",
      chatId: null,
      command: "test",
      shellId: "shell-2",
      pid: child.pid!,
      startedAt: Date.now(),
      lastOutput: "",
      status: "running",
    })
    const result = await r.stop("sh-2", { force: true })
    expect(result.ok).toBe(true)
    expect(result.method).toBe("sigkill")
    await child.exited
  }, 5000)

  it("PID-reuse guard: returns ok:false when comm does not match", async () => {
    const r = new BackgroundTaskRegistry()
    r.register({
      kind: "bash_shell",
      id: "sh-3",
      chatId: null,
      command: "definitely-not-this-one",
      shellId: "shell-3",
      pid: 1, // init/launchd, never matches "definitely-not-this-one"
      startedAt: Date.now(),
      lastOutput: "",
      status: "running",
    })
    const result = await r.stop("sh-3")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("PID mismatch")
    expect(r.list()).toHaveLength(0) // dropped from registry
  })
})
```

**Step 3: Run tests, verify they fail**

```bash
bun test src/server/background-tasks.test.ts -t "stop"
```

Expected: FAIL with "stop is not a function".

**Step 4: Implement stop() with strategies**

Extend `BackgroundTaskRegistry`:

```ts
// add to src/server/background-tasks.ts

export type StopResult =
  | { ok: true; method: "sigterm" | "sigkill" | "close" | "shutdown" }
  | { ok: false; error: string }

export type StopOptions = { force?: boolean; graceMs?: number }

// Per-kind strategy hooks injected by AgentCoordinator
export type StopStrategies = {
  killShell?: (task: Extract<BackgroundTask, { kind: "bash_shell" }>) => Promise<void>
  closeStream?: (task: Extract<BackgroundTask, { kind: "draining_stream" }>) => Promise<void>
  killPty?: (task: Extract<BackgroundTask, { kind: "terminal_pty" }>) => Promise<void>
  shutdownCodex?: (task: Extract<BackgroundTask, { kind: "codex_session" }>) => Promise<void>
}

export class BackgroundTaskRegistry {
  // ...existing fields...
  private strategies: StopStrategies = {}

  setStrategies(strategies: StopStrategies): void {
    this.strategies = { ...this.strategies, ...strategies }
  }

  async stop(id: string, opts: StopOptions = {}): Promise<StopResult> {
    const task = this.tasks.get(id)
    if (!task) return { ok: false, error: "task not found" }

    if (task.kind === "draining_stream") {
      await this.strategies.closeStream?.(task)
      this.unregister(id)
      return { ok: true, method: "close" }
    }
    if (task.kind === "terminal_pty") {
      await this.strategies.killPty?.(task)
      this.unregister(id)
      return { ok: true, method: "close" }
    }
    if (task.kind === "codex_session") {
      await this.strategies.shutdownCodex?.(task)
      this.unregister(id)
      return { ok: true, method: "shutdown" }
    }

    // bash_shell: signal lifecycle with PID-reuse guard
    if (task.pid == null) return { ok: false, error: "no pid recorded" }

    const commOk = await verifyComm(task.pid, task.command)
    if (!commOk) {
      this.unregister(id)
      return { ok: false, error: "PID mismatch (process reused)" }
    }

    if (opts.force) {
      await safeKill(task.pid, "SIGKILL")
      this.unregister(id)
      return { ok: true, method: "sigkill" }
    }

    this.update(id, { status: "stopping" })
    await safeKill(task.pid, "SIGTERM")
    const grace = opts.graceMs ?? 3000
    const exited = await waitForExit(task.pid, grace)
    if (exited) {
      this.unregister(id)
      return { ok: true, method: "sigterm" }
    }
    await safeKill(task.pid, "SIGKILL")
    await waitForExit(task.pid, 1000)
    this.unregister(id)
    return { ok: true, method: "sigkill" }
  }
}

async function safeKill(pid: number, signal: "SIGTERM" | "SIGKILL"): Promise<void> {
  try {
    process.kill(pid, signal)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return
    throw err
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await Bun.sleep(50)
  }
  return false
}

async function verifyComm(pid: number, expectedCommand: string): Promise<boolean> {
  // Cross-platform: read /proc on Linux, fall back to ps elsewhere.
  try {
    const proc = Bun.spawn({
      cmd: ["ps", "-p", String(pid), "-o", "command="],
      stdin: "ignore",
      stdout: "pipe",
    })
    const out = (await new Response(proc.stdout).text()).trim()
    if (!out) return false
    const cmdToken = expectedCommand.split(/\s+/)[0] ?? ""
    if (!cmdToken) return true
    return out.includes(cmdToken)
  } catch {
    return false
  }
}
```

**Step 5: Run tests**

```bash
bun test src/server/background-tasks.test.ts -t "stop"
```

Expected: 3 pass.

**Step 6: Commit**

```bash
git add src/server/background-tasks.ts src/server/background-tasks.test.ts
git commit -F- <<'MSG'
feat(bg-tasks): graceful stop with TERM/KILL grace and PID-reuse guard

Per-kind strategies are injected via setStrategies(). bash_shell uses
SIGTERM with a 3s grace then SIGKILL; force:true skips grace. Before
killing, the registry verifies the live process command still matches
the recorded command, dropping the entry without killing on mismatch.
MSG
```

---

## Task 3: Wire `bash_shell` discovery in `agent.ts`

**Files:**
- Modify: `src/server/agent.ts` (around `trackBashToolEntry`, lines 793-814 today)
- Test: `src/server/agent.test.ts`

**Step 1: Read current `trackBashToolEntry` carefully**

Use LSP `goToDefinition` on `trackBashToolEntry` and read its full body plus the surrounding `tool_call` / `tool_result` shapes. Confirm what fields the SDK populates for `run_in_background: true` (especially how the shell id and pid are exposed in the tool result content).

If the SDK does not surface the shell id/pid in the result content, fall back to extracting from the result text via a tight regex (Claude Code typically prints `Background process started ... pid <N>`). Record both in the registry; pid is the only thing required for stopping.

**Step 2: Write failing test**

Add to `src/server/agent.test.ts`:

```ts
import { BackgroundTaskRegistry } from "./background-tasks"

it("registers a bash_shell task on tool_result when run_in_background is true", async () => {
  const registry = new BackgroundTaskRegistry()
  // ...existing test scaffolding to construct an AgentCoordinator with `registry` injected...
  const chatId = "chat-bg"
  // simulate tool_call with run_in_background: true
  // simulate tool_result with text containing pid 12345
  // (use existing helpers in agent.test.ts to push events)

  expect(registry.list()).toHaveLength(1)
  const task = registry.list()[0]
  expect(task.kind).toBe("bash_shell")
  if (task.kind === "bash_shell") {
    expect(task.pid).toBe(12345)
    expect(task.chatId).toBe(chatId)
    expect(task.command).toContain("bun run dev")
  }
})
```

(Read the existing `agent.test.ts` to find the matching helper pattern; do not invent new scaffolding if a `pushEvent`-style helper already exists.)

**Step 3: Run test, verify fail**

```bash
bun test src/server/agent.test.ts -t "run_in_background"
```

Expected: FAIL.

**Step 4: Implement**

Inject the registry into `AgentCoordinator` via constructor `args.backgroundTasks`. Extend `trackBashToolEntry`:

```ts
private trackBashToolEntry(chatId: string, entry: TranscriptEntry): void {
  if (entry.kind === "tool_call" && entry.tool.toolKind === "bash") {
    const command = entry.tool.input.command ?? ""
    const isBg = entry.tool.input.run_in_background === true
    this.pendingBashCalls.set(entry.tool.toolId, { command, chatId, isBg })
    if (this.tunnelGateway) {
      // existing behavior unchanged
    }
    return
  }

  if (entry.kind === "tool_result") {
    const pending = this.pendingBashCalls.get(entry.toolId)
    if (!pending) return
    this.pendingBashCalls.delete(entry.toolId)

    const stdout = stringifyToolResultContent(entry.content)

    if (pending.isBg && this.backgroundTasks) {
      const pid = parseBackgroundPid(stdout)
      const shellId = parseBackgroundShellId(stdout) ?? entry.toolId
      this.backgroundTasks.register({
        kind: "bash_shell",
        id: `bash:${entry.toolId}`,
        chatId,
        command: pending.command,
        shellId,
        pid,
        startedAt: Date.now(),
        lastOutput: stdout.slice(-1024),
        status: "running",
      })
    }

    if (this.tunnelGateway) {
      void this.tunnelGateway.handleBashResult({
        command: pending.command,
        stdout,
        chatId,
        sourcePid: null,
      })
    }
  }
}
```

Add helpers in the same file (kept private, not exported):

```ts
function parseBackgroundPid(output: string): number | null {
  const match = output.match(/\bpid[:\s]+(\d+)\b/i)
  return match ? Number(match[1]) : null
}

function parseBackgroundShellId(output: string): string | null {
  const match = output.match(/shell[_\s-]?id[:\s]+([\w-]+)/i)
  return match ? match[1] : null
}
```

**Step 5: Wire `BashOutput` updates** (a later tool result that streams output for an existing background shell): when the SDK fires a `BashOutput` tool_result, call `this.backgroundTasks?.update(id, { lastOutput })` with the last 12 lines of output. If the output indicates the shell has exited, call `unregister(id)`.

**Step 6: Run tests**

```bash
bun test src/server/agent.test.ts -t "run_in_background"
```

Expected: pass.

**Step 7: Commit**

```bash
git add src/server/agent.ts src/server/agent.test.ts
git commit -F- <<'MSG'
feat(bg-tasks): register bash_shell tasks on run_in_background results

trackBashToolEntry now records shell id and pid from tool_result text,
registers the entry with BackgroundTaskRegistry, and updates lastOutput
on subsequent BashOutput tool_results. Exit lines unregister the task.
MSG
```

---

## Task 4: Wire `draining_stream` tracking

**Files:**
- Modify: `src/server/agent.ts` (around `drainingStreams.set` and `stopDraining`, lines 728/828/1585)
- Test: `src/server/agent.test.ts`

**Step 1: Failing test**

Verify that when a turn reaches `kind: "result"`, the draining-stream entry registered in `drainingStreams` also lands in the registry, and that `stopDraining` removes it.

**Step 2: Implement**

In the `result` handler (around line 1585):

```ts
this.drainingStreams.set(active.chatId, { turn: active.turn })
this.backgroundTasks?.register({
  kind: "draining_stream",
  id: `drain:${active.chatId}`,
  chatId: active.chatId,
  startedAt: Date.now(),
  lastOutput: "",
})
```

In `stopDraining`:

```ts
async stopDraining(chatId: string) {
  const draining = this.drainingStreams.get(chatId)
  if (!draining) return
  draining.turn.close()
  this.drainingStreams.delete(chatId)
  this.backgroundTasks?.unregister(`drain:${chatId}`)
  this.emitStateChange(chatId)
}
```

Wire the registry's `closeStream` strategy to call `stopDraining` so the dialog's stop button works for draining streams too. Set strategies in `AgentCoordinator` constructor:

```ts
this.backgroundTasks?.setStrategies({
  closeStream: async (task) => { await this.stopDraining(task.chatId) },
})
```

**Step 3: Tests + commit**

Run `bun test src/server/agent.test.ts`, then commit with `feat(bg-tasks): track draining streams in registry`.

---

## Task 5: Wire `terminal_pty` and `codex_session` tracking

**Files:**
- Modify: `src/server/terminal-manager.ts`
- Modify: `src/server/codex-app-server.ts`
- Test: `src/server/terminal-manager.test.ts` if present, else add one
- Test: `src/server/codex-app-server.test.ts`

**Step 1: Inject registry into both managers via constructor**

For each manager, accept `backgroundTasks?: BackgroundTaskRegistry` in args. On spawn, call `register`; on exit, `unregister`. Wire strategies in `AgentCoordinator`:

```ts
this.backgroundTasks?.setStrategies({
  killPty: async (task) => { await terminalManager.kill(task.ptyId) },
  shutdownCodex: async (task) => { await codexManager.shutdown(task.chatId) },
})
```

**Step 2: Failing tests**

For `terminal-manager.test.ts`: spawn a PTY, assert registry entry exists; kill, assert unregistered. For codex: same pattern.

**Step 3: Implement, test, commit**

One commit per file: `feat(bg-tasks): track terminal PTYs in registry` and `feat(bg-tasks): track codex sessions in registry`.

---

## Task 6: Orphan persistence + boot recovery

**Files:**
- Create: `src/server/orphan-persistence.ts`
- Test: `src/server/orphan-persistence.test.ts`
- Modify: `src/server/cli.ts` (boot path)
- Modify: `src/server/background-tasks.ts` (debounced write hook)

**Step 1: Failing tests**

```ts
// src/server/orphan-persistence.test.ts
describe("orphan persistence", () => {
  it("write then read round-trips entries", async () => { /* ... */ })
  it("drops dead pids on read", async () => { /* ... */ })
  it("returns empty on corrupted JSON without throwing", async () => { /* ... */ })
  it("atomic write: kill mid-write, file still valid", async () => { /* ... */ })
})
```

**Step 2: Implement**

```ts
// src/server/orphan-persistence.ts
import path from "node:path"
import os from "node:os"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"

export type PersistedTask = {
  id: string
  pid: number
  command: string
  chatId: string | null
  startedAt: number
}

export type OrphanFile = { tasks: PersistedTask[]; writtenAt: number }

const stateDir = path.join(os.homedir(), ".kanna", "state")

function fileForPort(port: number): string {
  return path.join(stateDir, `orphan-pids-${port}.json`)
}

export async function writeOrphans(port: number, tasks: PersistedTask[]): Promise<void> {
  await mkdir(stateDir, { recursive: true })
  const target = fileForPort(port)
  const tmp = `${target}.${process.pid}.tmp`
  const payload: OrphanFile = { tasks, writtenAt: Date.now() }
  await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8")
  await rename(tmp, target)
}

export async function readOrphans(port: number): Promise<PersistedTask[]> {
  try {
    const raw = await readFile(fileForPort(port), "utf8")
    const parsed = JSON.parse(raw) as OrphanFile
    if (!Array.isArray(parsed.tasks)) return []
    return parsed.tasks
  } catch {
    return []
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
```

**Step 3: Wire from `BackgroundTaskRegistry`**

Add a debounced subscription in `AgentCoordinator` constructor:

```ts
let writeTimer: ReturnType<typeof setTimeout> | null = null
const persist = () => {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    const tasks = this.backgroundTasks
      .list()
      .filter((t): t is Extract<BackgroundTask, { kind: "bash_shell" }> =>
        t.kind === "bash_shell" && t.pid != null
      )
      .map((t) => ({ id: t.id, pid: t.pid!, command: t.command, chatId: t.chatId, startedAt: t.startedAt }))
    void writeOrphans(this.port, tasks)
  }, 500)
}
this.backgroundTasks.on("added", persist)
this.backgroundTasks.on("updated", persist)
this.backgroundTasks.on("removed", persist)
```

**Step 4: Boot recovery in `cli.ts`**

After registry construction, before WS attach:

```ts
const persisted = await readOrphans(port)
for (const t of persisted) {
  if (!isAlive(t.pid)) continue
  registry.register({
    kind: "bash_shell",
    id: t.id,
    chatId: t.chatId,
    command: t.command,
    shellId: t.id,
    pid: t.pid,
    startedAt: t.startedAt,
    lastOutput: "",
    status: "running",
    orphan: true,
  })
}
```

**Step 5: Tests, commit**

`feat(bg-tasks): persist bash_shell pids and recover orphans on boot`.

---

## Task 7: WebSocket protocol — channel + command

**Files:**
- Modify: `src/server/ws-router.ts`
- Test: `src/server/ws-router.test.ts`
- Modify: `src/shared/types.ts` (or matching shared types file) for WS message kinds

**Step 1: Failing tests**

- subscribe `bg-tasks:list` returns snapshot, then diffs on register/update/unregister.
- `bg-tasks:stop { id }` routes to registry, returns result.
- `bg-tasks:stop { id: "missing" }` returns error, no crash.

**Step 2: Implement**

Add subscription handler and command handler. Use existing `WsRouter` patterns; do not invent new abstractions. Shape:

```ts
// snapshot
{ kind: "bg-tasks:snapshot", tasks: BackgroundTask[] }
// diff
{ kind: "bg-tasks:diff", op: "added"|"updated"|"removed", task: BackgroundTask }
// command
{ kind: "bg-tasks:stop", id: string, force?: boolean }
// response
{ kind: "bg-tasks:stop:result", id: string, ok: boolean, error?: string }
```

**Step 3: Tests, commit**

`feat(bg-tasks): WebSocket channel and stop command for background tasks`.

---

## Task 8: Client store + status formatting

**Files:**
- Create: `src/client/stores/backgroundTasksStore.ts`
- Create: `src/client/stores/backgroundTasksStore.test.ts`
- Modify: `src/client/lib/formatters.ts` (add `formatAge`)
- Test: `src/client/lib/formatters.test.ts`

**Step 1: Failing tests for `formatAge`**

```ts
it("formats age under a minute as Ns", () => {
  expect(formatAge(0, 4_000)).toBe("4s")
})
it("formats minutes as Mm Ss", () => {
  expect(formatAge(0, 134_000)).toBe("2m 14s")
})
it("formats hours as Hh Mm", () => {
  expect(formatAge(0, 4 * 3600_000 + 12 * 60_000)).toBe("4h 12m")
})
```

**Step 2: Implement `formatAge` in formatters.ts**

Use tabular-nums-friendly output. Pure function: `(startedAt: number, now: number) => string`.

**Step 3: Failing tests for store**

```ts
it("applies snapshot then diffs", () => {
  const store = createBackgroundTasksStore()
  store.applySnapshot([{ kind: "draining_stream", id: "a", chatId: "c", startedAt: 0, lastOutput: "" }])
  expect(store.tasks).toHaveLength(1)
  store.applyDiff({ op: "added", task: { kind: "draining_stream", id: "b", chatId: "c", startedAt: 0, lastOutput: "" } })
  expect(store.tasks).toHaveLength(2)
  store.applyDiff({ op: "removed", task: store.tasks[0] })
  expect(store.tasks).toHaveLength(1)
})
```

**Step 4: Implement using Zustand (project pattern)**

Match the shape of existing stores like `chatPreferencesStore.ts`. Expose `runningCount` selector.

**Step 5: Tests, commit**

`feat(bg-tasks): client store and formatAge helper`.

---

## Task 9: Navbar indicator

**Files:**
- Modify: `src/client/components/chat-ui/ChatNavbar.tsx`
- Test: `src/client/components/chat-ui/ChatNavbar.test.ts` (create or extend)

**Step 1: Failing test**

```ts
it("renders amber dot and count when running tasks > 0", async () => { /* ... */ })
it("renders neutral dot when count is 0", async () => { /* ... */ })
it("uses project Tooltip, not native title", async () => { /* assert no title attribute */ })
```

**Step 2: Implement**

Add a small button with leading dot + count, rendered in the navbar's right-action group. Keyboard shortcut `⌘⇧B` opens the dialog (wire via existing `keybindings.ts`). Tooltip via project `Tooltip`.

Visual rules per `DESIGN.md`:
- Dot color: `oklch(76% 0.14 78)` (Editor Amber) when count > 0, else `var(--muted-foreground)`.
- **Static** dot, no `animate-pulse`, no glow.
- Count: mono with `tabular-nums`.
- Padding aligned with sibling navbar buttons.

**Step 3: Tests, commit**

`feat(bg-tasks): navbar indicator with running count and keyboard shortcut`.

---

## Task 10: BackgroundTasksDialog — surface + rows + accessibility

**Files:**
- Create: `src/client/components/chat-ui/BackgroundTasksDialog.tsx`
- Create: `src/client/components/chat-ui/BackgroundTasksDialog.test.tsx`
- Modify: `src/client/components/ui/dialog.tsx` only if existing variant is insufficient

**Step 1: Failing tests**

- Renders snapshot rows with command, age (mono, tabular-nums), type tag, chat link, started time, stop button.
- Empty state shows the editorial sentence.
- `Esc` closes; arrow keys navigate rows; `Enter` expands; `⌘.` triggers stop on focused row.
- Sets no native `title` attributes.

**Step 2: Implement to design spec**

Match `DESIGN.md` exactly:
- shadcn `Dialog` + `DialogContent` width ~720px desktop.
- Header: "Background tasks" — `headline` scale, weight 500, sentence case, no icon, with `<count> running` muted-tag right.
- Two-line rows. Line 1 = mono command (weight 600, 14px) + mono tabular-nums age right.
- Line 2 = type tag, chat link (project router), started clock — sans 12px muted, plus stop icon button right.
- Expand chevron reveals last 12 lines of `lastOutput` in mono 12px (max-h 240).
- Row hover: `bg-secondary` (Surface Secondary). No border-left stripe.
- Status indicator: `oklch(76% 0.14 78)` dot for running, static.

Animation:
- Row enter: `opacity 0→1, translateY 4px→0, 180ms cubic-bezier(0.22, 1, 0.36, 1)`. Disabled under `prefers-reduced-motion`.
- Dialog open: `scale 0.98→1, opacity 0→1, 160ms`. No backdrop blur.

**Step 3: Tests, commit**

`feat(bg-tasks): dialog with row anatomy, expand, and keyboard navigation`.

---

## Task 11: Inline confirm-stop + force-kill timeout

**Files:**
- Modify: `src/client/components/chat-ui/BackgroundTasksDialog.tsx`
- Test: `BackgroundTasksDialog.test.tsx`

**Step 1: Failing tests**

- Click stop → row enters `confirm` state with `Confirm stop?` + `Cancel` (no nested modal).
- Confirm → row shows `stopping…`, stop request dispatched.
- After 3s no exit → `Force kill` red button appears.
- `Esc` cancels confirm.

**Step 2: Implement**

Local row state machine: `idle → confirm → stopping → forceAvailable`. Other rows dim while confirm is open. Single-row scope; never affects other tasks. `Force kill` calls `bg-tasks:stop { force: true }`.

Visual: `Confirm stop?` text uses Coral (`var(--destructive)`); `Cancel` is ghost. Slide-in 180ms from right; respects reduced motion.

**Step 3: Tests, commit**

`feat(bg-tasks): inline confirm-stop with force-kill fallback`.

---

## Task 12: Mobile sheet variant + orphan section

**Files:**
- Modify: `BackgroundTasksDialog.tsx`
- Reference: `src/client/hooks/useIsStandalone.ts` and existing mobile-detection helpers

**Step 1: Failing tests**

- Mobile breakpoint: dialog renders as bottom sheet.
- Orphan tasks render in a section header at the top with `Kill all` action.
- Long-press on row shows full command (replaces tooltip on touch).

**Step 2: Implement**

Use existing breakpoint helper (`@media (max-width: 640px)` or matching hook). Sheet animation: translateY from 100% to 0, 220ms ease-out-quart, no backdrop blur. Rows stack tighter: line-1 cmd+age, line-2 type+chat, line-3 stop button full-width.

Orphan section header: `Found from previous session` — muted Body 12px, with `Kill all` text button right-aligned that confirms inline before dispatching N parallel stop commands.

**Step 3: Tests, commit**

`feat(bg-tasks): mobile sheet variant and orphan section`.

---

## Task 13: Telemetry + boot toast

**Files:**
- Modify: `src/server/analytics.ts` (event types)
- Modify: `src/server/agent.ts` (emit events on register/stop)
- Modify: `src/client/app/chatNotifications.ts` (boot toast)

**Step 1: Add events**

```ts
type BgTaskEvent =
  | { kind: "bg_task_registered"; taskKind: BackgroundTask["kind"] }
  | { kind: "bg_task_stopped"; taskKind: BackgroundTask["kind"]; ageMs: number; force: boolean }
  | { kind: "bg_task_orphan_kept"; count: number }
  | { kind: "bg_task_orphan_killed"; count: number }
```

No PII (no command content, no chatId). Respect existing analytics opt-out.

**Step 2: Boot toast**

When orphan recovery finds N > 0 survivors, post one toast: *"3 processes survived restart · review"* with click action that opens the dialog. Use existing chatNotifications API; do not introduce a new toaster.

**Step 3: Tests, commit**

`feat(bg-tasks): analytics events and orphan boot toast`.

---

## Task 14: Manual smoke + accessibility audit

**Step 1: Start dev server**

```bash
bun run dev
```

Open browser. Drive a chat that runs `bun run dev` with `run_in_background: true` (use the agent UI). Verify:

- Navbar dot turns amber and count = 1.
- Open dialog with `⌘⇧B`.
- Row appears with mono command, tabular age ticking, type tag, chat link.
- Click stop → confirm appears inline. Confirm → row shows `stopping…`. Process exits, row fades.
- `pgrep -f 'bun run dev'` returns empty.

Repeat with a process that traps SIGTERM to verify `Force kill` fallback after 3s.

**Step 2: Restart Kanna**

Start a long-running process, kill the Kanna server (Ctrl-C). Restart. Open the dialog. Confirm an orphan section appears with the surviving pid; boot toast was posted.

**Step 3: Mobile**

Resize to ≤ 640px (or use device emulation). Confirm sheet variant. Confirm swipe-left exposes stop, long-press shows full command.

**Step 4: Accessibility**

- Tab through navbar → dialog → rows → stop. Focus rings always visible.
- VoiceOver: row reads "Stop bun run dev, running 2 minutes 14 seconds".
- `prefers-reduced-motion`: enable in OS, confirm no row enter animation.
- Lighthouse a11y check on the dialog viewport: contrast AAA on body text where the design allows.

**Step 5: Document smoke results**

Append a short "Verification" section to `docs/plans/2026-05-07-background-tasks.md` listing what was tested. Commit:

`docs(bg-tasks): record manual smoke results`.

---

## Task 15: Final test run + PR

**Step 1: Full suite green**

```bash
bun test
```

Expected: 0 fail across all suites including the six baseline fixes from Task 0.

**Step 2: Build check**

```bash
bun run build
```

Expected: success.

**Step 3: Push branch and open PR**

```bash
git push -u origin feat/bg-tasks
gh pr create --repo cuongtranba/kanna --base main --head feat/bg-tasks --title "feat(bg-tasks): visibility and stop control for background tasks" --body-file - <<'PRBODY'
## Summary
- New BackgroundTaskRegistry tracks bash_shell, draining_stream, terminal_pty, codex_session as a single source of truth, with graceful TERM/KILL stop semantics and a PID-reuse guard
- Navbar indicator + dialog (sheet on mobile) listing every long-lived task with inline confirm-stop and force-kill fallback
- Bash shells survive Kanna restart via atomic-write JSON keyed by listening port; orphans are surfaced via a boot toast and dialog section
- Six pre-existing baseline test failures on main@bd13004 fixed in earlier commits on this branch

## Design

- `docs/plans/2026-05-07-background-tasks-design.md` — design source of truth
- `PRODUCT.md`, `DESIGN.md` seeded; UI follows the Editorial Workspace system

## Test plan
- [x] `bun test` passes (0 fail)
- [x] `bun run build` passes
- [x] Manual smoke: spawn bg dev server, stop via dialog, restart Kanna and recover orphan
- [x] Mobile sheet variant verified at ≤ 640px
- [x] VoiceOver reads rows correctly; focus rings visible; reduced-motion respected
PRBODY
```

**Step 4: Confirm CI green**

Watch the test workflow; do not merge until CI passes.

---

---

## Verification

**Date:** 2026-05-07

### Automated checks

| Check | Result |
|---|---|
| `bun test --timeout 30000` (full suite) | PASS — 1110 tests, 0 fail, 2384 expect() calls |
| `bunx tsc --noEmit -p tsconfig.json` | PASS — no output (zero errors) |
| `bun run build` | PASS — both client and export-viewer built successfully |
| Dev server smoke (`bun run dev` → `curl http://localhost:3210/`) | PASS — HTTP 200, valid HTML response |

#### Static a11y checks on `BackgroundTasks*.tsx`

| Check | Expected | Result |
|---|---|---|
| `title=` (native title attribute) | ZERO matches | PASS — none found |
| `outline: none` / `outline-none` without focus replacement | ZERO matches | PASS — none found |
| `animate-pulse` / `animate-spin` on status indicators | ZERO matches | PASS — none found |
| `aria-label` on icon-only buttons (stop, expand, force-kill) | Present | PASS — 18 aria-label attributes found across Dialog and Indicator |
| `tabular-nums` Tailwind class on age/count text | Present | PASS — 9 occurrences across Dialog (age spans) and Indicator (count span) |

#### WCAG contrast (OKLCH → sRGB, WCAG 2.1 formula)

| Pair | Ratio | Verdict |
|---|---|---|
| **Light** Espresso Ink `oklch(16% 0.01 13)` on Warm Paper `oklch(99.5% 0.003 13)` | 19.13:1 | AAA |
| **Light** Margin Gray `oklch(55% 0.013 13)` on Warm Paper | 4.81:1 | AA |
| **Dark** Pale Foreground `oklch(98% 0.003 13)` on Inkstone `oklch(20% 0.01 13)` | 17.11:1 | AAA |
| **Dark** Margin Gray dark `oklch(70% 0.012 13)` on Inkstone | 6.76:1 | AA |
| Design spec: Pale Foreground text on Kanna Coral filled button | 2.70:1 | **FAIL** *(theoretical; not used in actual impl)* |
| **Actual impl** Coral `oklch(71.2% 0.194 13.428)` text on Warm Paper (light destructive labels) | 2.81:1 | **CONCERN — below AA (4.5:1)** |
| **Actual impl** Coral text on Inkstone (dark destructive labels) | 6.35:1 | AA |

**Coral contrast concern (light theme):** The implementation renders `var(--destructive)` (Kanna Coral) as text/icon color in light theme at 2.81:1 — below the WCAG AA threshold of 4.5:1 for normal-sized text. This affects the "Stop task", "Confirm stop", "Cancel stop", and "Force kill" labels in `BackgroundTasksDialog.tsx`. In dark theme the same coral reads at 6.35:1 (AA). The design doc states "Body contrast ≥ 7:1; large text ≥ 4.5:1; never below AA" — the light-mode coral-on-white combination violates this.

Possible mitigations before merge:
1. Darken the coral token in light mode only (e.g. `oklch(52% 0.18 13)` reaches ~4.5:1 on white).
2. Use a border+icon shape with neutral text and coral border, keeping Coral decorative only.
3. Accept the gap and mark it as a known limitation in the PR, to be addressed when the full design token audit runs.

### Items deferred to manual testing

| Item | Why it cannot be automated |
|---|---|
| VoiceOver / TalkBack reading row labels and status | Requires a real screen-reader session with a human listener to confirm spoken output matches "Stop bun run dev, running 2 minutes 14 seconds" |
| `prefers-reduced-motion` disabling row enter animation | Requires a real browser with the OS media query toggled; jsdom test environment does not honour OS-level preferences |
| Live Lighthouse audit (contrast, performance, best practices) | Requires a running Chromium-based browser attached to a live dev server |
| Mobile sheet swipe-left to expose stop | Requires touch-event simulation in a real device or responsive browser emulator |
| Agent `run_in_background: true` shell spawned through actual Claude SDK → dialog row appears | Requires a live Claude API key and provider connection |
| Kanna restart → orphan section appears with surviving PID | Requires a multi-step manual session: spawn shell, kill Kanna, relaunch, observe UI |

### Notes for reviewer

- The `bun test` warnings from zustand persist middleware (`Unable to update item 'chat-input-drafts'`) are pre-existing in jsdom and do not indicate a bug.
- Build output chunk size warnings (`> 500 kB after minification`) are pre-existing and unrelated to this feature.
- The Coral contrast failure in light mode (2.81:1) is the only substantive new concern found. All other static checks passed.

---

## Notes for the executor

- This branch is checked out at `.worktrees/bg-tasks`. All commands run there; never `cd` to other worktrees.
- Per `CLAUDE.md`, always resolve symbols via LSP first (`goToDefinition`, `findReferences`, `documentSymbol`) before grepping. Strong typing only — no `any` or untyped maps; if a type doesn't exist, define it.
- Pre-existing issues encountered mid-task (failing test in untouched code) — stop, report, ask. Do not silently work around.
- Subagent safety: any subagent dispatched for parallel work must run only the targeted tests for the files it touched, never the full `bun test`.
- Subprocess hygiene: every `git` or process spawn in tests sets `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0` per the project rule.
- Skills to use along the way:
  - `superpowers:test-driven-development` — write the failing test first on every task
  - `superpowers:systematic-debugging` — when a task fails unexpectedly
  - `superpowers:verification-before-completion` — before marking any task done
  - `kanna-react-style` — every `.tsx` file under `src/client`
  - `superpowers:dispatching-parallel-agents` — when tasks 8+ and 9+ are independent
