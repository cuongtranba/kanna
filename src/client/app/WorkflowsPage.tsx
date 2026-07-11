import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useNavigate, useOutletContext, useParams } from "react-router-dom"
import { ArrowLeft, Loader2, Workflow } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import type { KannaState } from "./useKannaState"
import { useWorkflowsStore, selectRuns } from "../stores/workflowsStore"
import { WorkflowsSection, WorkflowRunDetail } from "./WorkflowsSection"
import { WorkflowAgentTranscriptPanel } from "./WorkflowAgentTranscriptPanel"
import { SettingsHeaderButton } from "../components/ui/settings-header-button"
import { cn } from "../lib/utils"
import type { WorkflowRun, WorkflowRunSummary } from "../../shared/workflow-types"
import type { TranscriptEntry } from "../../shared/types"

// ── View (props-driven, router-free → unit testable) ──────────────────────────

export interface WorkflowsPageViewProps {
  runs: WorkflowRunSummary[]
  getRunDetail: (runId: string) => Promise<WorkflowRun | null>
  getAgentTranscript: (runId: string, agentId: string) => Promise<TranscriptEntry[]>
  /** When provided, the header shows a "Back to chat" button wired to it. */
  onBackToChat?: () => void
}

export function WorkflowsPageView({ runs, getRunDetail, getAgentTranscript, onBackToChat }: WorkflowsPageViewProps) {
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

  const handleClearSelection = useCallback(() => {
    setSelectedRunId(null)
    setSelectedRun(null)
    setSelectedAgentId(null)
    runsAtSelectionRef.current = null
  }, [])

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
  const hasSelection = selectedRunId !== null

  let detailContent: ReactNode
  if (selectedRun === "loading") {
    detailContent = (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-label="Loading" />
        Loading run…
      </div>
    )
  } else if (selectedRun === "not-found") {
    detailContent = <WorkflowDetailPlaceholder text="Run not found or no longer available." />
  } else if (selectedAgent && runObj) {
    detailContent = (
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
    )
  } else if (runObj) {
    detailContent = (
      <WorkflowRunDetail
        run={runObj}
        title={runObj.workflowName ?? runObj.runId}
        onSelectAgent={(agentId) => setSelectedAgentId(agentId)}
      />
    )
  } else {
    detailContent = <WorkflowDetailPlaceholder text="Select a run to view its phases and agents." />
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 md:px-6">
        <Workflow className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold text-foreground">Workflows</h1>
        {runs.length > 0 ? (
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground tabular-nums"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {runs.length} {runs.length === 1 ? "run" : "runs"}
          </span>
        ) : null}
        {onBackToChat ? (
          <SettingsHeaderButton
            aria-label="Back to chat"
            className="ml-auto"
            icon={<ArrowLeft className="size-3.5" aria-hidden />}
            onClick={onBackToChat}
          >
            Back to chat
          </SettingsHeaderButton>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "w-full shrink-0 overflow-auto p-3 md:w-80 md:border-r md:border-border",
            hasSelection && "hidden md:block",
          )}
        >
          <WorkflowsSection
            runs={runs}
            selectedRunId={selectedRunId}
            onSelectRun={(runId) => { void handleSelectRun(runId) }}
          />
        </div>
        <div
          className={cn(
            "min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6",
            !hasSelection && "hidden md:block",
          )}
        >
          {hasSelection ? (
            <button
              type="button"
              onClick={handleClearSelection}
              aria-label="Back to runs"
              className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground md:hidden"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              All runs
            </button>
          ) : null}
          {detailContent}
        </div>
      </div>
    </div>
  )
}

function WorkflowDetailPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-8 py-10 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Workflow className="size-5" aria-hidden />
        </div>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  )
}

// ── Route wrapper (reads outlet context + params + store) ─────────────────────

export function WorkflowsPage() {
  const state = useOutletContext<KannaState>()
  const navigate = useNavigate()
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

  const handleBackToChat = useCallback(() => {
    if (!chatId) return
    navigate(`/chat/${chatId}`)
  }, [chatId, navigate])

  if (!chatId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Open a chat to view its workflows.
      </div>
    )
  }

  return (
    <WorkflowsPageView
      runs={runs}
      getRunDetail={getRunDetail}
      getAgentTranscript={getAgentTranscript}
      onBackToChat={handleBackToChat}
    />
  )
}
