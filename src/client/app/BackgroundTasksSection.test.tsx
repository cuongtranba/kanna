import "../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { BackgroundTasksSection } from "./BackgroundTasksSection"
import type { ChatBackgroundTask } from "../../shared/types"

function makeTask(overrides: Partial<ChatBackgroundTask> = {}): ChatBackgroundTask {
  return {
    id: "bsh42",
    taskType: "local_bash",
    description: "Watch the deploy",
    startedAt: Date.now() - 65_000,
    ...overrides,
  }
}

describe("BackgroundTasksSection", () => {
  test("renders task descriptions, ids and count without a render loop", async () => {
    const tasks = [
      makeTask(),
      makeTask({ id: "agent7", taskType: "local_agent", description: "Summarise benchmark" }),
    ]
    const result = await renderForLoopCheck(<BackgroundTasksSection tasks={tasks} />)
    try {
      expect(result.loopWarnings).toEqual([])
      const text = document.body.textContent ?? ""
      expect(text).toContain("Background tasks")
      expect(text).toContain("2 running")
      expect(text).toContain("Watch the deploy")
      expect(text).toContain("Summarise benchmark")
      expect(text).toContain("bsh42")
      expect(text).toContain("agent7")
    } finally {
      await result.cleanup()
    }
  })

  test("falls back to a generic label when description is missing", async () => {
    const result = await renderForLoopCheck(
      <BackgroundTasksSection tasks={[makeTask({ description: null })]} />,
    )
    try {
      expect(result.loopWarnings).toEqual([])
      expect(document.body.textContent ?? "").toContain("Background task")
    } finally {
      await result.cleanup()
    }
  })

  test("renders nothing when there are no tasks", async () => {
    const result = await renderForLoopCheck(<BackgroundTasksSection tasks={[]} />)
    try {
      expect(result.loopWarnings).toEqual([])
      expect((document.body.textContent ?? "").includes("Background tasks")).toBe(false)
    } finally {
      await result.cleanup()
    }
  })
})
