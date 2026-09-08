import "../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { act } from "react"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { BackgroundTasksSection, outputBodyText } from "./BackgroundTasksSection"
import type { ChatBackgroundTask } from "../../shared/types"

function makeTask(overrides: Partial<ChatBackgroundTask> = {}): ChatBackgroundTask {
  return {
    id: "bsh42",
    taskType: "local_bash",
    description: "Watch the deploy",
    command: null,
    outputPath: null,
    startedAt: Date.now() - 65_000,
    hasOutput: false,
    ...overrides,
  }
}

describe("BackgroundTasksSection", () => {
  test("renders task descriptions, ids and count without a render loop", async () => {
    const tasks = [
      makeTask(),
      makeTask({ id: "agent7", taskType: "local_agent", description: "Summarise benchmark" }),
    ]
    const result = await renderForLoopCheck(<BackgroundTasksSection chatId="chat-1" tasks={tasks} />)
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
      <BackgroundTasksSection chatId="chat-1" tasks={[makeTask({ description: null })]} />,
    )
    try {
      expect(result.loopWarnings).toEqual([])
      expect(document.body.textContent ?? "").toContain("Background task")
    } finally {
      await result.cleanup()
    }
  })

  test("a task with neither command nor output has no expand affordance", async () => {
    const result = await renderForLoopCheck(
      <BackgroundTasksSection chatId="chat-1" tasks={[makeTask()]} />,
    )
    try {
      expect(document.querySelectorAll("button[aria-label='Show output']")).toHaveLength(0)
    } finally {
      await result.cleanup()
    }
  })

  test("a task carrying only a command is still expandable", async () => {
    const task = makeTask({ command: "until false; do sleep 5; done", hasOutput: false })
    const result = await renderForLoopCheck(
      <BackgroundTasksSection chatId="chat-1" tasks={[task]} />,
    )
    try {
      expect(document.querySelectorAll("button[aria-label='Show output']")).toHaveLength(1)
    } finally {
      await result.cleanup()
    }
  })

  test("expanding shows the command, the output path and an honest empty state", async () => {
    const task = makeTask({
      command: "until false; do sleep 5; done",
      outputPath: "/tmp/tasks/bsh42.output",
      hasOutput: true,
    })
    const result = await renderForLoopCheck(
      <BackgroundTasksSection chatId="chat-1" tasks={[task]} />,
    )
    try {
      const toggle = document.querySelector("button[aria-label='Show output']")
      expect(toggle).not.toBeNull()
      await act(async () => {
        ;(toggle as HTMLButtonElement).click()
      })
      const text = document.body.textContent ?? ""
      expect(text).toContain("Command")
      expect(text).toContain("until false; do sleep 5; done")
      expect(text).toContain("/tmp/tasks/bsh42.output")
    } finally {
      await result.cleanup()
    }
  })

  describe("outputBodyText", () => {
    test("an arrived-but-empty snapshot reads as no output, not as waiting", () => {
      const task = makeTask({ hasOutput: true })
      expect(outputBodyText(task, { content: "", truncated: false }))
        .toBe("No output yet — nothing has been written to this file.")
    })

    test("waiting is reserved for the window before the first snapshot", () => {
      expect(outputBodyText(makeTask({ hasOutput: true }), null)).toBe("Waiting for output…")
    })

    test("a task with no output file says so instead of waiting forever", () => {
      expect(outputBodyText(makeTask({ hasOutput: false, command: "echo hi" }), null))
        .toBe("This task writes no output file.")
    })

    test("content wins whenever there is any", () => {
      expect(outputBodyText(makeTask({ hasOutput: true }), { content: "line1\n", truncated: false }))
        .toBe("line1\n")
    })
  })

  test("renders nothing when there are no tasks", async () => {
    const result = await renderForLoopCheck(<BackgroundTasksSection chatId="chat-1" tasks={[]} />)
    try {
      expect(result.loopWarnings).toEqual([])
      expect((document.body.textContent ?? "").includes("Background tasks")).toBe(false)
    } finally {
      await result.cleanup()
    }
  })
})
