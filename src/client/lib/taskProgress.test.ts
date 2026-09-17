import { expect, test } from "bun:test"
import type { HydratedTranscriptMessage, TranscriptEntry } from "../../shared/types"
import { processTranscriptMessages } from "./parseTranscript"
import { buildTaskProgress } from "./taskProgress"

let seq = 0

function create(
  subject: string,
  id: string | null,
  opts: { activeForm?: string } = {},
): HydratedTranscriptMessage {
  seq += 1
  return {
    id: `msg-${seq}`,
    kind: "tool",
    toolKind: "task_create",
    toolName: "TaskCreate",
    toolId: `tool-${seq}`,
    input: { subject, description: "", ...(opts.activeForm ? { activeForm: opts.activeForm } : {}) },
    ...(id === null ? {} : { result: { task: { id, subject } } }),
    timestamp: "00:00",
  }
}

function update(
  taskId: string,
  status: "pending" | "in_progress" | "completed" | "deleted",
  opts: { success?: boolean } = {},
): HydratedTranscriptMessage {
  seq += 1
  return {
    id: `msg-${seq}`,
    kind: "tool",
    toolKind: "task_update",
    toolName: "TaskUpdate",
    toolId: `tool-${seq}`,
    input: { taskId, status },
    result: { success: opts.success ?? true, taskId },
    timestamp: "00:00",
  }
}

function list(tasks: Array<{ id: string; subject: string; status: "pending" | "in_progress" | "completed" }>): HydratedTranscriptMessage {
  seq += 1
  return {
    id: `msg-${seq}`,
    kind: "tool",
    toolKind: "task_list",
    toolName: "TaskList",
    toolId: `tool-${seq}`,
    input: {},
    result: { tasks },
    timestamp: "00:00",
  }
}

function cleared(): HydratedTranscriptMessage {
  seq += 1
  return { id: `msg-${seq}`, kind: "context_cleared", timestamp: "00:00" }
}

test("accumulates one row per created task, in creation order", () => {
  const snapshot = buildTaskProgress([create("Alpha", "1"), create("Beta", "2")])

  expect(snapshot.rows.map((row) => row.label)).toEqual(["Alpha", "Beta"])
  expect(snapshot.completed).toBe(0)
})

test("carries a task through in_progress to completed", () => {
  const snapshot = buildTaskProgress([
    create("Alpha", "1"),
    create("Beta", "2"),
    update("1", "in_progress"),
    update("1", "completed"),
    update("2", "in_progress"),
  ])

  expect(snapshot.rows).toEqual([
    { id: "1", label: "Alpha", status: "completed" },
    { id: "2", label: "Beta", status: "in_progress" },
  ])
  expect(snapshot.completed).toBe(1)
})

test("a deleted task leaves the list", () => {
  const snapshot = buildTaskProgress([
    create("Alpha", "1"),
    create("Beta", "2"),
    update("1", "deleted"),
  ])

  expect(snapshot.rows.map((row) => row.id)).toEqual(["2"])
})

test("shows activeForm while in progress and the subject otherwise", () => {
  const messages = [create("Extract auth module", "1", { activeForm: "Extracting auth module" })]

  expect(buildTaskProgress(messages).rows[0]?.label).toBe("Extract auth module")
  expect(buildTaskProgress([...messages, update("1", "in_progress")]).rows[0]?.label)
    .toBe("Extracting auth module")
})

test("falls back to the subject when the model omits activeForm", () => {
  const snapshot = buildTaskProgress([create("Alpha", "1"), update("1", "in_progress")])

  expect(snapshot.rows[0]?.label).toBe("Alpha")
})

test("ignores a create whose id has not come back yet", () => {
  expect(buildTaskProgress([create("Alpha", null)]).rows).toEqual([])
})

test("ignores an update the tool reported as failed", () => {
  const snapshot = buildTaskProgress([
    create("Alpha", "1"),
    update("1", "completed", { success: false }),
  ])

  expect(snapshot.rows[0]?.status).toBe("pending")
})

test("a task list result resyncs tasks created before the loaded window", () => {
  const snapshot = buildTaskProgress([
    list([
      { id: "7", subject: "Earlier work", status: "completed" },
      { id: "8", subject: "Current work", status: "in_progress" },
    ]),
  ])

  expect(snapshot.rows).toEqual([
    { id: "7", label: "Earlier work", status: "completed" },
    { id: "8", label: "Current work", status: "in_progress" },
  ])
  expect(snapshot.completed).toBe(1)
})

test("a task list result drops tasks it no longer reports", () => {
  const snapshot = buildTaskProgress([
    create("Alpha", "1"),
    create("Beta", "2"),
    list([{ id: "2", subject: "Beta", status: "completed" }]),
  ])

  expect(snapshot.rows.map((row) => row.id)).toEqual(["2"])
})

test("clearing context drops the board", () => {
  const snapshot = buildTaskProgress([
    create("Alpha", "1"),
    cleared(),
    create("Beta", "2"),
  ])

  expect(snapshot.rows.map((row) => row.label)).toEqual(["Beta"])
})

function transcriptEntry(partial: Record<string, unknown>): TranscriptEntry {
  return { _id: crypto.randomUUID(), createdAt: Date.now(), ...partial } as TranscriptEntry
}

function debugRawFor(structured: unknown): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [] }, tool_use_result: structured })
}

test("recovers task ids through the real transcript hydration path, not the prose result text", () => {
  const messages = processTranscriptMessages([
    transcriptEntry({
      kind: "tool_call",
      tool: {
        kind: "tool",
        toolKind: "task_create",
        toolName: "TaskCreate",
        toolId: "tool-1",
        input: { subject: "Alpha", description: "" },
      },
    }),
    transcriptEntry({
      kind: "tool_result",
      toolId: "tool-1",
      content: "Task #1 created successfully: Alpha",
      debugRaw: debugRawFor({ task: { id: "1", subject: "Alpha" } }),
    }),
    transcriptEntry({
      kind: "tool_call",
      tool: {
        kind: "tool",
        toolKind: "task_update",
        toolName: "TaskUpdate",
        toolId: "tool-2",
        input: { taskId: "1", status: "completed" },
      },
    }),
    transcriptEntry({
      kind: "tool_result",
      toolId: "tool-2",
      content: "Updated task #1 status",
      debugRaw: debugRawFor({ success: true, taskId: "1", updatedFields: ["status"] }),
    }),
  ])

  expect(buildTaskProgress(messages).rows).toEqual([{ id: "1", label: "Alpha", status: "completed" }])
})
