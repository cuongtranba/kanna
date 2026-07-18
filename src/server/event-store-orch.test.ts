import { describe, expect, it } from "bun:test"
import type { OrchRunConfig, OrchTaskSpec } from "../shared/orchestration-types"
import type { OrchestrationEvent, OrchRunRecord } from "./events"
import {
  applyOrchEvent,
  gatedOrchTasks,
  getAllOrchRunSnapshots,
  getOrchLastPhaseOutput,
  getOrchRunEvents,
  getOrchRunSnapshot,
  getOrchTaskSpec,
  nonTerminalOrchTasks,
  toOrchRunSnapshot,
} from "./event-store-orch"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T = 1_000_000

const MINIMAL_CONFIG: OrchRunConfig = {
  title: "test run",
  repoRoot: "/repo",
  baseBranch: "main",
  maxParallelTasks: 2,
  worktreePoolSize: 2,
  maxAttempts: 3,
  contextPrompt: null,
  init: null,
  workerSubagentId: "sub-1",
  originChatId: "chat-1",
  phases: [{ name: "implement", kind: "implement", parallel: 1, promptTemplate: "{{TASK}}" }],
  gates: [],
  verify: null,
}

const TASKS: OrchTaskSpec[] = [
  { id: "t1", title: "Task 1", prompt: "do task 1", scopePaths: ["src/"] },
  { id: "t2", title: "Task 2", prompt: "do task 2", scopePaths: [] },
]

function makeCreatedEvent(runId = "run-1"): Extract<OrchestrationEvent, { type: "orch_run_created" }> {
  return { v: 3, type: "orch_run_created", timestamp: T, runId, config: MINIMAL_CONFIG, tasks: TASKS }
}

function makeMap(): Map<string, OrchRunRecord> {
  return new Map()
}

function seedRun(map: Map<string, OrchRunRecord>, runId = "run-1"): void {
  applyOrchEvent(map, makeCreatedEvent(runId))
}

// ---------------------------------------------------------------------------
// applyOrchEvent — run lifecycle
// ---------------------------------------------------------------------------

