import { test, expect } from "bun:test"
import { createTeamsRegistry } from "./teams-registry"

const started = { subtype: "task_started" as const, taskId: "t1", description: "Compute", name: "calc", model: "claude-haiku-4-5" }

test("lifecycle: started -> progress -> completed", () => {
  let t = 100
  const reg = createTeamsRegistry({ now: () => t })
  const seen: string[] = []
  reg.subscribe((chatId) => seen.push(chatId))
  reg.apply("c1", started)
  t = 150
  reg.apply("c1", { subtype: "task_progress", taskId: "t1", description: "running bash" })
  reg.apply("c1", { subtype: "task_updated", taskId: "t1", patch: { status: "completed", end_time: 200 } })
  expect(reg.snapshot("c1")).toMatchObject([{
    taskId: "t1", name: "calc", subagentType: undefined, description: "Compute",
    status: "completed", model: "claude-haiku-4-5", startedAt: 100, endedAt: 200, lastActivityAt: 150,
  }])
  expect(seen).toEqual(["c1", "c1", "c1"])
})

test("terminal without end_time falls back to now; notification after terminal is a silent no-op", () => {
  let t = 10
  const reg = createTeamsRegistry({ now: () => t })
  const seen: string[] = []
  reg.subscribe((chatId) => seen.push(chatId))
  reg.apply("c1", started)
  t = 30
  reg.apply("c1", { subtype: "task_updated", taskId: "t1", patch: { status: "failed" } })
  expect(reg.snapshot("c1")[0]).toMatchObject({ status: "failed", endedAt: 30 })
  const notifiesBefore = seen.length
  t = 99
  reg.apply("c1", { subtype: "task_notification", taskId: "t1", status: "failed" })
  expect(reg.snapshot("c1")[0]).toMatchObject({ status: "failed", endedAt: 30 })
  expect(seen.length).toBe(notifiesBefore)
})

test("unknown chat empty; unknown-task events ignored without notify; clear drops; unsubscribe works", () => {
  const reg = createTeamsRegistry({ now: () => 1 })
  const seen: string[] = []
  const unsub = reg.subscribe((c) => seen.push(c))
  expect(reg.snapshot("nope")).toEqual([])
  reg.apply("c1", { subtype: "task_updated", taskId: "ghost", patch: { status: "completed" } })
  reg.apply("c1", { subtype: "task_progress", taskId: "ghost" })
  expect(seen).toEqual([])
  reg.apply("c1", started)
  expect(seen).toEqual(["c1"])
  reg.clear("c1")
  expect(reg.snapshot("c1")).toEqual([])
  unsub()
  reg.apply("c1", started)
  expect(seen).toEqual(["c1"])
})
