// src/server/orchestration-queue.test.ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import {
  OrchestrationQueue,
  detectScopeOverlap,
  type OrchGateOpenedNotice,
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

describe("OrchestrationQueue phase pipeline", () => {
  test("phases run in declared order, fresh worker ids per phase (F4)", async () => {
    const { store } = await makeStore()
    const calls: Array<{ phaseIndex: number; workerId: string; prompt: string }> = []
    const startWorker: StartWorker = async (args) => {
      calls.push({ phaseIndex: args.phaseIndex, workerId: args.workerId, prompt: args.prompt })
      return { kind: "completed", text: `out-p${args.phaseIndex}` }
    }
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "review", kind: "review", parallel: 2, promptTemplate: "REVIEW {{DIFF}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{TASK}} FEEDBACK {{PRIOR}}" },
      ],
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(config, tasks(1))
    await q.waitForRun(runId)

    expect(calls.map((c) => c.phaseIndex)).toEqual([0, 1, 1, 2])
    // review fanout gets distinct fresh worker ids
    const reviewIds = calls.filter((c) => c.phaseIndex === 1).map((c) => c.workerId)
    expect(new Set(reviewIds).size).toBe(2)
    // prompt composition
    expect(calls[0]!.prompt).toBe("IMPL do 1")
    expect(calls[1]!.prompt).toContain("+fake") // {{DIFF}} from fake ops
    expect(calls[3]!.prompt).toContain("out-p1") // {{PRIOR}} = joined review output
    expect(calls[3]!.prompt).toContain("do 1")
  })

  test("phase failure marks task failed, run still completes (other tasks unaffected)", async () => {
    const { store } = await makeStore()
    const wt = fakeWorktreeOps()
    const startWorker: StartWorker = async (args) =>
      args.taskId === "t1"
        ? { kind: "failed", error: "boom" }
        : { kind: "completed", text: "ok" }
    const q = new OrchestrationQueue({ store, worktrees: wt, startWorker })
    const runId = await q.createRun(makeConfig(), tasks(2))
    await q.waitForRun(runId)
    const run = store.getOrchRun(runId)!
    expect(run.status).toBe("completed")
    const t1 = run.tasks.find((t) => t.taskId === "t1")!
    const t2 = run.tasks.find((t) => t.taskId === "t2")!
    expect(t1.state).toBe("failed")
    expect(t1.error).toBe("boom")
    expect(t2.state).toBe("committed")
    // F13: failed task's uncommitted junk scrubbed so the slot is safe to reuse
    expect(wt.resets).toEqual([t1.worktreePath!])
    // and the slot was released back to the pool
    expect(run.worktrees.find((w) => w.path === t1.worktreePath)!.heldByTaskId).toBeNull()
  })

  test("every transition produced a persisted event (AG3)", async () => {
    const { store, dir } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), tasks(1))
    await q.waitForRun(runId)
    await store.flush()
    const log = await Bun.file(path.join(dir, "orch.jsonl")).text()
    const types = log.trim().split("\n").map((l) => (JSON.parse(l) as { type: string }).type)
    expect(types).toEqual([
      "orch_run_created",
      "orch_worktree_provisioned",      // slot 0 (F13)
      "orch_worktree_init_completed",
      "orch_worktree_provisioned",      // slot 1
      "orch_worktree_init_completed",
      "orch_task_claimed",
      "orch_phase_started",
      "orch_phase_completed",
      "orch_task_committed",
      "orch_run_completed",
    ])
  })
})

