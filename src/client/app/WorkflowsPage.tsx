import { useCallback, useEffect, useRef, useState } from "react"
import { useOutletContext, useParams } from "react-router-dom"
import { Activity, Loader2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import type { KannaState } from "./useKannaState"
import { useWorkflowsStore, selectRuns } from "../stores/workflowsStore"
import { WorkflowsSection, WorkflowRunDetail } from "./WorkflowsSection"
import { WorkflowAgentTranscriptPanel } from "./WorkflowAgentTranscriptPanel"
import type { WorkflowRun, WorkflowRunSummary } from "../../shared/workflow-types"
import type { TranscriptEntry } from "../../shared/types"

// ── View (props-driven, router-free → unit testable) ──────────────────────────

export interface WorkflowsPageViewProps {
  runs: WorkflowRunSummary[]
  getRunDetail: (runId: string) => Promise<WorkflowRun | null>
  getAgentTranscript: (runId: string, agentId: string) => Promise<TranscriptEntry[]>
}

export function WorkflowsPageView({ runs, getRunDetail, getAgentTranscript }: WorkflowsPageViewProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null | "loading" | "not-found">(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  // The runs reference present when a row was last clicked. The push-refetch
  // effect only fires once `runs` changes identity AFTER the selection.
  const runsAtSelectionRef = useRef<WorkflowRunSummary[] | null>(null)
  // Monotone fetch counter shared by the click fetch AND the push-refetch:
  // whichever detail fetch was dispatched LAST wins, regardless of the order
  // its promise resolves in. Guards against a slow earlier fetch clobbering a
  // fresher selection/refresh.
  const fetchSeqRef = useRef(0)

  const handleSelectRun = useCallback(async (runId: string) => {
    runsAtSelectionRef.current = runs
    setSelectedRunId(runId)
    setSelectedAgentId(null)
    setSelectedRun("loading")
    const seq = ++fetchSeqRef.current
    const detail = await getRunDetail(runId)
    if (fetchSeqRef.current !== seq) return // a newer fetch superseded this one
    setSelectedRun(detail ?? "not-found")
  }, [getRunDetail, runs])

  // Re-fetch the selected run in-place (no "loading" swap) when a snapshot push
  // delivers a new `runs` reference AND the selected run is still running. Stops
  // once the sidecar lands (status flips). Mirrors WorkflowsSectionWithDetail.
  useEffect(() => {
    if (selectedRunId === null) return
    if (runs === runsAtSelectionRef.current) return
    const row = runs.find((r) => r.runId === selectedRunId)
    if (!row || row.status !== "running") return
    let cancelled = false
    const seq = ++fetchSeqRef.current
    void getRunDetail(selectedRunId).then((detail) => {
      if (cancelled || fetchSeqRef.current !== seq || detail === null) return
      // Don't collapse an open agent transcript: a live refresh may not have
      // flushed the selected agent into the journal yet. Keep the prior detail.
      if (selectedAgentId !== null && !detail.agents.some((a) => a.agentId === selectedAgentId)) return
      setSelectedRun(detail)
    })
    return () => { cancelled = true }
  }, [runs, selectedRunId, selectedAgentId, getRunDetail])

  const runObj = selectedRun !== "loading" && selectedRun !== "not-found" ? selectedRun : null
  const selectedAgent =
    selectedAgentId !== null && runObj
      ? runObj.agents.find((a) => a.agentId === selectedAgentId)
      : undefined

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <Activity className="size-5 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold text-foreground">Workflows</h1>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-80 shrink-0 overflow-auto border-r border-border p-4">
          <WorkflowsSection runs={runs} onSelectRun={(runId) => { void handleSelectRun(runId) }} />
        </div>
        <div className="min-w-0 flex-1 overflow-auto p-4">
          {selectedRun === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-label="Loading" />
              Loading run…
            </div>
          ) : selectedRun === "not-found" ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Run not found or no longer available.
            </div>
          ) : selectedAgent && runObj ? (
            <WorkflowAgentTranscriptPanel
              key={selectedAgentId ?? ""}
              runId={runObj.runId}
              agentId={selectedAgent.agentId!}
              agentLabel={selectedAgent.label}
              promptPreview={selectedAgent.promptPreview}
              agentIsRunning={selectedAgent.state === "running" || selectedAgent.state === "progress"}
              onClose={() => setSelectedAgentId(null)}
              getTranscript={getAgentTranscript}
            />
          ) : runObj ? (
            <WorkflowRunDetail run={runObj} onSelectAgent={(agentId) => setSelectedAgentId(agentId)} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a run to view its phases and agents.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Route wrapper (reads outlet context + params + store) ─────────────────────

export function WorkflowsPage() {
  const state = useOutletContext<KannaState>()
  const { chatId } = useParams<{ chatId: string }>()
  const runs = useWorkflowsStore(useShallow(selectRuns(chatId ?? "")))

  const getRunDetail = useCallback(async (runId: string): Promise<WorkflowRun | null> => {
    if (!chatId) return null
    return state.socket.command<WorkflowRun | null>({ type: "workflows.getRun", chatId, runId })
  }, [chatId, state.socket])

  const getAgentTranscript = useCallback(async (runId: string, agentId: string): Promise<TranscriptEntry[]> => {
    if (!chatId) return []
    return state.socket.command<TranscriptEntry[]>({ type: "workflows.getAgentTranscript", chatId, runId, agentId })
  }, [chatId, state.socket])

  if (!chatId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Open a chat to view its workflows.
      </div>
    )
  }

  return <WorkflowsPageView runs={runs} getRunDetail={getRunDetail} getAgentTranscript={getAgentTranscript} />
}
