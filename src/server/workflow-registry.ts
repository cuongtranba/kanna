import type { WorkflowRawFile, WorkflowRunDirInfo } from "./workflow-watch-io.adapter"
import { parseWorkflowRunFile, toRunSummary } from "../shared/workflow-types"
import type { WorkflowRun, WorkflowRunSummary } from "../shared/workflow-types"

export interface WorkflowRegistryDeps {
  read: (dir: string) => WorkflowRawFile[]
  watch: (dir: string, onChange: () => void) => () => void
  /**
   * List the live run dirs (`subagents/workflows/wf_*`) for the registered
   * workflows dir. Read lazily by `hasActiveRun`; absent in legacy callers
   * (treated as "no live runs", preserving prior behavior).
   */
  listRunDirs?: (workflowsDir: string) => WorkflowRunDirInfo[]
}
export interface WorkflowRegistry {
  register(chatId: string, workflowsDir: string): void
  unregister(chatId: string): void
  snapshot(chatId: string): WorkflowRunSummary[]
  getRun(chatId: string, runId: string): WorkflowRun | null
  /**
   * True when the chat hosts an in-flight run. A run is live when its live
   * transcript dir saw activity within `freshnessMs` AND it has no terminal
   * sidecar yet (absent, or status still "running"). The terminal sidecar is
   * Claude's authoritative death signal; the freshness window is the belt for
   * a hard crash that never wrote one. Used by the idle reaper / budget
   * enforcer so a live workflow's PTY host is never torn down mid-run.
   */
  hasActiveRun(chatId: string, freshnessMs: number, now: number): boolean
  subscribe(cb: (chatId: string) => void): () => void
}

interface Entry { dir: string; dispose: () => void; runs: Map<string, WorkflowRun> }

function byNewest(a: WorkflowRun, b: WorkflowRun): number {
  return (b.startTime ?? 0) - (a.startTime ?? 0)
}

export function createWorkflowRegistry(deps: WorkflowRegistryDeps): WorkflowRegistry {
  const entries = new Map<string, Entry>()
  const subs = new Set<(chatId: string) => void>()

  function refresh(chatId: string): void {
    const entry = entries.get(chatId)
    if (!entry) return
    const next = new Map<string, WorkflowRun>()
    for (const { raw } of deps.read(entry.dir)) {
      const run = parseWorkflowRunFile(raw)
      if (run) next.set(run.runId, run)
    }
    entry.runs = next
    for (const cb of subs) cb(chatId)
  }

  return {
    register(chatId, workflowsDir) {
      entries.get(chatId)?.dispose()
      const dispose = deps.watch(workflowsDir, () => refresh(chatId))
      entries.set(chatId, { dir: workflowsDir, dispose, runs: new Map() })
      refresh(chatId)
    },
    unregister(chatId) {
      const entry = entries.get(chatId)
      if (!entry) return
      entry.dispose()
      entries.delete(chatId)
    },
    snapshot(chatId) {
      const entry = entries.get(chatId)
      if (!entry) return []
      return [...entry.runs.values()].sort(byNewest).map(toRunSummary)
    },
    getRun(chatId, runId) {
      return entries.get(chatId)?.runs.get(runId) ?? null
    },
    hasActiveRun(chatId, freshnessMs, now) {
      const entry = entries.get(chatId)
      if (!entry || !deps.listRunDirs) return false
      const floor = now - freshnessMs
      for (const { runId, newestMtimeMs } of deps.listRunDirs(entry.dir)) {
        if (newestMtimeMs < floor) continue // stale: no activity within the window
        const sidecar = entry.runs.get(runId)
        // No terminal sidecar yet (still mid-run), or it explicitly says running.
        if (!sidecar || sidecar.status === "running") return true
      }
      return false
    },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb) },
  }
}
