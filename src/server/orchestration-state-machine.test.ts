import { describe, expect, test } from "bun:test"
import {
  isTaskEventType,
  isTerminalTaskState,
  nextRunStatus,
  nextTaskState,
  projectStage,
} from "./orchestration-state-machine"
import { DEFAULT_ORCH_PHASES } from "../shared/orchestration-types"

describe("nextTaskState — legal transitions", () => {
  test("queued → claimed on claim", () => {
    expect(nextTaskState("queued", "orch_task_claimed")).toEqual({ ok: true, next: "claimed" })
  })
  test("queued → failed on terminal-fail without claim", () => {
    expect(nextTaskState("queued", "orch_task_failed")).toEqual({ ok: true, next: "failed" })
  })
  test("claimed → running on phase start", () => {
    expect(nextTaskState("claimed", "orch_phase_started")).toEqual({ ok: true, next: "running" })
  })
  test("running self-transitions on phase/verify ticks", () => {
    expect(nextTaskState("running", "orch_phase_completed")).toEqual({ ok: true, next: "running" })
    expect(nextTaskState("running", "orch_verify_started")).toEqual({ ok: true, next: "running" })
    expect(nextTaskState("running", "orch_verify_completed")).toEqual({ ok: true, next: "running" })
  })
  test("running → committed / failed / queued(requeue) / gated", () => {
    expect(nextTaskState("running", "orch_task_committed")).toEqual({ ok: true, next: "committed" })
    expect(nextTaskState("running", "orch_task_failed")).toEqual({ ok: true, next: "failed" })
    expect(nextTaskState("running", "orch_task_requeued")).toEqual({ ok: true, next: "queued" })
    expect(nextTaskState("running", "orch_gate_opened")).toEqual({ ok: true, next: "gated" })
  })
  test("gated → running on resolve (approve path)", () => {
    expect(nextTaskState("gated", "orch_gate_resolved")).toEqual({ ok: true, next: "running" })
  })
})

describe("nextTaskState — illegal transitions", () => {
  test("cannot claim a running task", () => {
    expect(nextTaskState("running", "orch_task_claimed")).toEqual({ ok: false, illegal: true })
  })
  test("cannot commit a queued task", () => {
    expect(nextTaskState("queued", "orch_task_committed")).toEqual({ ok: false, illegal: true })
  })
  test("terminal states are sinks", () => {
    expect(nextTaskState("committed", "orch_task_failed")).toEqual({ ok: false, illegal: true })
    expect(nextTaskState("failed", "orch_task_committed")).toEqual({ ok: false, illegal: true })
  })
})

describe("nextRunStatus", () => {
  test("running → completed / cancelled", () => {
    expect(nextRunStatus("running", "orch_run_completed")).toEqual({ ok: true, next: "completed" })
    expect(nextRunStatus("running", "orch_run_cancelled")).toEqual({ ok: true, next: "cancelled" })
  })
  test("terminal run states are sinks", () => {
    expect(nextRunStatus("completed", "orch_run_cancelled")).toEqual({ ok: false, illegal: true })
    expect(nextRunStatus("cancelled", "orch_run_completed")).toEqual({ ok: false, illegal: true })
  })
})

describe("isTaskEventType / isTerminalTaskState", () => {
  test("classifies task vs run events", () => {
    expect(isTaskEventType("orch_task_claimed")).toBe(true)
    expect(isTaskEventType("orch_run_completed")).toBe(false)
    expect(isTaskEventType("orch_run_created")).toBe(false)
  })
  test("terminal task states", () => {
    expect(isTerminalTaskState("committed")).toBe(true)
    expect(isTerminalTaskState("failed")).toBe(true)
    expect(isTerminalTaskState("running")).toBe(false)
  })
})

describe("projectStage", () => {
  const kinds = DEFAULT_ORCH_PHASES.map((p) => p.kind) // [implement, review, fix]

  test("terminal + queued mappings", () => {
    expect(projectStage("committed", 2, kinds, false)).toBe("committed")
    expect(projectStage("failed", 1, kinds, false)).toBe("failed")
    expect(projectStage("queued", -1, kinds, false)).toBe("queued")
    expect(projectStage("claimed", -1, kinds, false)).toBe("queued")
  })

  test("running maps to the phase kind at phaseIndex", () => {
    expect(projectStage("running", 0, kinds, false)).toBe("implement")
    expect(projectStage("running", 1, kinds, false)).toBe("review")
    expect(projectStage("running", 2, kinds, false)).toBe("fix")
  })

  test("verifying overrides the phase kind", () => {
    expect(projectStage("running", 2, kinds, true)).toBe("verify")
  })

  test("out-of-range phaseIndex falls back to queued", () => {
    expect(projectStage("running", 9, kinds, false)).toBe("queued")
  })
})
