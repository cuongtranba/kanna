// src/server/event-store-orchestration.test.ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import type { OrchRunConfig } from "../shared/orchestration-types"
import { DEFAULT_ORCH_PHASES } from "../shared/orchestration-types"

function makeConfig(): OrchRunConfig {
  return {
    title: "test run",
    repoRoot: "/tmp/fake-repo",
    baseBranch: "main",
    maxParallelTasks: 2,
    worktreePoolSize: 2,
    maxAttempts: 3,
    phases: DEFAULT_ORCH_PHASES,
    gates: [],
    contextPrompt: null,
    verify: null,
    init: null,
  }
}

async function makeStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-orch-store-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir }
}

describe("EventStore orchestration events", () => {
  test("orch_run_created folds tasks as queued", async () => {
    const { store } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(),
      tasks: [
        { id: "t1", title: "task one", prompt: "do one" },
        { id: "t2", title: "task two", prompt: "do two" },
      ],
    })
    const run = store.getOrchRun("r1")
    expect(run).not.toBeNull()
    expect(run!.status).toBe("running")
    expect(run!.tasks.map((t) => t.state)).toEqual(["queued", "queued"])
    expect(run!.tasks.map((t) => t.ownerWorkerId)).toEqual([null, null])
  }, 30_000)

  test("claim -> phase -> committed folds state, owner, attempts", async () => {
    const { store } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(), tasks: [{ id: "t1", title: "t", prompt: "p" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-1", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    let task = store.getOrchRun("r1")!.tasks[0]!
    expect(task.state).toBe("claimed")
    expect(task.ownerWorkerId).toBe("w-1")
    expect(task.attempts).toBe(1)

    await store.appendOrchestrationEvent({
      v: 3, type: "orch_phase_started", timestamp: 3, runId: "r1", taskId: "t1",
      phaseIndex: 0, phaseName: "implement", workerIds: ["w-1"],
    })
    task = store.getOrchRun("r1")!.tasks[0]!
    expect(task.state).toBe("running")
    expect(task.phaseIndex).toBe(0)

    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_committed", timestamp: 4, runId: "r1", taskId: "t1",
      commitSha: "abc123",
    })
    task = store.getOrchRun("r1")!.tasks[0]!
    expect(task.state).toBe("committed")
    expect(task.ownerWorkerId).toBeNull()
    expect(task.commitSha).toBe("abc123")
  }, 30_000)

  test("orch_task_requeued clears owner, keeps worktree + attempts", async () => {
    const { store } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(), tasks: [{ id: "t1", title: "t", prompt: "p" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-1", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_requeued", timestamp: 3, runId: "r1", taskId: "t1",
      reason: "restart_recovery", detail: null,
    })
    const task = store.getOrchRun("r1")!.tasks[0]!
    expect(task.state).toBe("queued")
    expect(task.ownerWorkerId).toBeNull()
    expect(task.worktreePath).toBe("/wt/t1")
    expect(task.attempts).toBe(1)
  }, 30_000)

  test("events survive restart via log replay (AG2)", async () => {
    const { store, dir } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(), tasks: [{ id: "t1", title: "t", prompt: "p" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-1", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    await store.flush()

    const reopened = new EventStore(dir)
    await reopened.initialize()
    const run = reopened.getOrchRun("r1")
    expect(run).not.toBeNull()
    expect(run!.tasks[0]!.state).toBe("claimed")
    expect(run!.tasks[0]!.ownerWorkerId).toBe("w-1")
  }, 30_000)

  test("getOrchRunEvents retains full timeline and rebuilds on replay (F8)", async () => {
    const { store, dir } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(), tasks: [{ id: "t1", title: "t", prompt: "p" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-1", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_requeued", timestamp: 3, runId: "r1", taskId: "t1",
      reason: "handed_back", detail: "hit unknown",
    })
    expect(store.getOrchRunEvents("r1").map((e) => e.type)).toEqual([
      "orch_run_created", "orch_task_claimed", "orch_task_requeued",
    ])
    await store.flush()
    const reopened = new EventStore(dir)
    await reopened.initialize()
    expect(reopened.getOrchRunEvents("r1").map((e) => e.type)).toEqual([
      "orch_run_created", "orch_task_claimed", "orch_task_requeued",
    ])
  }, 30_000)

  test("nonTerminalOrchTasks yields claimed/running, skips terminal", async () => {
    const { store } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(),
      tasks: [
        { id: "t1", title: "a", prompt: "a" },
        { id: "t2", title: "b", prompt: "b" },
        { id: "t3", title: "c", prompt: "c" },
      ],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-1", worktreePath: "/wt/t1", branch: "b1", baseSha: "base0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 3, runId: "r1", taskId: "t2",
      workerId: "w-2", worktreePath: "/wt/t2", branch: "b2", baseSha: "base1",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_phase_started", timestamp: 4, runId: "r1", taskId: "t2",
      phaseIndex: 0, phaseName: "implement", workerIds: ["w-2"],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_committed", timestamp: 5, runId: "r1", taskId: "t2",
      commitSha: null,
    })
    const pending = [...store.nonTerminalOrchTasks()]
    expect(pending.map((p) => p.taskId)).toEqual(["t1"])
    expect(pending[0]!.runId).toBe("r1")
  }, 30_000)
})
