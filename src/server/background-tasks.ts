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

export type StopResult =
  | { ok: true; method: "sigterm" | "sigkill" | "close" | "shutdown" }
  | { ok: false; error: string }

export type StopOptions = { force?: boolean; graceMs?: number }

export type StopStrategies = {
  killShell?: (task: Extract<BackgroundTask, { kind: "bash_shell" }>) => Promise<void>
  closeStream?: (task: Extract<BackgroundTask, { kind: "draining_stream" }>) => Promise<void>
  killPty?: (task: Extract<BackgroundTask, { kind: "terminal_pty" }>) => Promise<void>
  shutdownCodex?: (task: Extract<BackgroundTask, { kind: "codex_session" }>) => Promise<void>
}

async function safeKill(pid: number, signal: "SIGTERM" | "SIGKILL"): Promise<void> {
  // Try the process group first so child processes (e.g. spawned by a shell) are
  // also signalled. Fall back to single-pid kill if the group signal fails.
  // Note: ESRCH from -pid means "no such process group" (the pid is not a
  // group leader), so we always fall through to the single-pid kill in that case.
  let groupKilled = false
  try {
    process.kill(-pid, signal)
    groupKilled = true
  } catch {
    // Any error (ESRCH = no group, EPERM, EINVAL) means group kill failed;
    // fall through to single-pid kill below.
  }
  if (groupKilled) return
  try {
    process.kill(pid, signal)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ESRCH") return
    throw err
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "ESRCH") return true
      // EPERM and other codes mean the process still exists; keep polling.
    }
    await Bun.sleep(50)
  }
  return false
}

async function verifyComm(pid: number, expectedCommand: string): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: ["ps", "-p", String(pid), "-o", "command="],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    })
    const out = (await new Response(proc.stdout).text()).trim()
    await proc.exited
    if (!out) return false
    const cmdToken = expectedCommand.split(/\s+/)[0] ?? ""
    if (!cmdToken) return true
    const escaped = cmdToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(?:^|[/\\s])${escaped}(?:\\s|$)`).test(out)
  } catch {
    return false
  }
}

export class BackgroundTaskRegistry {
  private tasks = new Map<string, BackgroundTask>()
  private listeners: Record<RegistryEvent, Set<Listener>> = {
    added: new Set(),
    updated: new Set(),
    removed: new Set(),
  }
  private strategies: StopStrategies = {}

  setStrategies(strategies: StopStrategies): void {
    this.strategies = { ...this.strategies, ...strategies }
  }

  list(): BackgroundTask[] {
    return Array.from(this.tasks.values())
  }

  /**
   * Returns tasks whose chatId matches the given value.
   * terminal_pty tasks are intentionally excluded because they have no chatId field.
   */
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
    if (patch.kind !== undefined && patch.kind !== prev.kind) {
      throw new Error(`BackgroundTaskRegistry.update: kind mismatch (${prev.kind} -> ${patch.kind})`)
    }
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
      this.update(id, { status: "stopping" })
      await safeKill(task.pid, "SIGKILL")
      this.unregister(id)
      return { ok: true, method: "sigkill" }
    }

    // If the SDK provides a custom kill strategy, delegate to it.
    if (this.strategies.killShell) {
      this.update(id, { status: "stopping" })
      await this.strategies.killShell(task)
      this.unregister(id)
      return { ok: true, method: "sigterm" }
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

  private emit(event: RegistryEvent, task: BackgroundTask): void {
    for (const cb of this.listeners[event]) cb(task)
  }
}