describe("OrchestrationQueue hand-back", () => {
  test("handed_back requeues and a later claim retries with attempt+1", async () => {
    const { store } = await makeStore()
    let firstCall = true
    const startWorker: StartWorker = async () => {
      if (firstCall) {
        firstCall = false
        return { kind: "handed_back", reason: "unknown discovered" }
      }
      return { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), tasks(1))
    await q.waitForRun(runId)
    const task = store.getOrchRun(runId)!.tasks[0]!
    expect(task.state).toBe("committed")
    expect(task.attempts).toBe(2)
  })

  test("attempts exhausted -> terminal failed, run completes", async () => {
    const { store } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "handed_back", reason: "never learns" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig({ maxAttempts: 2 }), tasks(1))
    await q.waitForRun(runId)
    const task = store.getOrchRun(runId)!.tasks[0]!
    expect(task.state).toBe("failed")
    expect(task.attempts).toBe(2)
    expect(task.error).toContain("max attempts")
    expect(store.getOrchRun(runId)!.status).toBe("completed")
  })

  test("requeued task re-claims its OWN slot — dirty progress never trampled (F13/F2)", async () => {
    const { store } = await makeStore()
    const wt = fakeWorktreeOps()
    let calls = 0
    const startWorker: StartWorker = async () => {
      calls += 1
      return calls === 1 ? { kind: "handed_back", reason: "retry" } : { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: wt, startWorker })
    const runId = await q.createRun(makeConfig(), tasks(1))
    await q.waitForRun(runId)
    // both claims bound the SAME slot (hold kept across requeue)
    const claims = store.getOrchRunEvents(runId)
      .filter((e): e is Extract<typeof e, { type: "orch_task_claimed" }> => e.type === "orch_task_claimed")
    expect(claims).toHaveLength(2)
    expect(claims[0]!.worktreePath).toBe(claims[1]!.worktreePath)
    // hand-back is NOT a failure — the worktree must never be reset (F2)
    expect(wt.resets).toHaveLength(0)
  })
})

