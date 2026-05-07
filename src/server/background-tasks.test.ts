import { describe, expect, it } from "bun:test"
import { spawn } from "bun"
import { BackgroundTaskRegistry, type BackgroundTask } from "./background-tasks"

const drainingSample = (
  overrides: Partial<Extract<BackgroundTask, { kind: "draining_stream" }>> = {},
): Extract<BackgroundTask, { kind: "draining_stream" }> => ({
  kind: "draining_stream",
  id: "ds-1",
  chatId: "chat-1",
  startedAt: 1_700_000_000_000,
  lastOutput: "",
  ...overrides,
})

describe("BackgroundTaskRegistry", () => {
  it("registers and lists a task", () => {
    const r = new BackgroundTaskRegistry()
    r.register(drainingSample())
    expect(r.list()).toHaveLength(1)
    expect(r.list()[0].id).toBe("ds-1")
  })

  it("filters by chatId", () => {
    const r = new BackgroundTaskRegistry()
    r.register(drainingSample())
    r.register(drainingSample({ id: "ds-2", chatId: "chat-2" }))
    expect(r.listByChat("chat-1").map((t) => t.id)).toEqual(["ds-1"])
  })

  it("unregisters a task", () => {
    const r = new BackgroundTaskRegistry()
    r.register(drainingSample())
    r.unregister("ds-1")
    expect(r.list()).toHaveLength(0)
  })

  it("emits added/updated/removed events in order", () => {
    const r = new BackgroundTaskRegistry()
    const events: string[] = []
    r.on("added", () => events.push("added"))
    r.on("updated", () => events.push("updated"))
    r.on("removed", () => events.push("removed"))
    r.register(drainingSample())
    r.update("ds-1", { lastOutput: "hi" })
    r.unregister("ds-1")
    expect(events).toEqual(["added", "updated", "removed"])
  })

  it("update() throws when patch.kind mismatches the stored task kind", () => {
    const r = new BackgroundTaskRegistry()
    r.register(drainingSample())
    expect(() =>
      r.update("ds-1", { kind: "bash_shell" } as Partial<BackgroundTask>),
    ).toThrow("BackgroundTaskRegistry.update: kind mismatch (draining_stream -> bash_shell)")
  })

  it("listByChat excludes terminal_pty tasks (no chatId field)", () => {
    const r = new BackgroundTaskRegistry()
    r.register(drainingSample({ id: "ds-1", chatId: "chat-1" }))
    r.register({
      kind: "terminal_pty",
      id: "pty-1",
      ptyId: "p1",
      cwd: "/tmp",
      startedAt: 1_700_000_000_000,
      lastOutput: "",
    })
    const ids = r.listByChat("chat-1").map((t) => t.id)
    expect(ids).toEqual(["ds-1"])
  })
})

describe("BackgroundTaskRegistry.stop", () => {
  it("sends SIGTERM, then SIGKILL after grace, on a real process", async () => {
    // Spawn a Bun script that ignores SIGTERM and stays alive.
    const child = spawn({
      cmd: ["bun", "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      stdin: "ignore",
    })
    // Wait for the child process to finish initializing its signal handlers
    // before calling stop(), otherwise the SIGTERM arrives before registration.
    await Bun.sleep(300)
    const r = new BackgroundTaskRegistry()
    r.register({
      kind: "bash_shell",
      id: "sh-1",
      chatId: null,
      command: "bun",
      shellId: "shell-1",
      pid: child.pid!,
      startedAt: Date.now(),
      lastOutput: "",
      status: "running",
    })
    const result = await r.stop("sh-1", { graceMs: 200 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.method).toBe("sigkill")
    }
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
      command: "bun",
      shellId: "shell-2",
      pid: child.pid!,
      startedAt: Date.now(),
      lastOutput: "",
      status: "running",
    })
    const result = await r.stop("sh-2", { force: true })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.method).toBe("sigkill")
    }
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
    if (!result.ok) {
      expect(result.error).toContain("PID mismatch")
    }
    expect(r.list()).toHaveLength(0) // dropped from registry
  })

  it("word-boundary guard: 'bunbar' does not match a 'bun' process", async () => {
    // Spawn a real bun process so we have a live PID that ps shows as "bun ..."
    const child = spawn({
      cmd: ["bun", "-e", "setInterval(() => {}, 1000);"],
      stdin: "ignore",
    })
    await Bun.sleep(200)
    const r = new BackgroundTaskRegistry()
    r.register({
      kind: "bash_shell",
      id: "sh-wb",
      chatId: null,
      // "bunbar" starts with "bun" — the old substring match would wrongly accept it
      command: "bunbar",
      shellId: "shell-wb",
      pid: child.pid!,
      startedAt: Date.now(),
      lastOutput: "",
      status: "running",
    })
    const result = await r.stop("sh-wb")
    // verifyComm should reject because no word boundary match for "bunbar"
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("PID mismatch")
    }
    // Clean up the orphaned child
    try {
      process.kill(child.pid!, "SIGKILL")
    } catch {
      // already dead
    }
    await child.exited
  }, 5000)

  it("killShell strategy hook: invoked instead of POSIX signals", async () => {
    const child = spawn({
      cmd: ["bun", "-e", "setInterval(() => {}, 1000);"],
      stdin: "ignore",
    })
    await Bun.sleep(200)
    const r = new BackgroundTaskRegistry()
    r.register({
      kind: "bash_shell",
      id: "sh-ks",
      chatId: null,
      command: "bun",
      shellId: "shell-ks",
      pid: child.pid!,
      startedAt: Date.now(),
      lastOutput: "",
      status: "running",
    })

    let strategyCalled = 0
    r.setStrategies({
      killShell: async (task) => {
        strategyCalled++
        // Actually kill so the test doesn't leave a zombie
        try {
          process.kill(task.pid!, "SIGKILL")
        } catch {
          // already gone
        }
      },
    })

    const result = await r.stop("sh-ks")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.method).toBe("sigterm")
    }
    expect(strategyCalled).toBe(1)
    expect(r.list()).toHaveLength(0)
    await child.exited
  }, 5000)
})