describe("applyOrchEvent", () => {
  it("creates a run on orch_run_created", () => {
    const m = makeMap()
    seedRun(m)
    expect(m.size).toBe(1)
    const run = m.get("run-1")!
    expect(run.status).toBe("running")
    expect(run.tasksById.size).toBe(2)
    expect(run.taskOrder).toEqual(["t1", "t2"])
  })

  it("initialises tasks in queued state with correct fields", () => {
    const m = makeMap()
    seedRun(m)
    const t1 = m.get("run-1")!.tasksById.get("t1")!
    expect(t1.state).toBe("queued")
    expect(t1.prompt).toBe("do task 1")
    expect(t1.scopePaths).toEqual(["src/"])
    expect(t1.attempts).toBe(0)
    expect(t1.ownerWorkerId).toBeNull()
  })

  it("records the creation event in the event log", () => {
    const m = makeMap()
    seedRun(m)
    expect(m.get("run-1")!.eventLog).toHaveLength(1)
    expect(m.get("run-1")!.eventLog[0]?.type).toBe("orch_run_created")
  })

  it("ignores events for unknown runId", () => {
    const m = makeMap()
    applyOrchEvent(m, {
      v: 3, type: "orch_run_completed", timestamp: T + 1, runId: "ghost",
    })
    expect(m.size).toBe(0)
  })

  it("transitions run to completed on orch_run_completed", () => {
    const m = makeMap()
    seedRun(m)
    applyOrchEvent(m, { v: 3, type: "orch_run_completed", timestamp: T + 10, runId: "run-1" })
    expect(m.get("run-1")!.status).toBe("completed")
  })

  it("transitions run to cancelled on orch_run_cancelled", () => {
    const m = makeMap()
    seedRun(m)
    applyOrchEvent(m, { v: 3, type: "orch_run_cancelled", timestamp: T + 10, runId: "run-1" })
    expect(m.get("run-1")!.status).toBe("cancelled")
  })

  it("drops illegal run transition (completed → cancelled) without corrupting state", () => {
    const m = makeMap()
    seedRun(m)
    applyOrchEvent(m, { v: 3, type: "orch_run_completed", timestamp: T + 5, runId: "run-1" })
    applyOrchEvent(m, { v: 3, type: "orch_run_cancelled", timestamp: T + 6, runId: "run-1" })
    // status stays completed — illegal transition was dropped
    expect(m.get("run-1")!.status).toBe("completed")
  })

  it("is a no-op for observability-only events (scope_overlap, config_warning)", () => {
    const m = makeMap()
    seedRun(m)
    const before = m.get("run-1")!.status
    applyOrchEvent(m, {
      v: 3, type: "orch_scope_overlap_flagged", timestamp: T + 1,
      runId: "run-1", taskIds: ["t1"], paths: ["src/"],
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_config_warning", timestamp: T + 2,
      runId: "run-1", message: "warning text",
    })
    expect(m.get("run-1")!.status).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// applyOrchEvent — task lifecycle
// ---------------------------------------------------------------------------

describe("applyOrchEvent – task lifecycle", () => {
  function claimedMap(): Map<string, OrchRunRecord> {
    const m = makeMap()
    seedRun(m)
    applyOrchEvent(m, {
      v: 3, type: "orch_task_claimed", timestamp: T + 1,
      runId: "run-1", taskId: "t1",
      workerId: "w1", baseSha: "abc", worktreePath: "/wt/0", branch: "orch/run-1/wt-0",
    })
    return m
  }

  /** Extends claimedMap — task is in `running` state after phase_started. */
  function runningMap(): Map<string, OrchRunRecord> {
    const m = claimedMap()
    applyOrchEvent(m, {
      v: 3, type: "orch_phase_started", timestamp: T + 2,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", workerIds: ["w1"],
    })
    return m
  }

  it("moves task to claimed state with owner and increments attempts", () => {
    const m = claimedMap()
    const t1 = m.get("run-1")!.tasksById.get("t1")!
    expect(t1.state).toBe("claimed")
    expect(t1.ownerWorkerId).toBe("w1")
    expect(t1.attempts).toBe(1)
    expect(t1.worktreePath).toBe("/wt/0")
  })

  it("moves task to running on orch_phase_started", () => {
    const m = claimedMap()
    applyOrchEvent(m, {
      v: 3, type: "orch_phase_started", timestamp: T + 2,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", workerIds: ["w1"],
    })
    expect(m.get("run-1")!.tasksById.get("t1")!.state).toBe("running")
  })

  it("stores last phase output on orch_phase_completed", () => {
    const m = claimedMap()
    applyOrchEvent(m, {
      v: 3, type: "orch_phase_started", timestamp: T + 2,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", workerIds: ["w1"],
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_phase_completed", timestamp: T + 3,
      runId: "run-1", taskId: "t1", phaseIndex: 0,
      output: "phase output text", outputChars: 17, workers: [],
    })
    expect(m.get("run-1")!.tasksById.get("t1")!.lastPhaseOutput).toBe("phase output text")
  })

  it("moves task to gated on orch_gate_opened (must be running first)", () => {
    const m = runningMap() // claimed → running via phase_started
    applyOrchEvent(m, {
      v: 3, type: "orch_gate_opened", timestamp: T + 3,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", gateKind: "hard",
    })
    expect(m.get("run-1")!.tasksById.get("t1")!.state).toBe("gated")
  })

  it("moves task back to running on approved gate resolution", () => {
    const m = runningMap()
    applyOrchEvent(m, {
      v: 3, type: "orch_gate_opened", timestamp: T + 3,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", gateKind: "hard",
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_gate_resolved", timestamp: T + 4,
      runId: "run-1", taskId: "t1", phaseIndex: 0, decision: "approve",
    })
    expect(m.get("run-1")!.tasksById.get("t1")!.state).toBe("running")
  })

  it("keeps task gated on rejected gate resolution", () => {
    const m = runningMap()
    applyOrchEvent(m, {
      v: 3, type: "orch_gate_opened", timestamp: T + 3,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", gateKind: "hard",
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_gate_resolved", timestamp: T + 4,
      runId: "run-1", taskId: "t1", phaseIndex: 0, decision: "reject",
    })
    expect(m.get("run-1")!.tasksById.get("t1")!.state).toBe("gated")
  })

  it("moves task to committed and clears owner (must be running first)", () => {
    const m = runningMap()
    applyOrchEvent(m, {
      v: 3, type: "orch_task_committed", timestamp: T + 3,
      runId: "run-1", taskId: "t1", commitSha: "sha123",
    })
    const t1 = m.get("run-1")!.tasksById.get("t1")!
    expect(t1.state).toBe("committed")
    expect(t1.ownerWorkerId).toBeNull()
    expect(t1.commitSha).toBe("sha123")
  })

  it("moves task to failed and clears owner", () => {
    const m = claimedMap()
    applyOrchEvent(m, {
      v: 3, type: "orch_task_failed", timestamp: T + 2,
      runId: "run-1", taskId: "t1", error: "boom",
    })
    const t1 = m.get("run-1")!.tasksById.get("t1")!
    expect(t1.state).toBe("failed")
    expect(t1.ownerWorkerId).toBeNull()
    expect(t1.error).toBe("boom")
  })

  it("requeues a task back to queued and clears owner", () => {
    const m = claimedMap()
    applyOrchEvent(m, {
      v: 3, type: "orch_task_requeued", timestamp: T + 2,
      runId: "run-1", taskId: "t1", reason: "handed_back", detail: null,
    })
    const t1 = m.get("run-1")!.tasksById.get("t1")!
    expect(t1.state).toBe("queued")
    expect(t1.ownerWorkerId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Snapshot projection
// ---------------------------------------------------------------------------

describe("toOrchRunSnapshot", () => {
  it("projects a run record into the correct snapshot shape", () => {
    const m = makeMap()
    seedRun(m)
    const run = m.get("run-1")!
    const snap = toOrchRunSnapshot(run)
    expect(snap.runId).toBe("run-1")
    expect(snap.status).toBe("running")
    expect(snap.tasks).toHaveLength(2)
    expect(snap.tasks[0]?.taskId).toBe("t1")
    expect(snap.tasks[1]?.taskId).toBe("t2")
  })

  it("snapshot tasks do NOT expose prompt or scopePaths (those are spec-only)", () => {
    const m = makeMap()
    seedRun(m)
    const snap = toOrchRunSnapshot(m.get("run-1")!)
    const t = snap.tasks[0] as unknown as Record<string, unknown>
    expect("prompt" in t).toBe(false)
    expect("scopePaths" in t).toBe(false)
  })
})

describe("getOrchRunSnapshot", () => {
  it("returns null for an unknown runId", () => {
    expect(getOrchRunSnapshot(makeMap(), "unknown")).toBeNull()
  })

  it("returns the snapshot for a known runId", () => {
    const m = makeMap()
    seedRun(m)
    const snap = getOrchRunSnapshot(m, "run-1")
    expect(snap?.runId).toBe("run-1")
  })
})

describe("getAllOrchRunSnapshots", () => {
  it("returns all runs", () => {
    const m = makeMap()
    seedRun(m, "run-1")
    seedRun(m, "run-2")
    const snaps = getAllOrchRunSnapshots(m)
    expect(snaps).toHaveLength(2)
    expect(snaps.map((s) => s.runId).sort()).toEqual(["run-1", "run-2"])
  })
})

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

describe("getOrchTaskSpec", () => {
  it("returns prompt and scopePaths for a known task", () => {
    const m = makeMap()
    seedRun(m)
    const spec = getOrchTaskSpec(m, "run-1", "t1")
    expect(spec?.prompt).toBe("do task 1")
    expect(spec?.scopePaths).toEqual(["src/"])
  })

  it("returns null for an unknown task", () => {
    const m = makeMap()
    seedRun(m)
    expect(getOrchTaskSpec(m, "run-1", "ghost")).toBeNull()
  })
})

describe("getOrchLastPhaseOutput", () => {
  it("returns null before any phase completes", () => {
    const m = makeMap()
    seedRun(m)
    expect(getOrchLastPhaseOutput(m, "run-1", "t1")).toBeNull()
  })

  it("returns the output after orch_phase_completed", () => {
    const m = makeMap()
    seedRun(m)
    applyOrchEvent(m, {
      v: 3, type: "orch_task_claimed", timestamp: T + 1,
      runId: "run-1", taskId: "t1",
      workerId: "w1", baseSha: "abc", worktreePath: "/wt/0", branch: "orch/run-1/wt-0",
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_phase_started", timestamp: T + 2,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", workerIds: ["w1"],
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_phase_completed", timestamp: T + 3,
      runId: "run-1", taskId: "t1", phaseIndex: 0,
      output: "some output", outputChars: 11, workers: [],
    })
    expect(getOrchLastPhaseOutput(m, "run-1", "t1")).toBe("some output")
  })
})

describe("getOrchRunEvents", () => {
  it("returns a copy of the event log", () => {
    const m = makeMap()
    seedRun(m)
    const events = getOrchRunEvents(m, "run-1")
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("orch_run_created")
    // mutating the returned array must not affect the internal log
    events.push({ v: 3, type: "orch_run_completed", timestamp: T + 999, runId: "run-1" })
    expect(m.get("run-1")!.eventLog).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Recovery iterators
// ---------------------------------------------------------------------------

describe("nonTerminalOrchTasks", () => {
  it("yields claimed and running tasks from active runs", () => {
    const m = makeMap()
    seedRun(m)
    applyOrchEvent(m, {
      v: 3, type: "orch_task_claimed", timestamp: T + 1,
      runId: "run-1", taskId: "t1",
      workerId: "w1", baseSha: "abc", worktreePath: "/wt/0", branch: "orch/run-1/wt-0",
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_phase_started", timestamp: T + 2,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", workerIds: ["w1"],
    })
    const results = [...nonTerminalOrchTasks(m)]
    expect(results).toHaveLength(1)
    expect(results[0]?.taskId).toBe("t1")
    expect(results[0]?.state).toBe("running")
  })

  it("excludes gated tasks (they are re-armed, not requeued)", () => {
    const m = makeMap()
    seedRun(m)
    // claimed → running → gated (gate can only open from running state)
    applyOrchEvent(m, {
      v: 3, type: "orch_task_claimed", timestamp: T + 1,
      runId: "run-1", taskId: "t1",
      workerId: "w1", baseSha: "abc", worktreePath: "/wt/0", branch: "orch/run-1/wt-0",
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_phase_started", timestamp: T + 2,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", workerIds: ["w1"],
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_gate_opened", timestamp: T + 3,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", gateKind: "hard",
    })
    const results = [...nonTerminalOrchTasks(m)]
    expect(results).toHaveLength(0)
  })

  it("excludes tasks from completed runs", () => {
    const m = makeMap()
    seedRun(m)
    applyOrchEvent(m, {
      v: 3, type: "orch_task_claimed", timestamp: T + 1,
      runId: "run-1", taskId: "t1",
      workerId: "w1", baseSha: "abc", worktreePath: "/wt/0", branch: "orch/run-1/wt-0",
    })
    applyOrchEvent(m, { v: 3, type: "orch_run_completed", timestamp: T + 2, runId: "run-1" })
    expect([...nonTerminalOrchTasks(m)]).toHaveLength(0)
  })
})

describe("gatedOrchTasks", () => {
  it("yields gated tasks from active runs", () => {
    const m = makeMap()
    seedRun(m)
    // Must reach running before gate can open
    applyOrchEvent(m, {
      v: 3, type: "orch_task_claimed", timestamp: T + 1,
      runId: "run-1", taskId: "t1",
      workerId: "w1", baseSha: "abc", worktreePath: "/wt/0", branch: "orch/run-1/wt-0",
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_phase_started", timestamp: T + 2,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", workerIds: ["w1"],
    })
    applyOrchEvent(m, {
      v: 3, type: "orch_gate_opened", timestamp: T + 3,
      runId: "run-1", taskId: "t1", phaseIndex: 0, phaseName: "implement", gateKind: "hard",
    })
    const results = [...gatedOrchTasks(m)]
    expect(results).toHaveLength(1)
    expect(results[0]?.taskId).toBe("t1")
    expect(results[0]?.phaseIndex).toBe(0)
  })

  it("yields nothing when no tasks are gated", () => {
    const m = makeMap()
    seedRun(m)
    expect([...gatedOrchTasks(m)]).toHaveLength(0)
  })
})
