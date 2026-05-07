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
