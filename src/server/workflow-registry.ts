import type { WorkflowJournalEntry, WorkflowRawFile, WorkflowRunDirInfo } from "./workflow-watch-io.adapter"
import { parseWorkflowRunFile, toRunSummary } from "../shared/workflow-types"
import type { WorkflowAgentProgress, WorkflowRun, WorkflowRunSummary } from "../shared/workflow-types"
import { parseAgentTranscriptLines } from "./agent-transcript-parse"
import { createWatchedRegistry } from "./watched-registry"
import type { TranscriptEntry } from "../shared/types"

export interface WorkflowRegistryDeps {
  read: (dir: string) => WorkflowRawFile[]
  watch: (dir: string, onChange: () => void) => () => void
  listRunDirs?: (workflowsDir: string) => WorkflowRunDirInfo[]
  watchRunDirs?: (workflowsDir: string, onChange: () => void) => () => void
  readRunJournal?: (workflowsDir: string, runId: string) => WorkflowJournalEntry[]
  readAgentTranscriptLines?: (workflowsDir: string, runId: string, agentId: string) => string[]
}
export interface WorkflowRegistry {
  register(chatId: string, workflowsDir: string): void
  unregister(chatId: string): void
  snapshot(chatId: string): WorkflowRunSummary[]
  getRun(chatId: string, runId: string): WorkflowRun | null
  getAgentTranscript(chatId: string, runId: string, agentId: string): TranscriptEntry[]
  hasActiveRun(chatId: string, freshnessMs: number, now: number): boolean
  subscribe(cb: (chatId: string) => void): () => void
}

const SNAPSHOT_LIVE_WINDOW_MS = 10 * 60 * 1000

function byNewest(a: WorkflowRun, b: WorkflowRun): number {
  return (b.startTime ?? 0) - (a.startTime ?? 0)
}

function synthRunningRun(runId: string, startTime: number): WorkflowRun {
  return { runId, status: "running", startTime, phases: [], agents: [] }
}

function isStaleCrashSidecar(run: WorkflowRun): boolean {
  return run.status === "failed" && (run.agentCount ?? 0) === 0 && run.agents.length === 0
}

function basenameAfterSlash(p: string | undefined): string | undefined {
  if (!p) return undefined
  const trimmed = p.replace(/\/+$/, "")
  if (!trimmed) return undefined
  const i = trimmed.lastIndexOf("/")
  const out = i < 0 ? trimmed : trimmed.slice(i + 1)
  return out || undefined
}

function buildAgentsFromJournal(entries: WorkflowJournalEntry[]): WorkflowAgentProgress[] {
  const out = new Map<string, WorkflowAgentProgress>()
  for (const e of entries) {
    if (!e.agentId) continue
    if (!out.has(e.agentId)) {
      out.set(e.agentId, { index: out.size + 1, label: "agent", agentId: e.agentId, state: "running" })
    }
    if (e.type === "result") {
      const cur = out.get(e.agentId)
      if (!cur) continue
      cur.state = "completed"
      const r = e.result
      const dirBase = basenameAfterSlash(r?.dir)
      if (dirBase) cur.label = dirBase
      const parts: string[] = []
      if (r?.fixed) parts.push(`fixed ${r.fixed}`)
      if (r?.stale) parts.push(`stale ${r.stale}`)
      if (r?.skipped) parts.push(`skipped ${r.skipped}`)
      if (typeof r?.testsPass === "boolean") parts.push(r.testsPass ? "tests ✓" : "tests ✗")
      else if (r?.test_status) parts.push(`test:${r.test_status}`)
      if (parts.length > 0) cur.lastToolSummary = parts.join(" · ")
      else if (r?.summary) cur.lastToolSummary = r.summary
    }
  }
  return [...out.values()]
}

export function createWorkflowRegistry(deps: WorkflowRegistryDeps): WorkflowRegistry {
  const registry = createWatchedRegistry<Map<string, WorkflowRun>>({
    load: (workflowsDir) => {
      const runs = new Map<string, WorkflowRun>()
      for (const { raw } of deps.read(workflowsDir)) {
        const run = parseWorkflowRunFile(raw)
        if (run) runs.set(run.runId, run)
      }
      return runs
    },
    watch: (workflowsDir, onChange) => {
      const disposeSidecar = deps.watch(workflowsDir, onChange)
      const disposeLive = deps.watchRunDirs?.(workflowsDir, onChange) ?? (() => {})
      return () => { disposeSidecar(); disposeLive() }
    },
  })

  return {
    register: registry.register,
    unregister: registry.unregister,
    snapshot(chatId) {
      const entry = registry.entry(chatId)
      if (!entry) return []
      const { key: dir, state: runs } = entry
      const merged = new Map(runs)
      if (deps.listRunDirs) {
        const floor = Date.now() - SNAPSHOT_LIVE_WINDOW_MS
        for (const { runId, newestMtimeMs } of deps.listRunDirs(dir)) {
          if (newestMtimeMs < floor) continue
          const existing = merged.get(runId)
          if (!existing) { merged.set(runId, synthRunningRun(runId, newestMtimeMs)); continue }
          if (!isStaleCrashSidecar(existing) || !deps.readRunJournal) continue
          const agents = buildAgentsFromJournal(deps.readRunJournal(dir, runId))
          if (agents.length === 0) continue
          merged.set(runId, {
            ...synthRunningRun(runId, newestMtimeMs),
            taskId: existing.taskId, workflowName: existing.workflowName,
            agentCount: agents.length, agents,
          })
        }
      }
      return [...merged.values()].sort(byNewest).map(toRunSummary)
    },
    getRun(chatId, runId) {
      const entry = registry.entry(chatId)
      if (!entry) return null
      const { key: dir, state: runs } = entry
      const sidecar = runs.get(runId)
      if (sidecar && !isStaleCrashSidecar(sidecar)) return sidecar
      if (deps.listRunDirs) {
        const floor = Date.now() - SNAPSHOT_LIVE_WINDOW_MS
        const live = deps.listRunDirs(dir).find((r) => r.runId === runId && r.newestMtimeMs >= floor)
        if (live) {
          const base = synthRunningRun(runId, live.newestMtimeMs)
          if (deps.readRunJournal) {
            const agents = buildAgentsFromJournal(deps.readRunJournal(dir, runId))
            if (agents.length > 0 || !sidecar) {
              return { ...base, taskId: sidecar?.taskId, workflowName: sidecar?.workflowName, agentCount: agents.length, agents }
            }
          } else if (!sidecar) {
            return base
          }
        }
      }
      return sidecar ?? null
    },
    getAgentTranscript(chatId, runId, agentId) {
      const entry = registry.entry(chatId)
      if (!entry || !deps.readAgentTranscriptLines) return []
      return parseAgentTranscriptLines(deps.readAgentTranscriptLines(entry.key, runId, agentId))
    },
    hasActiveRun(chatId, freshnessMs, now) {
      const entry = registry.entry(chatId)
      if (!entry || !deps.listRunDirs) return false
      const { key: dir, state: runs } = entry
      const floor = now - freshnessMs
      for (const { runId, newestMtimeMs } of deps.listRunDirs(dir)) {
        if (newestMtimeMs < floor) continue
        const sidecar = runs.get(runId)
        if (!sidecar || sidecar.status === "running") return true
      }
      return false
    },
    subscribe: registry.subscribe,
  }
}
