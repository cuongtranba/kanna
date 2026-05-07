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

  private emit(event: RegistryEvent, task: BackgroundTask): void {
    for (const cb of this.listeners[event]) cb(task)
  }
}
