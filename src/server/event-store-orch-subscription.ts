/**
 * Orchestration event write-path + subscription management extracted from
 * event-store.ts.
 *
 * Wraps the pure read functions from event-store-orch.ts and adds:
 * - `appendOrchestrationEvent` — sync apply + async disk enqueue
 * - `subscribeOrchRuns` / `notifyOrchRunsChanged` — observer pattern
 *
 * All functions use injected deps so they carry no direct IO. EventStore
 * is the sole owner of the underlying maps and write-chain.
 *
 * Must NOT import from event-store.ts (no circular deps).
 */
import { LOG_PREFIX } from "../shared/branding"
import { log } from "../shared/log"
import type { OrchRunSnapshot } from "../shared/orchestration-types"
import type { OrchestrationEvent, OrchRunRecord } from "./events"
import {
  gatedOrchTasks as gatedOrchTasksFn,
  getAllOrchRunSnapshots,
  getOrchLastPhaseOutput as getOrchLastPhaseOutputFn,
  getOrchRunEvents as getOrchRunEventsFn,
  getOrchRunSnapshot,
  getOrchTaskSpec as getOrchTaskSpecFn,
  nonTerminalOrchTasks as nonTerminalOrchTasksFn,
} from "./event-store-orch"

// ─── Deps interface ────────────────────────────────────────────────────────

export interface OrchSubscriptionDeps {
  readonly orchRunsById: Map<string, OrchRunRecord>
  readonly orchLogPath: string
  readonly orchRunsSubscribers: Set<() => void>
  applyEvent: (event: OrchestrationEvent) => void
  enqueueDiskAppend: (filePath: string, payload: string) => void
}

// ─── Subscription state ───────────────────────────────────────────────────

/** Create the mutable subscription state held by EventStore. */
export function createOrchSubscriptionState(): { orchRunsSubscribers: Set<() => void> } {
  return { orchRunsSubscribers: new Set() }
}

// ─── Write path ────────────────────────────────────────────────────────────

/**
 * Apply synchronously, then enqueue the disk append — the sync apply is what
 * makes an orchestration claim atomic within one event-loop turn (same
 * pattern as appendSubagentEvent).
 */
export function appendOrchestrationEvent(
  deps: OrchSubscriptionDeps,
  event: OrchestrationEvent,
): Promise<void> {
  deps.applyEvent(event)
  deps.enqueueDiskAppend(deps.orchLogPath, `${JSON.stringify(event)}\n`)
  notifyOrchRunsChanged(deps)
  return Promise.resolve()
}

/**
 * Observe orchestration read-model changes. The callback fires after each
 * live orch event is applied (not during boot replay — no subscribers yet).
 * Returns an unsubscribe fn.
 */
export function subscribeOrchRuns(deps: OrchSubscriptionDeps, cb: () => void): () => void {
  deps.orchRunsSubscribers.add(cb)
  return () => { deps.orchRunsSubscribers.delete(cb) }
}

function notifyOrchRunsChanged(deps: OrchSubscriptionDeps): void {
  for (const cb of deps.orchRunsSubscribers) {
    try { cb() } catch (err) { log.warn(`${LOG_PREFIX} orch-runs subscriber threw`, { err }) }
  }
}

// ─── Read-model thin wrappers ──────────────────────────────────────────────

export function getOrchRun(
  orchRunsById: Map<string, OrchRunRecord>,
  runId: string,
): OrchRunSnapshot | null {
  return getOrchRunSnapshot(orchRunsById, runId)
}

export function getOrchRuns(orchRunsById: Map<string, OrchRunRecord>): OrchRunSnapshot[] {
  return getAllOrchRunSnapshots(orchRunsById)
}

export function nonTerminalOrchTasks(
  orchRunsById: Map<string, OrchRunRecord>,
): Iterable<{ runId: string; taskId: string; state: "claimed" | "running" }> {
  return nonTerminalOrchTasksFn(orchRunsById)
}

export function gatedOrchTasks(
  orchRunsById: Map<string, OrchRunRecord>,
): Iterable<{ runId: string; taskId: string; phaseIndex: number }> {
  return gatedOrchTasksFn(orchRunsById)
}

export function getOrchTaskSpec(
  orchRunsById: Map<string, OrchRunRecord>,
  runId: string,
  taskId: string,
): { prompt: string; scopePaths: string[] } | null {
  return getOrchTaskSpecFn(orchRunsById, runId, taskId)
}

export function getOrchLastPhaseOutput(
  orchRunsById: Map<string, OrchRunRecord>,
  runId: string,
  taskId: string,
): string | null {
  return getOrchLastPhaseOutputFn(orchRunsById, runId, taskId)
}

export function getOrchRunEvents(
  orchRunsById: Map<string, OrchRunRecord>,
  runId: string,
): OrchestrationEvent[] {
  return getOrchRunEventsFn(orchRunsById, runId)
}