describe("OrchestrationQueue gates (F5)", () => {
  const gatedConfig = (kind: "soft" | "hard") => makeConfig({
    phases: [
      { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
      { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
    ],
    gates: [{ afterPhase: "implement", kind }],
  })

  test("hard gate pauses task in gated; approve resumes next phase with prior output", async () => {
    const { store } = await makeStore()
    const notices: OrchGateOpenedNotice[] = []
    const prompts: string[] = []
    const startWorker: StartWorker = async (args) => {
      prompts.push(args.prompt)
      return { kind: "completed", text: `out-p${args.phaseIndex}` }
    }
    const q = new OrchestrationQueue({
      store, worktrees: fakeWorktreeOps(), startWorker,
      onGateOpened: (n) => notices.push(n),
    })
    const runId = await q.createRun(gatedConfig("hard"), tasks(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("gated")
    expect(notices).toHaveLength(1)
    expect(notices[0]!.gateKind).toBe("hard")
    expect(q.resolveGate(runId, "t1", "approve")).toBe(true)
    await q.waitForRun(runId)
    const task = store.getOrchRun(runId)!.tasks[0]!
    expect(task.state).toBe("committed")
    expect(prompts[1]).toContain("out-p0") // fix phase saw implement output across the gate
  })

  test("hard gate reject -> task failed with gate error, run completes", async () => {
    const { store } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(gatedConfig("hard"), tasks(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(q.resolveGate(runId, "t1", "reject")).toBe(true)
    await q.waitForRun(runId)
    const task = store.getOrchRun(runId)!.tasks[0]!
    expect(task.state).toBe("failed")
    expect(task.error).toContain('hard gate after phase "implement" rejected')
    expect(store.getOrchRun(runId)!.status).toBe("completed")
  })

  test("soft gate flags and continues without resolution", async () => {
    const { store, dir } = await makeStore()
    const notices: OrchGateOpenedNotice[] = []
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({
      store, worktrees: fakeWorktreeOps(), startWorker,
      onGateOpened: (n) => notices.push(n),
    })
    const runId = await q.createRun(gatedConfig("soft"), tasks(1))
    await q.waitForRun(runId) // no resolveGate call — must complete on its own
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("committed")
    expect(notices).toHaveLength(1)
    expect(notices[0]!.gateKind).toBe("soft")
    await store.flush()
    const log = await Bun.file(path.join(dir, "orch.jsonl")).text()
    const types = log.trim().split("\n").map((l) => (JSON.parse(l) as { type: string }).type)
    expect(types).toContain("orch_gate_opened")
    expect(types).toContain("orch_gate_resolved")
  })

  test("cancelRun unblocks a hard-gate waiter (AG1: explicit cancel only)", async () => {
    const { store } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(gatedConfig("hard"), tasks(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("gated")
    await q.cancelRun(runId)
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.status).toBe("cancelled")
  })
})

describe("OrchestrationQueue scope overlap (F6)", () => {
  test("overlapping scopePaths emit a soft flag; run proceeds", async () => {
    const { store, dir } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), [
      { id: "t1", title: "a", prompt: "a", scopePaths: ["src/a"] },
      { id: "t2", title: "b", prompt: "b", scopePaths: ["src/a/utils.ts"] },
      { id: "t3", title: "c", prompt: "c", scopePaths: ["src/c"] },
    ])
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.tasks.every((t) => t.state === "committed")).toBe(true)
    await store.flush()
    const log = await Bun.file(path.join(dir, "orch.jsonl")).text()
    const flag = log.trim().split("\n")
      .map((l) => JSON.parse(l) as { type: string; taskIds?: string[] })
      .find((e) => e.type === "orch_scope_overlap_flagged")
    expect(flag).toBeDefined()
    expect(flag!.taskIds!.sort()).toEqual(["t1", "t2"])
  })

  test("maxParallelTasks > worktreePoolSize emits a soft config warning; run proceeds", async () => {
    const { store, dir } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig({ maxParallelTasks: 6, worktreePoolSize: 2 }), [
      { id: "t1", title: "a", prompt: "a" },
    ])
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.status).toBe("completed")
    await store.flush()
    const log = await Bun.file(path.join(dir, "orch.jsonl")).text()
    const warn = log.trim().split("\n")
      .map((l) => JSON.parse(l) as { type: string; message?: string })
      .find((e) => e.type === "orch_config_warning")
    expect(warn).toBeDefined()
    expect(warn!.message).toContain("capped at 2")
  })
})

describe("OrchestrationQueue gated restart re-arm (F2+F5)", () => {
  test("boot with task paused at hard gate: gate re-notified, approve resumes with persisted prior", async () => {
    const { store, dir } = await makeStore()
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
      ],
      gates: [{ afterPhase: "implement", kind: "hard" }],
    })
    // Previous lifetime: implement done, gate opened, then crash.
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config, tasks: [{ id: "t1", title: "a", prompt: "do a" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-old", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_phase_started", timestamp: 3, runId: "r1", taskId: "t1",
      phaseIndex: 0, phaseName: "implement", workerIds: ["w-old"],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_phase_completed", timestamp: 4, runId: "r1", taskId: "t1",
      phaseIndex: 0, output: "impl out", outputChars: 8,
      workers: [{ workerId: "w-old", subagentRunId: null }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_gate_opened", timestamp: 5, runId: "r1", taskId: "t1",
      phaseIndex: 0, phaseName: "implement", gateKind: "hard",
    })
    await store.flush()

    const reopened = new EventStore(dir)
    await reopened.initialize()
    expect(reopened.getOrchRun("r1")!.tasks[0]!.state).toBe("gated")

    const notices: OrchGateOpenedNotice[] = []
    const prompts: string[] = []
    const startWorker: StartWorker = async (args) => {
      prompts.push(args.prompt)
      return { kind: "completed", text: "fixed" }
    }
    const q = new OrchestrationQueue({
      store: reopened, worktrees: fakeWorktreeOps(), startWorker,
      onGateOpened: (n) => notices.push(n),
    })
    await q.recoverOnStartup()
    await new Promise((r) => setTimeout(r, 20))
    expect(notices).toHaveLength(1) // gate re-notified, task NOT requeued
    expect(reopened.getOrchRun("r1")!.tasks[0]!.state).toBe("gated")

    expect(q.resolveGate("r1", "t1", "approve")).toBe(true)
    await q.waitForRun("r1")
    const task = reopened.getOrchRun("r1")!.tasks[0]!
    expect(task.state).toBe("committed")
    expect(prompts).toHaveLength(1) // only the fix phase ran after resume
    expect(prompts[0]).toContain("impl out") // persisted {{PRIOR}} survived the restart
  })

  test("recovered gated task does not inflate permit pool (no permit leak)", async () => {
    const { store, dir } = await makeStore()
    const config = makeConfig({
      maxParallelTasks: 1,
      worktreePoolSize: 1,
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
      ],
      gates: [{ afterPhase: "implement", kind: "hard" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r2",
      config, tasks: [{ id: "t1", title: "a", prompt: "do a" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r2", taskId: "t1",
      workerId: "w-old", worktreePath: "/wt/t1", branch: "orch/r2/wt-0", baseSha: "sha0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_phase_started", timestamp: 3, runId: "r2", taskId: "t1",
      phaseIndex: 0, phaseName: "implement", workerIds: ["w-old"],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_phase_completed", timestamp: 4, runId: "r2", taskId: "t1",
      phaseIndex: 0, output: "impl out", outputChars: 8,
      workers: [{ workerId: "w-old", subagentRunId: null }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_gate_opened", timestamp: 5, runId: "r2", taskId: "t1",
      phaseIndex: 0, phaseName: "implement", gateKind: "hard",
    })
    await store.flush()

    const reopened = new EventStore(dir)
    await reopened.initialize()
    const q = new OrchestrationQueue({
      store: reopened, worktrees: fakeWorktreeOps(),
      startWorker: async () => ({ kind: "completed", text: "fixed" }),
    })
    await q.recoverOnStartup()
    await new Promise((r) => setTimeout(r, 20))
    expect(q.resolveGate("r2", "t1", "approve")).toBe(true)
    await q.waitForRun("r2")
    // After completion, permits must be back to maxParallelTasks (no leak)
    expect(q.getPermits("r2")).toBe(config.maxParallelTasks)
  })
})

describe("detectScopeOverlap", () => {
  test("disjoint -> null", () => {
    expect(detectScopeOverlap([
      { id: "a", title: "a", prompt: "a", scopePaths: ["src/a"] },
      { id: "b", title: "b", prompt: "b", scopePaths: ["src/b"] },
    ])).toBeNull()
  })
  test("prefix normalization: ./src/a/ overlaps src/a/x.ts", () => {
    const hit = detectScopeOverlap([
      { id: "a", title: "a", prompt: "a", scopePaths: ["./src/a/"] },
      { id: "b", title: "b", prompt: "b", scopePaths: ["src/a/x.ts"] },
    ])
    expect(hit?.taskIds.sort()).toEqual(["a", "b"])
  })
  test("missing scopePaths never overlap", () => {
    expect(detectScopeOverlap([
      { id: "a", title: "a", prompt: "a" },
      { id: "b", title: "b", prompt: "b", scopePaths: ["src"] },
    ])).toBeNull()
  })
})

describe("OrchestrationQueue verify step (F12)", () => {
  test("verify passing -> task committed, verify events in timeline", async () => {
    const { store } = await makeStore()
    let verifyCalls = 0
    const runVerify = async () => { verifyCalls++; return { exitCode: 0, output: "ok" } }
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const config = makeConfig({
      phases: [{ name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" }],
      verify: { command: ["check"], timeoutMs: 1_000, retries: 1 },
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker, runVerify })
    const runId = await q.createRun(config, tasks(1))
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("committed")
    expect(verifyCalls).toBe(1)
    const events = store.getOrchRunEvents(runId)
    expect(events.some((e) => e.type === "orch_verify_started")).toBe(true)
    expect(events.some((e) => e.type === "orch_verify_completed" && (e as { passed: boolean }).passed)).toBe(true)
  })

  test("verify fail then pass after fix retry -> committed (retries = 1)", async () => {
    const { store } = await makeStore()
    let verifyCalls = 0
    const runVerify = async () => {
      verifyCalls++
      return verifyCalls === 1 ? { exitCode: 1, output: "FAIL: missing x" } : { exitCode: 0, output: "ok" }
    }
    const fixPrompts: string[] = []
    const startWorker: StartWorker = async (args) => {
      if (args.phase.kind === "fix") fixPrompts.push(args.prompt)
      return { kind: "completed", text: "fixed" }
    }
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
      ],
      verify: { command: ["check"], timeoutMs: 1_000, retries: 1 },
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker, runVerify })
    const runId = await q.createRun(config, tasks(1))
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("committed")
    expect(verifyCalls).toBe(2)
    // Verify output fed as {{PRIOR}} into the fix phase
    expect(fixPrompts.at(-1)).toContain("FAIL: missing x")
  })

  test("verify fails all retries -> task failed", async () => {
    const { store } = await makeStore()
    const runVerify = async () => ({ exitCode: 1, output: "always fail" })
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
      ],
      verify: { command: ["check"], timeoutMs: 1_000, retries: 1 },
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker, runVerify })
    const runId = await q.createRun(config, tasks(1))
    await q.waitForRun(runId)
    const task = store.getOrchRun(runId)!.tasks[0]!
    expect(task.state).toBe("failed")
    expect(task.error).toContain("verify step failed")
  })

  test("verify = null skips the step even when runVerify is present", async () => {
    const { store } = await makeStore()
    let verifyCalls = 0
    const runVerify = async () => { verifyCalls++; return { exitCode: 0, output: "" } }
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker, runVerify })
    const runId = await q.createRun(makeConfig({ verify: null }), tasks(1))
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("committed")
    expect(verifyCalls).toBe(0)
  })
})

