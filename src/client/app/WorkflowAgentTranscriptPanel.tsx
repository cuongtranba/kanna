import { useCallback, useEffect } from "react"
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react"
import type { TranscriptEntry } from "../../shared/types"
import { processTranscriptMessages } from "../lib/parseTranscript"
import { onRejected } from "../../shared/errors"
import { SubagentEntryRow } from "../components/messages/SubagentEntryRow"
import { SubagentTranscriptFetchProvider } from "../components/messages/subagent-fetch-context"
import { WorkflowAgentTranscriptStore } from "./WorkflowAgentTranscriptPanel.store"

export interface WorkflowAgentTranscriptPanelProps {
  runId: string
  agentId: string
  agentLabel: string
  promptPreview?: string
  agentIsRunning?: boolean
  onClose: () => void
  getTranscript: (runId: string, agentId: string) => Promise<TranscriptEntry[]>
}

function WorkflowAgentTranscriptPanelInner({
  runId,
  agentId,
  agentLabel,
  promptPreview,
  agentIsRunning = false,
  onClose,
  getTranscript,
}: WorkflowAgentTranscriptPanelProps) {
  const loadState = WorkflowAgentTranscriptStore.useScopedStore((s) => s.loadState)
  const messages = WorkflowAgentTranscriptStore.useScopedStore((s) => s.messages)
  const error = WorkflowAgentTranscriptStore.useScopedStore((s) => s.error)
  const reloadNonce = WorkflowAgentTranscriptStore.useScopedStore((s) => s.reloadNonce)
  const setLoaded = WorkflowAgentTranscriptStore.useScopedStore((s) => s.setLoaded)
  const setStoreError = WorkflowAgentTranscriptStore.useScopedStore((s) => s.setError)
  const refresh = WorkflowAgentTranscriptStore.useScopedStore((s) => s.refresh)

  useEffect(() => {
    let stale = false
    getTranscript(runId, agentId)
      .then((entries) => {
        if (stale) return
        setLoaded(processTranscriptMessages(entries))
      })
      .catch(onRejected((error) => {
        if (stale) return
        setStoreError(error.message)
      }))
    return () => { stale = true }
  }, [runId, agentId, getTranscript, reloadNonce, setLoaded, setStoreError])

  const handleRefresh = useCallback(() => {
    refresh()
  }, [refresh])

  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="workflow-agent-transcript-panel">
      <div className="flex items-center gap-2 border-b border-border pb-2.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to run"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <span className="truncate text-sm font-semibold text-foreground">{agentLabel}</span>
        <span className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-xs font-medium tracking-wide text-muted-foreground">
          Transcript
        </span>
        {agentIsRunning ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-xs font-medium tracking-wide">
            <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500 dark:bg-emerald-400" />
            <span className="text-emerald-500 dark:text-emerald-400">Running</span>
          </span>
        ) : null}
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Refresh transcript"
          className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className={loadState === "loading" ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
        </button>
      </div>

      {agentIsRunning ? (
        <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          This agent is still running — the transcript may be incomplete. Refresh to update.
        </p>
      ) : null}

      {promptPreview ? (
        <div className="rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground">Prompt (preview)</span>
          <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground/90">{promptPreview}</p>
        </div>
      ) : null}

      <SubagentTranscriptFetchProvider value={null}>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
          {loadState === "loading" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-label="Loading" />
              Loading transcript…
            </div>
          ) : null}
          {loadState === "error" ? <div className="text-xs text-destructive">{error}</div> : null}
          {loadState === "loaded" && messages.length === 0 ? (
            <div className="text-xs text-muted-foreground">No transcript recorded yet.</div>
          ) : null}
          {messages.map((message) => (
            <SubagentEntryRow key={message.id} message={message} localPath="" />
          ))}
        </div>
      </SubagentTranscriptFetchProvider>
    </div>
  )
}

export function WorkflowAgentTranscriptPanel(props: WorkflowAgentTranscriptPanelProps) {
  return (
    <WorkflowAgentTranscriptStore.Provider init={undefined}>
      <WorkflowAgentTranscriptPanelInner {...props} />
    </WorkflowAgentTranscriptStore.Provider>
  )
}
