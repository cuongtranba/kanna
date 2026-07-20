import { describe, expect, test } from "bun:test"
import { toOrchRunDetail, toOrchRunSummary, validateOrchRun, type OrchRunContext } from "./orchestration-input"
import { DEFAULT_ORCH_PHASES, type OrchRunSnapshot } from "../shared/orchestration-types"

const CTX: OrchRunContext = {
  chatId: "chat-1",
  repoRoot: "/repo",
  roster: [{ id: "sub-1", name: "worker" }],
  defaultOrchSubagentId: "sub-1",
}

describe("validateOrchRun — accept", () => {
  test("resolves the fixed linear config from a task list", () => {
    const r = validateOrchRun({ tasks: ["do X", "do Y"] }, CTX)
    if (!r.ok) throw new Error(r.errors.join(", "))
    expect(r.resolved.tasks.map((t) => t.id)).toEqual(["t1", "t2"])
    expect(r.resolved.tasks[0]!.title).toBe("do X")
    expect(r.resolved.config.gates).toEqual([])
    expect(r.resolved.config.phases).toBe(DEFAULT_ORCH_PHASES)
    expect(r.resolved.config.workerSubagentId).toBe("sub-1")
    expect(r.resolved.config.originChatId).toBe("chat-1")
    expect(r.resolved.config.verify).toBeNull()
    expect(r.resolved.verifyEnabled).toBe(false)
  })

  test("verify command wraps in sh -c and enables verify", () => {
    const r = validateOrchRun({ tasks: ["x"], verify: "bun test" }, CTX)
    if (!r.ok) throw new Error(r.errors.join(", "))
    expect(r.resolved.config.verify?.command).toEqual(["sh", "-c", "bun test"])
    expect(r.resolved.verifyEnabled).toBe(true)
  })

  test("explicit subagentId overrides the default", () => {
    const ctx = { ...CTX, roster: [{ id: "sub-1", name: "a" }, { id: "sub-2", name: "b" }] }
    const r = validateOrchRun({ tasks: ["x"], subagentId: "sub-2" }, ctx)
    if (!r.ok) throw new Error(r.errors.join(", "))
    expect(r.resolved.config.workerSubagentId).toBe("sub-2")
  })

  test("parallelism caps at 4", () => {
    const r = validateOrchRun({ tasks: ["a", "b", "c", "d", "e"] }, CTX)
    if (!r.ok) throw new Error(r.errors.join(", "))
    expect(r.resolved.config.maxParallelTasks).toBe(4)
    expect(r.resolved.config.worktreePoolSize).toBe(4)
  })
})

describe("validateOrchRun — reject", () => {
  test("empty task list", () => {
    const r = validateOrchRun({ tasks: [] }, CTX)
    expect(r.ok).toBe(false)
  })
  test("too many tasks", () => {
    const r = validateOrchRun({ tasks: Array.from({ length: 9 }, (_, i) => `t${i}`) }, CTX)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes("too many"))).toBe(true)
  })
  test("blank task", () => {
    const r = validateOrchRun({ tasks: ["ok", "   "] }, CTX)
    expect(r.ok).toBe(false)
  })
  test("unparseable verify command", () => {
    const r = validateOrchRun({ tasks: ["x"], verify: "echo 'unbalanced" }, CTX)
    expect(r.ok).toBe(false)
  })
  test("unknown subagent", () => {
    const r = validateOrchRun({ tasks: ["x"], subagentId: "nope" }, CTX)
    expect(r.ok).toBe(false)
  })
  test("no subagent and no default", () => {
    const r = validateOrchRun({ tasks: ["x"] }, { ...CTX, defaultOrchSubagentId: null })
    expect(r.ok).toBe(false)
  })
})

function fakeSnapshot(): OrchRunSnapshot {
  return {
    runId: "run-1",
    status: "running",
    config: {
      title: "Run: 2 tasks",
      repoRoot: "/repo",
      baseBranch: "main",
      maxParallelTasks: 2,
      worktreePoolSize: 2,
      maxAttempts: 3,
      phases: DEFAULT_ORCH_PHASES,
      gates: [],
      contextPrompt: null,
      verify: { command: ["sh", "-c", "bun test"], timeoutMs: 1000, retries: 2 },
      init: null,
    },
    tasks: [
      { taskId: "t1", title: "A", state: "running", ownerWorkerId: "w", worktreePath: "/wt", branch: "b", baseSha: "s", phaseIndex: 1, attempts: 1, error: null, commitSha: null, verifying: false, updatedAt: 10 },
      { taskId: "t2", title: "B", state: "committed", ownerWorkerId: null, worktreePath: "/wt2", branch: "b2", baseSha: "s2", phaseIndex: 2, attempts: 1, error: null, commitSha: "abc", verifying: false, updatedAt: 20 },
    ],
    worktrees: [],
    createdAt: 1,
    updatedAt: 20,
  }
}

describe("DTO normalizers", () => {
  test("toOrchRunSummary tallies task states", () => {
    const s = toOrchRunSummary(fakeSnapshot())
    expect(s.counts).toEqual({ total: 2, queued: 0, running: 1, committed: 1, failed: 0 })
    expect(s.title).toBe("Run: 2 tasks")
    expect(s.status).toBe("running")
  })

  test("toOrchRunDetail projects the linear stage + verifyEnabled", () => {
    const d = toOrchRunDetail(fakeSnapshot())
    expect(d.verifyEnabled).toBe(true)
    expect(d.tasks[0]!.stage).toBe("review") // running at phaseIndex 1 (review)
    expect(d.tasks[1]!.stage).toBe("committed")
  })
})
