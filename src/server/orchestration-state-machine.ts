/**
 * Orchestration finite state machine (pure).
 *
 * Makes the run/task lifecycle explicit and machine-checkable: a transition
 * table encodes exactly which OrchestrationEvent is legal from which state, so
 * the event-store fold can GUARD against illegal transitions (log + drop rather
 * than silently corrupt the read model) and the UI can render a single derived
 * "stage" off the same source of truth. See the plan's "Observable state
 * machine" section.
 *
 * NO IO, no `any`. Consumed by `event-store.ts` (fold guard) and the DTO
 * normalizers in `orchestration-input.ts` (stage projection).
 */

import type { OrchestrationEvent } from "./events"
import type { OrchPhaseKind, OrchRunStatus, OrchStage, OrchTaskState } from "../shared/orchestration-types"

/** The event `type` discriminant — the FSM's alphabet. */
export type OrchEventType = OrchestrationEvent["type"]

/** Task-level events that participate in the task FSM (carry a `taskId`). */
type OrchTaskEventType = Extract<
  OrchEventType,
  | "orch_task_claimed"
  | "orch_phase_started"
  | "orch_phase_completed"
  | "orch_gate_opened"
  | "orch_gate_resolved"
  | "orch_verify_started"
  | "orch_verify_completed"
  | "orch_task_committed"
  | "orch_task_failed"
  | "orch_task_requeued"
>

/** Run-level lifecycle events. */
type OrchRunEventType = Extract<OrchEventType, "orch_run_completed" | "orch_run_cancelled">

export type TransitionResult<S> = { ok: true; next: S } | { ok: false; illegal: true }

/**
 * Task transition table. `(state, eventType) -> next state`. A missing entry is
 * an ILLEGAL transition. Events that observe but do not change state (phase
 * completion, verify ticks) map the state to itself. `gate_resolved` maps to
 * `running` (the approve path); a reject keeps the task `gated` and is handled
 * by the fold's decision branch — the FSM only asserts legality here.
 */
const TASK_TRANSITIONS: Readonly<
  Record<OrchTaskState, Partial<Record<OrchTaskEventType, OrchTaskState>>>
> = {
  queued: {
    orch_task_claimed: "claimed",
    // Terminal-fail without a claim: max attempts exhausted or the worktree
    // pool is unusable (schedule() fails queued tasks directly).
    orch_task_failed: "failed",
  },
  claimed: {
    orch_phase_started: "running",
    orch_task_failed: "failed",
    orch_task_requeued: "queued",
  },
  running: {
    orch_phase_started: "running",
    orch_phase_completed: "running",
    orch_gate_opened: "gated",
    orch_verify_started: "running",
    orch_verify_completed: "running",
    orch_task_committed: "committed",
    orch_task_failed: "failed",
    orch_task_requeued: "queued",
  },
  gated: {
    orch_gate_resolved: "running",
    orch_task_failed: "failed",
  },
  // Terminal sinks — no outgoing transitions.
  committed: {},
  failed: {},
}

const RUN_TRANSITIONS: Readonly<
  Record<OrchRunStatus, Partial<Record<OrchRunEventType, OrchRunStatus>>>
> = {
  running: {
    orch_run_completed: "completed",
    orch_run_cancelled: "cancelled",
  },
  // Terminal sinks.
  completed: {},
  cancelled: {},
}

const TASK_EVENT_TYPES = new Set<OrchEventType>([
  "orch_task_claimed",
  "orch_phase_started",
  "orch_phase_completed",
  "orch_gate_opened",
  "orch_gate_resolved",
  "orch_verify_started",
  "orch_verify_completed",
  "orch_task_committed",
  "orch_task_failed",
  "orch_task_requeued",
])

export function isTaskEventType(type: OrchEventType): type is OrchTaskEventType {
  return TASK_EVENT_TYPES.has(type)
}

/** Legal-transition guard for a task. */
export function nextTaskState(
  current: OrchTaskState,
  eventType: OrchTaskEventType,
): TransitionResult<OrchTaskState> {
  const next = TASK_TRANSITIONS[current][eventType]
  if (next === undefined) return { ok: false, illegal: true }
  return { ok: true, next }
}

/** Legal-transition guard for a run. */
export function nextRunStatus(
  current: OrchRunStatus,
  eventType: OrchRunEventType,
): TransitionResult<OrchRunStatus> {
  const next = RUN_TRANSITIONS[current][eventType]
  if (next === undefined) return { ok: false, illegal: true }
  return { ok: true, next }
}

/** True once a task can never transition again. */
export function isTerminalTaskState(state: OrchTaskState): boolean {
  return state === "committed" || state === "failed"
}

/**
 * Project a task's FSM state onto the single linear stage the panel renders.
 * `phaseIndex` indexes `phaseKinds` (the run's configured pipeline); `verifying`
 * is the folded flag that a verify step is currently in flight.
 */
export function projectStage(
  state: OrchTaskState,
  phaseIndex: number,
  phaseKinds: readonly OrchPhaseKind[],
  verifying: boolean,
): OrchStage {
  if (state === "committed") return "committed"
  if (state === "failed") return "failed"
  if (state === "queued" || state === "claimed") return "queued"
  // running | gated
  if (verifying) return "verify"
  const kind = phaseKinds[phaseIndex]
  if (kind === "implement") return "implement"
  if (kind === "review") return "review"
  if (kind === "fix") return "fix"
  return "queued"
}
