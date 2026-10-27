import { useCallback, type ReactNode } from "react"
import { WorkflowsPageViewStore } from "./WorkflowsPage.store"
import { useNavigate, useOutletContext } from "react-router-dom"
import { ArrowLeft, Loader2, Workflow } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import type { KannaState } from "./useKannaState"
import { useWorkflowsStore, selectRuns } from "../stores/workflowsStore"
import { WorkflowsSection, WorkflowRunDetail, isAgentLive } from "./WorkflowsSection"
import { useWorkflowRunSelection } from "./useWorkflowRunSelection"
import { WorkflowRunSelectionStore } from "./WorkflowRunSelection.store"
import { WorkflowAgentTranscriptPanel } from "./WorkflowAgentTranscriptPanel"
import { SettingsHeaderButton } from "../components/ui/settings-header-button"
import { cn } from "../lib/utils"
import type { WorkflowRun, WorkflowRunSummary } from "../../shared/workflow-types"
import type { TranscriptEntry } from "../../shared/types"
import { chatPath } from "../lib/paneTree"


export interface WorkflowsPageViewProps {
  runs: WorkflowRunSummary[]
  getRunDetail: (runId: string) => Promise<WorkflowRun | null>
  getAgentTranscript: (runId: string, agentId: string) => Promise<TranscriptEntry[]>
  onBackToChat?: () => void
}

function WorkflowsPageViewInner({ runs, getRunDetail, getAgentTranscript, onBackToChat }: WorkflowsPageViewProps) {
  const selectedAgentId = WorkflowsPageViewStore.useScopedStore((s) => s.selectedAgentId)
  const setSelectedAgentId = WorkflowsPageViewStore.useScopedStore((s) => s.setSelectedAgentId)
  const { selection, selectedRunId, selectRun, clearSelection } = useWorkflowRunSelection(runs, getRunDetail, selectedAgentId)

  const handleSelectRun = useCallback((runId: string) => {
    setSelectedAgentId(null)
    selectRun(runId)
  }, [selectRun, setSelectedAgentId])

  const handleClearSelection = useCallback(() => {
    clearSelection()
    setSelectedAgentId(null)
  }, [clearSelection, setSelectedAgentId])

  const runObj = selection.kind === "loaded" ? selection.run : null
  const selectedAgent =
    selectedAgentId !== null && runObj
      ? runObj.agents.find((a) => a.agentId === selectedAgentId)
      : undefined
  const hasSelection = selectedRunId !== null

  let detailContent: ReactNode
  if (selection.kind === "loading") {
    detailContent = (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-label="Loading" />
        Loading run…
      </div>
    )
  } else if (selection.kind === "failed") {
    detailContent = <WorkflowDetailPlaceholder text="Couldn't load this run. Select it again to retry." />
  } else if (selection.kind === "not-found") {
    detailContent = <WorkflowDetailPlaceholder text="Run not found or no longer available." />
  } else if (selectedAgent && runObj) {
    detailContent = (
      <WorkflowAgentTranscriptPanel
        key={selectedAgentId ?? ""}
        runId={runObj.runId}
        agentId={selectedAgent.agentId!}
        agentLabel={selectedAgent.label}
        promptPreview={selectedAgent.promptPreview}
        agentIsRunning={isAgentLive(selectedAgent.state)}
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
            className="text-xs font-medium tracking-wide text-muted-foreground tabular-nums"
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
            onSelectRun={handleSelectRun}
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

export function WorkflowsPageView(props: WorkflowsPageViewProps) {
  return (
    <WorkflowRunSelectionStore.Provider init={undefined}>
      <WorkflowsPageViewStore.Provider init={undefined}>
        <WorkflowsPageViewInner {...props} />
      </WorkflowsPageViewStore.Provider>
    </WorkflowRunSelectionStore.Provider>
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


export function WorkflowsPage({ chatId }: { chatId?: string }) {
  const state = useOutletContext<KannaState>()
  const navigate = useNavigate()
  const runs = useWorkflowsStore(useShallow(selectRuns(chatId ?? "")))

  const getRunDetail = useCallback(async (runId: string): Promise<WorkflowRun | null> => {
    if (!chatId) return null
    return state.socket.command({ type: "workflows.getRun", chatId, runId })
  }, [chatId, state.socket])

  const getAgentTranscript = useCallback(async (runId: string, agentId: string): Promise<TranscriptEntry[]> => {
    if (!chatId) return []
    return state.socket.command({ type: "workflows.getAgentTranscript", chatId, runId, agentId })
  }, [chatId, state.socket])

  const handleBackToChat = useCallback(() => {
    if (!chatId) return
    navigate(chatPath(chatId))
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
