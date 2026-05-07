import { describe, expect, it } from "bun:test"
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
