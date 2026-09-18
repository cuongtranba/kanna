import { expect, test } from "bun:test"
import { deriveChatTasks } from "./read-model"
import { selectClaimableTask, validateChatTasks } from "./schedule"
import { CHAT_TASK_EVENT_VERSION, type ChatTaskEvent } from "./types"

const CHAT = "chat-1"

function created(taskId: string, subject: string, extra: Partial<Extract<ChatTaskEvent, { type: "chat_task_created" }>> = {}): ChatTaskEvent {
  return {
    v: CHAT_TASK_EVENT_VERSION,
    timestamp: 1,
    chatId: CHAT,
    type: "chat_task_created",
    taskId,
    subject,
    source: "kanna",
    ...extra,
  }
}

function at(timestamp: number, event: ChatTaskEvent): ChatTaskEvent {
  return { ...event, timestamp }
}

test("a claimed task becomes in_progress and holds its claim id", () => {
  const projection = deriveChatTasks([
    created("k:1", "Extract the parser"),
    at(2, { v: CHAT_TASK_EVENT_VERSION, timestamp: 2, chatId: CHAT, type: "chat_task_claimed", taskId: "k:1", claimId: "c1" }),
  ], { now: 10 })

  const task = projection.tasks[0]
  expect(task?.status).toBe("in_progress")
  expect(task?.claimId).toBe("c1")
})

test("settling done marks the task completed and stamps completedAt", () => {
  const projection = deriveChatTasks([
    created("k:1", "Extract the parser"),
    { v: CHAT_TASK_EVENT_VERSION, timestamp: 2, chatId: CHAT, type: "chat_task_claimed", taskId: "k:1", claimId: "c1" },
    { v: CHAT_TASK_EVENT_VERSION, timestamp: 5, chatId: CHAT, type: "chat_task_settled", taskId: "k:1", claimId: "c1", outcome: "done" },
  ], { now: 10 })

  expect(projection.tasks[0]?.status).toBe("completed")
  expect(projection.tasks[0]?.completedAt).toBe(5)
  expect(projection.completedCount).toBe(1)
})

test("releasing a claim returns the task to pending so a later iteration retries it", () => {
  const projection = deriveChatTasks([
    created("k:1", "Extract the parser"),
    { v: CHAT_TASK_EVENT_VERSION, timestamp: 2, chatId: CHAT, type: "chat_task_claimed", taskId: "k:1", claimId: "c1" },
    { v: CHAT_TASK_EVENT_VERSION, timestamp: 5, chatId: CHAT, type: "chat_task_settled", taskId: "k:1", claimId: "c1", outcome: "release" },
  ], { now: 10 })

  expect(projection.tasks[0]?.status).toBe("pending")
  expect(projection.tasks[0]?.claimId).toBeNull()
})

test("a task is not claimable until every id in needs is completed", () => {
  const events = [
    created("k:1", "Wire the store", { worktree: "/wt/a" }),
    created("k:2", "Migrate callers", { worktree: "/wt/b", needs: ["k:1"] }),
  ]
  const before = selectClaimableTask(deriveChatTasks(events, { now: 10 }).tasks, { now: 10 }, { requireWorktree: true })
  expect(before.kind === "claimable" && before.task.id).toBe("k:1")

  const after = selectClaimableTask(
    deriveChatTasks([
      ...events,
      { v: CHAT_TASK_EVENT_VERSION, timestamp: 6, chatId: CHAT, type: "chat_task_claimed", taskId: "k:1", claimId: "c1" },
      { v: CHAT_TASK_EVENT_VERSION, timestamp: 7, chatId: CHAT, type: "chat_task_settled", taskId: "k:1", claimId: "c1", outcome: "done" },
    ], { now: 10 }).tasks,
    { now: 10 },
    { requireWorktree: true },
  )
  expect(after.kind === "claimable" && after.task.id).toBe("k:2")
})

