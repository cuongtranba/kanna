import { describe, expect, test } from "bun:test"
import { useTeamsStore, selectTasks } from "./teamsStore"
import type { TeamTaskSummary } from "../../shared/types"

const task = (taskId: string): TeamTaskSummary => ({
  taskId,
  description: "test task",
  status: "running",
  startedAt: 0,
  lastActivityAt: 0,
})

describe("teamsStore", () => {
  test("setTasks stores per chat; selectTasks returns them", () => {
    useTeamsStore.getState().setTasks("c1", [task("t_a")])
    expect(selectTasks("c1")(useTeamsStore.getState()).map((t) => t.taskId)).toEqual(["t_a"])
  })
  test("selectTasks returns a STABLE empty ref for unknown chat (no render loop)", () => {
    const a = selectTasks("nope")(useTeamsStore.getState())
    const b = selectTasks("nope")(useTeamsStore.getState())
    expect(a).toBe(b)
    expect(a).toEqual([])
  })
  test("setTasks for chat A does not disturb chat B", () => {
    useTeamsStore.getState().setTasks("chatA", [task("t_a")])
    useTeamsStore.getState().setTasks("chatB", [task("t_b")])
    useTeamsStore.getState().setTasks("chatA", [task("t_a2")])
    expect(selectTasks("chatB")(useTeamsStore.getState()).map((t) => t.taskId)).toEqual(["t_b"])
  })
})