describe("OrchestrationQueue contextPrompt + scopePaths injection (F11)", () => {
  test("contextPrompt prefix injected into every worker prompt across all phases", async () => {
    const { store } = await makeStore()
    const prompts: string[] = []
    const startWorker: StartWorker = async (args) => {
      prompts.push(args.prompt)
      return { kind: "completed", text: "ok" }
    }
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "review", kind: "review", parallel: 1, promptTemplate: "REVIEW {{DIFF}}" },
      ],
      contextPrompt: "SHARED CONVENTIONS: always use TypeScript strict mode",
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(config, tasks(1))
    await q.waitForRun(runId)
    expect(prompts).toHaveLength(2)
    // Every prompt starts with the shared conventions block
    for (const p of prompts) {
      expect(p).toContain("SHARED CONVENTIONS")
    }
  })

  test("implement phase receives scope hint; non-implement phases do not", async () => {
    const { store } = await makeStore()
    const byPhase: Record<string, string> = {}
    const startWorker: StartWorker = async (args) => {
      byPhase[args.phase.name] = args.prompt
      return { kind: "completed", text: "ok" }
    }
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "review", kind: "review", parallel: 1, promptTemplate: "REVIEW {{DIFF}}" },
      ],
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(config, [
      { id: "t1", title: "task", prompt: "do task", scopePaths: ["src/auth", "src/session"] },
    ])
    await q.waitForRun(runId)
    // Implementer sees the scope hint
    expect(byPhase["implement"]).toContain("src/auth")
    expect(byPhase["implement"]).toContain("src/session")
    // Reviewer does NOT (they see the diff instead)
    expect(byPhase["review"]).not.toContain("src/auth")
  })

  test("contextPrompt = null and empty scopePaths add nothing to prompt", async () => {
    const { store } = await makeStore()
    const prompts: string[] = []
    const startWorker: StartWorker = async (args) => {
      prompts.push(args.prompt)
      return { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), tasks(1))
    await q.waitForRun(runId)
    // Prompt is exactly the template substitution — no extra prefix or scope line
    expect(prompts[0]).toBe("IMPL do 1")
  })
})