test("a worktree held by a live lease is not handed to a second worker", () => {
  const tasks = deriveChatTasks([
    created("k:1", "One", { worktree: "/wt/a" }),
    created("k:2", "Two", { worktree: "/wt/a" }),
    { v: CHAT_TASK_EVENT_VERSION, timestamp: 2, chatId: CHAT, type: "chat_task_claimed", taskId: "k:1", claimId: "c1" },
    { v: CHAT_TASK_EVENT_VERSION, timestamp: 3, chatId: CHAT, type: "chat_task_run_bound", taskId: "k:1", claimId: "c1", runId: "run-1" },
  ], { now: 10, isRunAlive: () => true }).tasks

  const outcome = selectClaimableTask(tasks, { now: 10, isRunAlive: () => true }, { requireWorktree: true })
  expect(outcome.kind).toBe("waiting")
})

test("a lease whose run is dead is reclaimable — the wake that never comes back otherwise", () => {
  const tasks = deriveChatTasks([
    created("k:1", "One", { worktree: "/wt/a" }),
    { v: CHAT_TASK_EVENT_VERSION, timestamp: 2, chatId: CHAT, type: "chat_task_claimed", taskId: "k:1", claimId: "c1" },
    { v: CHAT_TASK_EVENT_VERSION, timestamp: 3, chatId: CHAT, type: "chat_task_run_bound", taskId: "k:1", claimId: "c1", runId: "run-1" },
  ], { now: 10, isRunAlive: () => false }).tasks

  const outcome = selectClaimableTask(tasks, { now: 10, isRunAlive: () => false }, { requireWorktree: true })
  expect(outcome.kind === "claimable" && outcome.task.id).toBe("k:1")
})

test("a claim that never bound a run is held for the grace window, then reclaimed", () => {
  const events = [
    created("k:1", "One", { worktree: "/wt/a" }),
    { v: CHAT_TASK_EVENT_VERSION, timestamp: 1_000, chatId: CHAT, type: "chat_task_claimed", taskId: "k:1", claimId: "c1" } satisfies ChatTaskEvent,
  ]
  const held = selectClaimableTask(
    deriveChatTasks(events, { now: 2_000 }).tasks, { now: 2_000 }, { requireWorktree: true },
  )
  expect(held.kind).toBe("waiting")

  const expired = selectClaimableTask(
    deriveChatTasks(events, { now: 1_000 + 120_001 }).tasks,
    { now: 1_000 + 120_001 },
    { requireWorktree: true },
  )
  expect(expired.kind).toBe("claimable")
})

test("a dependency cycle reports blocked rather than silently stalling", () => {
  const tasks = deriveChatTasks([
    created("k:1", "One", { worktree: "/wt/a", needs: ["k:2"] }),
    created("k:2", "Two", { worktree: "/wt/b", needs: ["k:1"] }),
  ], { now: 10 }).tasks

  const outcome = selectClaimableTask(tasks, { now: 10 }, { requireWorktree: true })
  expect(outcome.kind).toBe("blocked")
  expect(validateChatTasks(tasks, { requireWorktree: true }).some((p) => p.kind === "cycle")).toBe(true)
})

test("an unknown dependency is reported, not treated as satisfied", () => {
  const tasks = deriveChatTasks([
    created("k:1", "One", { worktree: "/wt/a", needs: ["k:missing"] }),
  ], { now: 10 }).tasks

  expect(validateChatTasks(tasks, { requireWorktree: true })).toContainEqual({
    kind: "unknown_dependency", id: "k:1", needs: "k:missing",
  })
})

test("deleting a task removes it from the projection", () => {
  const projection = deriveChatTasks([
    created("k:1", "One"),
    { v: CHAT_TASK_EVENT_VERSION, timestamp: 2, chatId: CHAT, type: "chat_task_deleted", taskId: "k:1" },
  ], { now: 10 })

  expect(projection.tasks).toHaveLength(0)
})
