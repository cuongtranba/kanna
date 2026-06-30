import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react"
import type { HydratedTranscriptMessage, TranscriptEntry } from "../../shared/types"
import { processTranscriptMessages } from "../lib/parseTranscript"
import { SubagentEntryRow } from "../components/messages/SubagentEntryRow"
import { SubagentTranscriptFetchProvider } from "../components/messages/subagent-fetch-context"

export interface WorkflowAgentTranscriptPanelProps {
  runId: string
  agentId: string
  agentLabel: string
  /** The truncated sidecar prompt preview, shown above the full transcript. */
  promptPreview?: string
  /**
   * When the agent is still running its transcript on disk is incomplete; the
   * panel reads a one-shot snapshot, so it surfaces a hint + a manual Refresh.
   */
  agentIsRunning?: boolean
  onClose: () => void
  /**
   * Fetches the agent's full transcript. Reuses the same machinery as the
   * native-subagent viewer (server: readWorkflowAgentTranscriptLines →
   * normalizeClaudeStreamMessage). The panel hydrates the entries with
   * `processTranscriptMessages` and renders them with `SubagentEntryRow`.
   *
   * The parent should mount this panel with `key={agentId}` so switching agents
   * remounts it fresh (re-fetches from the initial loading state).
   */
  getTranscript: (runId: string, agentId: string) => Promise<TranscriptEntry[]>
}

type LoadState = "loading" | "loaded" | "error"

export function WorkflowAgentTranscriptPanel({
  runId,
  agentId,
  agentLabel,
  promptPreview,
  agentIsRunning = false,
  onClose,
  getTranscript,
}: WorkflowAgentTranscriptPanelProps) {
  const [state, setState] = useState<LoadState>("loading")
  const [messages, setMessages] = useState<HydratedTranscriptMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  // Bumped by Refresh to force the fetch effect to re-run.
  const [reloadNonce, setReloadNonce] = useState(0)

  // The fetch never sets "loading" synchronously (that would be set-state-in-
  // effect; initial state is already "loading", and Refresh sets it from the
  // user handler). The `stale` flag invalidates the in-flight fetch on unmount,
  // dep change, OR a refresh (the prior effect's cleanup runs first).
  useEffect(() => {
    let stale = false
    getTranscript(runId, agentId)
      .then((entries) => {
        if (stale) return
        setMessages(processTranscriptMessages(entries))
        setState("loaded")
      })
      .catch((err: unknown) => {
        if (stale) return
        setError(err instanceof Error ? err.message : "Failed to load agent transcript")
        setState("error")
      })
    return () => { stale = true }
  }, [runId, agentId, getTranscript, reloadNonce])

  // Manual refresh is a user event, so resetting to "loading" here is allowed.
  const handleRefresh = useCallback(() => {
    setError(null)
    setState("loading")
    setReloadNonce((n) => n + 1)
  }, [])

  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="workflow-agent-transcript-panel">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to run"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <span className="truncate text-sm font-medium text-foreground">{agentLabel}</span>
        <span className="text-xs text-muted-foreground">transcript</span>
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Refresh transcript"
          className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className={state === "loading" ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
        </button>
      </div>

      {agentIsRunning ? (
        <p className="text-[11px] text-muted-foreground">
          This agent is still running — the transcript may be incomplete. Refresh to update.
        </p>
      ) : null}

      {promptPreview ? (
        <div className="rounded border border-border/50 bg-muted/40 px-2 py-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Prompt (preview)</span>
          <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground/90">{promptPreview}</p>
        </div>
      ) : null}

      <SubagentTranscriptFetchProvider value={null}>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
          {state === "loading" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-label="Loading" />
              Loading transcript…
            </div>
          ) : null}
          {state === "error" ? <div className="text-xs text-destructive">{error}</div> : null}
          {state === "loaded" && messages.length === 0 ? (
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
