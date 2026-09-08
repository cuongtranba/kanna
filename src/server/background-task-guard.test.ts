import { describe, expect, test } from "bun:test"
import { createBackgroundTaskGuard, formatBackgroundTaskHarvestPrompt } from "./background-task-guard"
import type { BackgroundTaskGuardSession } from "./background-task-guard"
import { createModelEscalation } from "./model-escalation"
import type { SessionBackgroundTask } from "./claude-session-state"

function makeTask(overrides: Partial<SessionBackgroundTask> = {}): SessionBackgroundTask {
  return {
    taskType: "local_bash",
    description: "Watch CI checks until completion",
    startedAt: 1_000,
    outputPath: "/tmp/tasks/bsh42.output",
    command: "until false; do sleep 5; done",
    ...overrides,
  }
}

function makeSession(
  tasks: Array<[string, SessionBackgroundTask]>,
  levelSourced = true,
): BackgroundTaskGuardSession {
  return { chatId: "chat-1", backgroundTasksLevelSourced: levelSourced, getBackgroundTaskEntries: () => tasks }
}

function makeHarness(opts: { enabled?: boolean; loopArmed?: boolean; queued?: boolean } = {}) {
  const enqueued: Array<{ chatId: string; content: string; scheduleId: string | undefined }> = []
  const guard = createBackgroundTaskGuard({
    escalation: createModelEscalation({
      name: "background-task",
      enabled: opts.enabled ?? true,
      hasQueuedMessage: () => opts.queued ?? false,
      enqueueMessage: async (chatId, content, options) => {
        enqueued.push({ chatId, content, scheduleId: options?.autoContinue?.scheduleId })
      },
    }),
    isLoopArmed: () => opts.loopArmed ?? false,
  })
  return { guard, enqueued }
}

describe("createBackgroundTaskGuard", () => {
  test("offers once for a task still live at turn end", async () => {
    const { guard, enqueued } = makeHarness()
    await guard.check(makeSession([["bsh42", makeTask()]]))
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]?.chatId).toBe("chat-1")
    expect(enqueued[0]?.scheduleId).toBe("background-task-harvest-bsh42")
    expect(enqueued[0]?.content).toContain("bsh42")
    expect(enqueued[0]?.content).toContain("until false; do sleep 5; done")
    expect(enqueued[0]?.content).toContain("/tmp/tasks/bsh42.output")
  })

  test("does not ask twice about the same task", async () => {
    const { guard, enqueued } = makeHarness()
    await guard.check(makeSession([["bsh42", makeTask()]]))
    await guard.check(makeSession([["bsh42", makeTask()]]))
    expect(enqueued).toHaveLength(1)
  })

  test("a second, different task gets its own offer", async () => {
    const { guard, enqueued } = makeHarness()
    await guard.check(makeSession([["bsh42", makeTask()]]))
    await guard.check(makeSession([["bsh42", makeTask()], ["bsh99", makeTask()]]))
    expect(enqueued).toHaveLength(2)
    expect(enqueued[1]?.scheduleId).toBe("background-task-harvest-bsh99")
  })

  test("says nothing when there are no live tasks", async () => {
    const { guard, enqueued } = makeHarness()
    await guard.check(makeSession([]))
    expect(enqueued).toHaveLength(0)
  })

  test("stands down when the session is not level-sourced — the deadline wake ladder owns it", async () => {
    const { guard, enqueued } = makeHarness()
    await guard.check(makeSession([["bsh42", makeTask()]], false))
    expect(enqueued).toHaveLength(0)
  })

  test("stands down while a loop is armed", async () => {
    const { guard, enqueued } = makeHarness({ loopArmed: true })
    await guard.check(makeSession([["bsh42", makeTask()]]))
    expect(enqueued).toHaveLength(0)
  })

  test("stands aside when a user message is already queued", async () => {
    const { guard, enqueued } = makeHarness({ queued: true })
    await guard.check(makeSession([["bsh42", makeTask()]]))
    expect(enqueued).toHaveLength(0)
  })

  test("is inert when disabled", async () => {
    const { guard, enqueued } = makeHarness({ enabled: false })
    await guard.check(makeSession([["bsh42", makeTask()]]))
    expect(enqueued).toHaveLength(0)
  })

  test("a throwing enqueue never escapes into the turn", async () => {
    const guard = createBackgroundTaskGuard({
      escalation: createModelEscalation({
        name: "background-task",
        enabled: true,
        hasQueuedMessage: () => false,
        enqueueMessage: async () => { throw new Error("store is down") },
      }),
      isLoopArmed: () => false,
    })
    await expect(guard.check(makeSession([["bsh42", makeTask()]]))).resolves.toBeUndefined()
  })

  test("a throwing isLoopArmed never escapes into the turn", async () => {
    const guard = createBackgroundTaskGuard({
      escalation: createModelEscalation({
        name: "background-task",
        enabled: true,
        hasQueuedMessage: () => false,
        enqueueMessage: async () => {},
      }),
      isLoopArmed: () => { throw new Error("no store") },
    })
    await expect(guard.check(makeSession([["bsh42", makeTask()]]))).resolves.toBeUndefined()
  })
})

describe("formatBackgroundTaskHarvestPrompt", () => {
  test("names the id, description, command and output path", () => {
    const prompt = formatBackgroundTaskHarvestPrompt("bsh42", makeTask())
    expect(prompt).toContain("bsh42")
    expect(prompt).toContain("Watch CI checks until completion")
    expect(prompt).toContain("until false; do sleep 5; done")
    expect(prompt).toContain("/tmp/tasks/bsh42.output")
    expect(prompt).toContain("TaskOutput")
  })

  test("an agent task is told not to read its output file", () => {
    const prompt = formatBackgroundTaskHarvestPrompt(
      "a7f",
      makeTask({ taskType: "local_agent", command: null, outputPath: null }),
    )
    expect(prompt).toContain("TaskOutput")
    expect(prompt).not.toContain("Read")
  })

  test("omits the lines it has no fact for", () => {
    const prompt = formatBackgroundTaskHarvestPrompt(
      "bsh1",
      makeTask({ description: null, command: null, outputPath: null }),
    )
    expect(prompt).toContain("bsh1")
    expect(prompt).not.toContain("Command:")
    expect(prompt).not.toContain("Output file:")
  })
})
