import { describe, expect, test } from "bun:test"
import { buildLoopProgress, deriveChunkLabel, parseChunkMarker } from "./loop-progress"
import type { ChatTaskRecord } from "./chat-tasks/types"
import type { SubagentRunSnapshot } from "./types"

function run(overrides: Partial<SubagentRunSnapshot>): SubagentRunSnapshot {
  return {
    runId: "run-1",
    chatId: "c1",
    subagentId: "sa-1",
    subagentName: "subagent-general",
    label: null,
    provider: "claude",
    model: "claude-sonnet-4-6",
    status: "running",
    parentUserMessageId: "m1",
    parentRunId: null,
    depth: 0,
    startedAt: 1_000,
    finishedAt: null,
    finalText: null,
    error: null,
    usage: null,
    entries: [],
    pendingTool: null,
    ...overrides,
  }
}

describe("deriveChunkLabel", () => {
  test("first non-blank line, trimmed", () => {
    expect(deriveChunkLabel("\n\n  Migrate useKannaState.ts  \nmore detail")).toBe(
      "Migrate useKannaState.ts",
    )
  })

  test("strips a single leading markdown marker", () => {
    expect(deriveChunkLabel("- Fix Dockerfiles for Berry")).toBe("Fix Dockerfiles for Berry")
    expect(deriveChunkLabel("## Build + start full stack")).toBe("Build + start full stack")
    expect(deriveChunkLabel("3. Verify service health")).toBe("Verify service health")
    expect(deriveChunkLabel("> quoted chunk")).toBe("quoted chunk")
  })

  test("does not mistake mid-line content for a marker", () => {
    expect(deriveChunkLabel("3D rendering pipeline")).toBe("3D rendering pipeline")
  })

  test("caps overlong labels with an ellipsis", () => {
    const long = "x".repeat(200)
    const label = deriveChunkLabel(long)
    expect(label.length).toBe(80)
    expect(label.endsWith("…")).toBe(true)
  })

  test("empty prompt → empty string", () => {
    expect(deriveChunkLabel("   \n  ")).toBe("")
  })

  test("prefers the [chunk: …] marker over the boilerplate that follows it", () => {
    const prompt =
      "[chunk: Wire session tabs to the store] Do the next chunk in PROGRESS-session-tabs.md."
      + " All work happens in /home/cuong/repo/kanna."
    expect(deriveChunkLabel(prompt)).toBe("Wire session tabs to the store")
  })
})

describe("parseChunkMarker", () => {
  test("reads the marker body, case-insensitively", () => {
    expect(parseChunkMarker("[chunk: Migrate ChatPage] rest")).toBe("Migrate ChatPage")
    expect(parseChunkMarker("  [CHUNK:  Trim spaces  ] rest")).toBe("Trim spaces")
  })

  test("rejects an unsubstituted placeholder so template noise never reaches the UI", () => {
    expect(parseChunkMarker("[chunk: <one-line summary of the Next chunk you just read>] rest"))
      .toBeNull()
  })

  test("null when absent, empty, or not at the head of the prompt", () => {
    expect(parseChunkMarker("Do the next chunk in PROGRESS.md.")).toBeNull()
    expect(parseChunkMarker("[chunk:   ] rest")).toBeNull()
    expect(parseChunkMarker("Prefix [chunk: too late] rest")).toBeNull()
  })

  test("caps an overlong marker body", () => {
    const label = parseChunkMarker(`[chunk: ${"x".repeat(200)}] rest`)
    expect(label?.length).toBe(80)
    expect(label?.endsWith("…")).toBe(true)
  })
})

function task(overrides: Partial<ChatTaskRecord>): ChatTaskRecord {
  return {
    id: "k:1",
    subject: "A task",
    activeForm: null,
    description: null,
    status: "pending",
    source: "kanna",
    needs: [],
    worktree: null,
    branch: null,
    integrated: false,
    claimId: null,
    claimedAt: null,
    runId: null,
    epoch: 0,
    originRunId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    completedAt: null,
    ...overrides,
  }
}

