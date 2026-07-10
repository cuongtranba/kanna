// src/server/orchestration-queue.test.ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import {
  OrchestrationQueue,
  type OrchWorktreeOps,
  type StartWorker,
} from "./orchestration-queue"
import type { OrchPhaseSpec, OrchRunConfig, OrchTaskSpec } from "../shared/orchestration-types"

export function fakeWorktreeOps(): OrchWorktreeOps & { added: string[]; removed: string[]; resets: string[] } {
  const added: string[] = []
  const removed: string[] = []
  const resets: string[] = []
  return {
    added,
    removed,
    resets,
    async ensureWorktree(repoRoot, branch, wtPath, _base) {
      added.push(wtPath)
      return { path: wtPath, branch, headSha: `head-${branch}` }
    },
    async removeWorktree(_repoRoot, wtPath) {
      removed.push(wtPath)
    },
    async commitAll(_wtPath, _message) {
      return { kind: "committed", sha: "fakesha" }
    },
    async diffAgainstBase(_wtPath, _base) {
      return "diff --git a/x b/x\n+fake"
    },
    async resetHard(wtPath) {
      resets.push(wtPath)
    },
  }
}

function phases(overrides?: Partial<OrchPhaseSpec>[]): OrchPhaseSpec[] {
  const base: OrchPhaseSpec[] = [
    { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
  ]
  if (!overrides) return base
  return overrides.map((o, i) => ({ ...base[0]!, name: `p${i}`, ...o }))
}

function makeConfig(partial?: Partial<OrchRunConfig>): OrchRunConfig {
  return {
    title: "run",
    repoRoot: "/repo",
    baseBranch: "main",
    maxParallelTasks: 2,
    worktreePoolSize: 2,
    maxAttempts: 3,
    phases: phases(),
    gates: [],
    contextPrompt: null,
    verify: null,
    init: null,
    ...partial,
  }
}

async function makeStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-orch-q-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir }
}

function tasks(n: number): OrchTaskSpec[] {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, title: `task ${i + 1}`, prompt: `do ${i + 1}` }))
}

describe("OrchestrationQueue scheduling", () => {
  test("runs all tasks to committed with fake workers", async () => {
    const { store } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "done" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), tasks(3))
    await q.waitForRun(runId)
    const run = store.getOrchRun(runId)!
    expect(run.status).toBe("completed")
    expect(run.tasks.every((t) => t.state === "committed")).toBe(true)
    expect(run.tasks.every((t) => t.ownerWorkerId === null)).toBe(true)
  })

  test("maxParallelTasks bounds concurrent claims (own permit pool, F3)", async () => {
    const { store } = await makeStore()
    let inFlight = 0
    let peak = 0
    const gate: Array<() => void> = []
    const startWorker: StartWorker = async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise<void>((resolve) => gate.push(resolve))
      inFlight -= 1
      return { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig({ maxParallelTasks: 2 }), tasks(5))
    // let the scheduler claim up to the cap
    const deadline = Date.now() + 2000
    while (peak < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(peak).toBe(2)
    // release all workers as they arrive until done
    const release = setInterval(() => { gate.splice(0).forEach((g) => g()) }, 5)
    await q.waitForRun(runId)
    clearInterval(release)
    expect(peak).toBe(2)
    expect(store.getOrchRun(runId)!.status).toBe("completed")
  })

  test("single owner per task — no double assignment (CKR-2)", async () => {
    const { store } = await makeStore()
    const ownersSeen = new Map<string, string[]>()
    const startWorker: StartWorker = async (args) => {
      const list = ownersSeen.get(args.taskId) ?? []
      list.push(args.workerId)
      ownersSeen.set(args.taskId, list)
      return { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig({ maxParallelTasks: 4 }), tasks(8))
    await q.waitForRun(runId)
    for (const [, owners] of ownersSeen) {
      // one phase, parallel 1 → exactly one worker ever touched each task
      expect(owners.length).toBe(1)
    }
  })

  test("worktree pool provisioned up front with deterministic slot branches (F13)", async () => {
    const { store } = await makeStore()
    const wt = fakeWorktreeOps()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: wt, startWorker })
    const runId = await q.createRun(makeConfig({ worktreePoolSize: 2 }), tasks(1))
    await q.waitForRun(runId)
    // pool provisioned in full at createRun, regardless of task count
    expect(wt.added).toHaveLength(2)
    const run = store.getOrchRun(runId)!
    expect(run.worktrees.map((w) => w.branch)).toEqual([`orch/${runId}/wt-0`, `orch/${runId}/wt-1`])
    expect(run.worktrees.every((w) => w.initialized)).toBe(true)
    // the task borrowed slot 0 and recorded its diff anchor
    const task = run.tasks[0]!
    expect(task.branch).toBe(`orch/${runId}/wt-0`)
    expect(task.worktreePath).toBe(run.worktrees[0]!.path)
    expect(task.baseSha).toBe(`head-orch/${runId}/wt-0`)
  })

  test("two tasks NEVER share a worktree slot concurrently (F13 thread safety)", async () => {
    const { store } = await makeStore()
    const inFlightByCwd = new Map<string, number>()
    let violations = 0
    const gate: Array<() => void> = []
    const startWorker: StartWorker = async (args) => {
      const n = (inFlightByCwd.get(args.cwd) ?? 0) + 1
      inFlightByCwd.set(args.cwd, n)
      if (n > 1) violations += 1
      await new Promise<void>((resolve) => gate.push(resolve))
      inFlightByCwd.set(args.cwd, (inFlightByCwd.get(args.cwd) ?? 1) - 1)
      return { kind: "completed", text: "ok" }
    }
    // more workers than slots: concurrency must clamp to the pool size
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig({ maxParallelTasks: 4, worktreePoolSize: 2 }), tasks(5))
    const release = setInterval(() => { gate.splice(0).forEach((g) => g()) }, 5)
    await q.waitForRun(runId)
    clearInterval(release)
    expect(violations).toBe(0)
    expect(store.getOrchRun(runId)!.tasks.every((t) => t.state === "committed")).toBe(true)
  })
})
