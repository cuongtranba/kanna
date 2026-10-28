import { useCallback, useEffect, useRef } from "react"
import { LOG_PREFIX } from "../../shared/branding"
import { onRejected } from "../../shared/errors"
import { log } from "../../shared/log"
import type { WorkflowRun, WorkflowRunSummary } from "../../shared/workflow-types"
import { runDetached } from "../lib/runDetached"
import { selectedRunIdOf, WorkflowRunSelectionStore, type WorkflowRunSelection } from "./WorkflowRunSelection.store"

export interface WorkflowRunSelectionView {
  selection: WorkflowRunSelection
  selectedRunId: string | null
  selectRun: (runId: string) => void
  clearSelection: () => void
}

export function useWorkflowRunSelection(
  runs: WorkflowRunSummary[],
  getRunDetail: (runId: string) => Promise<WorkflowRun | null>,
  requiredAgentId: string | null,
): WorkflowRunSelectionView {
  const selection = WorkflowRunSelectionStore.useScopedStore((s) => s.selection)
  const loadStarted = WorkflowRunSelectionStore.useScopedStore((s) => s.loadStarted)
  const loaded = WorkflowRunSelectionStore.useScopedStore((s) => s.loaded)
  const loadFailed = WorkflowRunSelectionStore.useScopedStore((s) => s.loadFailed)
  const refreshed = WorkflowRunSelectionStore.useScopedStore((s) => s.refreshed)
  const cleared = WorkflowRunSelectionStore.useScopedStore((s) => s.cleared)
  const runsAtSelectionRef = useRef<WorkflowRunSummary[] | null>(null)
  const fetchSeqRef = useRef(0)
  const selectedRunId = selectedRunIdOf(selection)

  const selectRun = useCallback((runId: string) => {
    runsAtSelectionRef.current = runs
    loadStarted(runId)
    const seq = ++fetchSeqRef.current
    const isCurrent = () => fetchSeqRef.current === seq
    getRunDetail(runId).then(
      (detail) => {
        if (isCurrent()) loaded(runId, detail)
      },
      onRejected((error) => {
        log.error(LOG_PREFIX, "workflows.getRun failed", error)
        if (isCurrent()) loadFailed(runId)
      }),
    )
  }, [getRunDetail, runs, loadStarted, loaded, loadFailed])

  const clearSelection = useCallback(() => {
    cleared()
    runsAtSelectionRef.current = null
  }, [cleared])

  useEffect(() => {
    if (selectedRunId === null) return
    if (runs === runsAtSelectionRef.current) return
    const row = runs.find((r) => r.runId === selectedRunId)
    if (!row || row.status !== "running") return
    let cancelled = false
    const seq = ++fetchSeqRef.current
    runDetached("workflows.getRun refresh", getRunDetail(selectedRunId).then((detail) => {
      if (cancelled || fetchSeqRef.current !== seq || detail === null) return
      if (requiredAgentId !== null && !detail.agents.some((a) => a.agentId === requiredAgentId)) return
      refreshed(detail)
    }))
    return () => { cancelled = true }
  }, [runs, selectedRunId, requiredAgentId, getRunDetail, refreshed])

  return { selection, selectedRunId, selectRun, clearSelection }
}
