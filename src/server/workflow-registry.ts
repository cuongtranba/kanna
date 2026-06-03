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
  /**
   * Watch the live run-dir root so a newly-launched run (no sidecar yet) pushes
   * a snapshot promptly. Absent in legacy callers (no live-run push, only
   * sidecar-change pushes — preserves prior behavior).
   */
  watchRunDirs?: (workflowsDir: string, onChange: () => void) => () => void
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

// A live run dir with no terminal sidecar and activity within this window is
// surfaced as a synthetic `running` row. Claude flushes the wf_<runId>.json
// sidecar only at/near termination, so without this the panel would only ever
// show terminal runs and never an in-flight one. Stale dirs past the window
// (likely a crash that never wrote a sidecar) are dropped rather than shown
// as forever-running.
const SNAPSHOT_LIVE_WINDOW_MS = 10 * 60 * 1000

function byNewest(a: WorkflowRun, b: WorkflowRun): number {
  return (b.startTime ?? 0) - (a.startTime ?? 0)
}

function synthRunningRun(runId: string, startTime: number): WorkflowRun {
  return { runId, status: "running", startTime, phases: [], agents: [] }
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
      const disposeSidecar = deps.watch(workflowsDir, () => refresh(chatId))
      // Also watch the live run-dir root so a launch (no sidecar yet) pushes a
      // snapshot — otherwise an in-flight run is invisible until it terminates.
      const disposeLive = deps.watchRunDirs?.(workflowsDir, () => refresh(chatId)) ?? (() => {})
      const dispose = () => { disposeSidecar(); disposeLive() }
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
      // Sidecar runs (terminal/authoritative) + synthetic running rows for live
      // run dirs that have no sidecar yet. A sidecar always wins over a synthetic
      // row (it carries the real terminal status + counts).
      const merged = new Map(entry.runs)
      if (deps.listRunDirs) {
        const floor = Date.now() - SNAPSHOT_LIVE_WINDOW_MS
        for (const { runId, newestMtimeMs } of deps.listRunDirs(entry.dir)) {
          if (merged.has(runId) || newestMtimeMs < floor) continue
          merged.set(runId, synthRunningRun(runId, newestMtimeMs))
        }
      }
      return [...merged.values()].sort(byNewest).map(toRunSummary)
    },
    getRun(chatId, runId) {
      const entry = entries.get(chatId)
      if (!entry) return null
      const sidecar = entry.runs.get(runId)
      if (sidecar) return sidecar
      // Mirror snapshot(): an in-flight run has no sidecar yet, so synthesize a
      // running run from its live dir. Without this, the drill-in dialog fetches
      // null for a running row and flickers open→closed.
      if (deps.listRunDirs) {
        const floor = Date.now() - SNAPSHOT_LIVE_WINDOW_MS
        const live = deps.listRunDirs(entry.dir).find((r) => r.runId === runId && r.newestMtimeMs >= floor)
        if (live) return synthRunningRun(runId, live.newestMtimeMs)
      }
      return null
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
