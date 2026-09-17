import "../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { TaskProgressSection } from "./TaskProgressSection"
import type { HydratedTranscriptMessage } from "../../shared/types"

let seq = 0

function create(subject: string, id: string): HydratedTranscriptMessage {
  seq += 1
  return {
    id: `msg-${seq}`,
    kind: "tool",
    toolKind: "task_create",
    toolName: "TaskCreate",
    toolId: `tool-${seq}`,
    input: { subject, description: "" },
    result: { task: { id, subject } },
    timestamp: "00:00",
  }
}

function update(taskId: string, status: "in_progress" | "completed"): HydratedTranscriptMessage {
  seq += 1
  return {
    id: `msg-${seq}`,
    kind: "tool",
    toolKind: "task_update",
    toolName: "TaskUpdate",
    toolId: `tool-${seq}`,
    input: { taskId, status },
    result: { success: true, taskId },
    timestamp: "00:00",
  }
}

describe("TaskProgressSection", () => {
  test("lists every tracked task in order with a completed tally", async () => {
    const messages = [
      create("Extract auth module", "1"),
      create("Add tests", "2"),
      update("1", "completed"),
      update("2", "in_progress"),
    ]
    const result = await renderForLoopCheck(<TaskProgressSection messages={messages} />)
    try {
      expect(result.loopWarnings).toEqual([])
      const text = document.body.textContent ?? ""
      expect(text).toContain("Tasks")
      expect(text).toContain("1/2 completed")
      expect(text.indexOf("Extract auth module")).toBeLessThan(text.indexOf("Add tests"))
    } finally {
      await result.cleanup()
    }
  })

  test("renders nothing when the agent tracked no tasks", async () => {
    const result = await renderForLoopCheck(<TaskProgressSection messages={[]} />)
    try {
      expect(result.loopWarnings).toEqual([])
      expect((document.body.textContent ?? "").includes("Tasks")).toBe(false)
    } finally {
      await result.cleanup()
    }
  })
})