describe("buildLoopProgress", () => {
  test("each task becomes a row with its status, and completed/total are counted", () => {
    const snapshot = buildLoopProgress({
      chatId: "c1",
      armed: true,
      loopArmedAt: 0,
      rateLimit: null,
      runs: [],
      tasks: [
        task({ id: "k:1", subject: "one", status: "completed", completedAt: 20 }),
        task({ id: "k:2", subject: "two", status: "in_progress" }),
        task({ id: "k:3", subject: "three", status: "pending" }),
      ],
    })
    expect(snapshot.rows.map((r) => [r.runId, r.status, r.label])).toEqual([
      ["task:k:1", "done", "one"],
      ["task:k:2", "running", "two"],
      ["task:k:3", "pending", "three"],
    ])
    expect(snapshot.completed).toBe(1)
    expect(snapshot.total).toBe(3)
  })

  test("a pending task whose needs are unmet renders as blocked", () => {
    const rows = buildLoopProgress({
      chatId: "c1",
      armed: true,
      loopArmedAt: 0,
      rateLimit: null,
      runs: [],
      tasks: [
        task({ id: "k:1", subject: "dep", status: "pending" }),
        task({ id: "k:2", subject: "needs dep", status: "pending", needs: ["k:1"] }),
      ],
    }).rows
    expect(rows.map((r) => [r.runId, r.status])).toEqual([
      ["task:k:1", "pending"],
      ["task:k:2", "blocked"],
    ])
  })

  test("an in-progress task shows its activeForm when set", () => {
    const rows = buildLoopProgress({
      chatId: "c1",
      armed: true,
      loopArmedAt: 0,
      rateLimit: null,
      runs: [],
      tasks: [task({ id: "k:1", subject: "Wire the store", activeForm: "Wiring the store", status: "in_progress" })],
    }).rows
    expect(rows[0]?.label).toBe("Wiring the store")
  })

  test("an errored run not bound to any task is shown when armed", () => {
    const rows = buildLoopProgress({
      chatId: "c1",
      armed: true,
      loopArmedAt: 100,
      rateLimit: null,
      runs: [run({ runId: "boom", status: "failed", label: "chunk two", startedAt: 200 })],
      tasks: [task({ id: "k:1", subject: "one", status: "completed" })],
    }).rows
    expect(rows.map((r) => [r.runId, r.status])).toEqual([
      ["task:k:1", "done"],
      ["boom", "failed"],
    ])
  })

  test("errored runs are ignored when the loop is not armed", () => {
    const rows = buildLoopProgress({
      chatId: "c1",
      armed: false,
      loopArmedAt: null,
      rateLimit: null,
      runs: [run({ runId: "boom", status: "failed", startedAt: 200 })],
      tasks: [task({ id: "k:1", subject: "one", status: "pending" })],
    }).rows
    expect(rows.map((r) => r.runId)).toEqual(["task:k:1"])
  })

  test("a run bound to a task is not duplicated as an errored row", () => {
    const rows = buildLoopProgress({
      chatId: "c1",
      armed: true,
      loopArmedAt: 100,
      rateLimit: null,
      runs: [run({ runId: "r1", status: "failed", startedAt: 200 })],
      tasks: [task({ id: "k:1", subject: "one", status: "in_progress", runId: "r1" })],
    }).rows
    expect(rows.map((r) => r.runId)).toEqual(["task:k:1"])
  })

  test("passes rate-limit through and reflects the armed flag with no tasks", () => {
    const snapshot = buildLoopProgress({
      chatId: "c1",
      armed: false,
      loopArmedAt: null,
      rateLimit: { scheduleId: "s1", resetAt: 123, tz: "Asia/Saigon", scheduled: false },
      runs: [],
      tasks: [],
    })
    expect(snapshot.armed).toBe(false)
    expect(snapshot.rateLimit).toEqual({ scheduleId: "s1", resetAt: 123, tz: "Asia/Saigon", scheduled: false })
    expect(snapshot.rows).toEqual([])
    expect(snapshot.total).toBe(0)
  })
})
