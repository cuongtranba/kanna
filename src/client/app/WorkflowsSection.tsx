import { useCallback, useEffect, useRef, useState } from "react"
import { Activity, FileText } from "lucide-react"
import { cn } from "../lib/utils"
import { formatCompactDuration } from "../lib/formatDuration"
import { groupWorkflowAgentsByPhase } from "../lib/workflowGrouping"
import type { WorkflowAgentProgress, WorkflowRun, WorkflowRunSummary, WorkflowStatus } from "../../shared/workflow-types"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "../components/ui/dialog"

// ── Status helpers ────────────────────────────────────────────────────────────

export type WorkflowStatusTone = "muted" | "active" | "destructive" | "warning"

function workflowStatusLabel(status: WorkflowStatus): string {
  switch (status) {
    case "running": return "Running"
    case "completed": return "Completed"
    case "failed": return "Failed"
    case "killed": return "Killed"
    case "unknown": return "Unknown"
  }
}

function workflowStatusTone(status: WorkflowStatus): WorkflowStatusTone {
  switch (status) {
    case "running": return "active"
    case "failed": return "destructive"
    case "killed": return "warning"
    case "completed":
    case "unknown":
    default: return "muted"
  }
}

export function workflowStatusDotClass(tone: WorkflowStatusTone): string {
  switch (tone) {
    case "active": return "bg-emerald-500 dark:bg-emerald-400"
    case "destructive": return "bg-destructive"
    case "warning": return "bg-amber-500 dark:bg-amber-400"
    case "muted":
    default: return "bg-muted-foreground"
  }
}

export function workflowStatusTextClass(tone: WorkflowStatusTone): string {
  switch (tone) {
    case "active": return "text-emerald-500 dark:text-emerald-400"
    case "destructive": return "text-destructive"
    case "warning": return "text-amber-500 dark:text-amber-400"
    case "muted":
    default: return "text-muted-foreground"
  }
}

// ── StatusPill ────────────────────────────────────────────────────────────────

export function WorkflowStatusPill({ status }: { status: WorkflowStatus }) {
  const tone = workflowStatusTone(status)
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      <span
        aria-hidden
        className={cn(
          "inline-block size-1.5 rounded-full",
          workflowStatusDotClass(tone),
          status === "running" && "animate-pulse",
        )}
      />
      <span className={workflowStatusTextClass(tone)}>{workflowStatusLabel(status)}</span>
    </span>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface WorkflowsSectionProps {
  runs: WorkflowRunSummary[]
  onSelectRun: (runId: string) => void
  /** Highlights the matching row. The in-chat panel omits it (dialog detail). */
  selectedRunId?: string | null
}

// ── WorkflowsSection ──────────────────────────────────────────────────────────

export function WorkflowsSection({ runs, onSelectRun, selectedRunId }: WorkflowsSectionProps) {
  if (runs.length === 0) {
    return <WorkflowEmptyState />
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {runs.length} {runs.length === 1 ? "run" : "runs"}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {runs.map((run) => (
          <WorkflowRunRow
            key={run.runId}
            run={run}
            selected={run.runId === selectedRunId}
            onSelect={onSelectRun}
          />
        ))}
      </ul>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function WorkflowEmptyState() {
  return (
    <div
      className="flex w-full flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-14 text-center"
      data-testid="workflow-empty"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Activity className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">No workflow runs</p>
      <p className="text-xs text-muted-foreground">Workflow runs will appear here when triggered.</p>
    </div>
  )
}

// ── WorkflowRunRow ────────────────────────────────────────────────────────────

function WorkflowRunRow(props: {
  run: WorkflowRunSummary
  selected: boolean
  onSelect: (runId: string) => void
}) {
  const { run, selected } = props
  const label = run.workflowName ?? run.runId
  const live = run.status === "running"

  const handleClick = useCallback(() => {
    props.onSelect(run.runId)
  }, [props, run.runId])

  return (
    <li>
      <button
        type="button"
        data-testid={`workflow-row:${run.runId}`}
        onClick={handleClick}
        className={cn(
          "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
          selected && "bg-muted",
        )}
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span className={cn("truncate text-sm text-foreground", (live || selected) && "font-medium")}>
            {label}
          </span>
          <WorkflowStatusPill status={run.status} />
        </span>
        <span className="flex w-full items-center gap-3 text-xs text-muted-foreground">
          {run.agentCount != null ? (
            <span className="tabular-nums" style={{ fontVariantNumeric: "tabular-nums" }}>
              {run.agentCount} {run.agentCount === 1 ? "agent" : "agents"}
            </span>
          ) : null}
          {run.totalTokens != null ? (
            <span className="tabular-nums" style={{ fontVariantNumeric: "tabular-nums" }}>
              {run.totalTokens.toLocaleString()} tokens
            </span>
          ) : null}
          {run.durationMs != null ? (
            <span className="tabular-nums" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatCompactDuration(run.durationMs)}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

// ── WorkflowRunDetailDialog ───────────────────────────────────────────────────

interface WorkflowRunDetailDialogProps {
  run: WorkflowRun | null
  open: boolean
  onClose: () => void
}

export function agentStateTone(state: string): WorkflowStatusTone {
  if (state === "running" || state === "progress") return "active"
  if (state === "failed" || state === "error") return "destructive"
  if (state === "killed") return "warning"
  return "muted"
}

// Pretty-print an overall workflow result. parseWorkflowRunFile stringifies
// object results to JSON, so re-indent when it parses as JSON; otherwise show
// the raw string.
export function formatWorkflowResult(result: string): string {
  const trimmed = result.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return result
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return result
  }
}

export function WorkflowRunDetailDialog({ run, open, onClose }: WorkflowRunDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent size="lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {run ? (run.workflowName ?? run.runId) : "Workflow run"}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          {run ? <WorkflowRunDetail run={run} /> : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

// ── Agent row + phase group (the progress tree) ───────────────────────────────

function AgentPreviewBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded border border-border/50 bg-muted/40 px-2 py-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground/90">{text}</p>
    </div>
  )
}

function WorkflowAgentRow({
  agent,
  onSelectAgent,
}: {
  agent: WorkflowAgentProgress
  onSelectAgent?: (agentId: string) => void
}) {
  const stateTone = agentStateTone(agent.state)
  const live = stateTone === "active"
  const canDrill = Boolean(onSelectAgent && agent.agentId)
  return (
    <li
      data-testid={`workflow-agent:${agent.agentId ?? agent.index}`}
      className="group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 inline-block size-1.5 shrink-0 rounded-full",
          workflowStatusDotClass(stateTone),
          live && "animate-pulse",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate text-sm text-foreground", live && "font-medium")}>{agent.label}</span>
          {agent.model ? (
            <span className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {agent.model}
            </span>
          ) : null}
          {canDrill ? (
            <button
              type="button"
              data-testid={`workflow-agent-transcript:${agent.agentId}`}
              onClick={() => onSelectAgent?.(agent.agentId!)}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <FileText className="size-3" aria-hidden />
              Transcript
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className={cn("capitalize", workflowStatusTextClass(stateTone))}>{agent.state}</span>
          {agent.lastToolName ? <span className="truncate">last: {agent.lastToolName}</span> : null}
          {agent.durationMs != null ? <span className="tabular-nums">{formatCompactDuration(agent.durationMs)}</span> : null}
          {agent.tokens != null ? <span className="tabular-nums">{agent.tokens.toLocaleString()} tok</span> : null}
          {agent.toolCalls != null ? <span className="tabular-nums">{agent.toolCalls} calls</span> : null}
        </div>
        {agent.lastToolSummary ? <span className="truncate text-xs text-muted-foreground/80">{agent.lastToolSummary}</span> : null}
        {agent.promptPreview ? <AgentPreviewBlock label="Prompt" text={agent.promptPreview} /> : null}
        {agent.resultPreview ? <AgentPreviewBlock label="Result" text={agent.resultPreview} /> : null}
      </div>
    </li>
  )
}

// ── Run detail (shared by the in-chat dialog and the dedicated page) ───────────

export interface WorkflowRunDetailProps {
  run: WorkflowRun
  /**
   * When provided, each agent that has an `agentId` shows a "Transcript" button
   * that opens the full per-agent transcript. The in-chat dialog omits this
   * (previews only); the dedicated page wires it to the drill-in panel.
   */
  onSelectAgent?: (agentId: string) => void
  /**
   * Heading rendered above the meta row. The dedicated page passes the run
   * name; the in-chat dialog omits it (DialogTitle already shows the name).
   */
  title?: string
}

export function WorkflowRunDetail({ run, onSelectAgent, title }: WorkflowRunDetailProps) {
  const tone = workflowStatusTone(run.status)
  const groups = groupWorkflowAgentsByPhase(run.phases, run.agents)

  return (
    <div className="flex flex-col gap-5">
      {/* Header: optional title + meta row */}
      <div className="flex flex-col gap-1.5">
        {title ? <h3 className="truncate text-base font-semibold text-foreground">{title}</h3> : null}
        <div className="flex flex-wrap items-center gap-3">
          <WorkflowStatusPill status={run.status} />
          {run.durationMs != null ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatCompactDuration(run.durationMs)}
            </span>
          ) : null}
          {run.agentCount != null ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {run.agentCount} {run.agentCount === 1 ? "agent" : "agents"}
            </span>
          ) : null}
          {run.totalTokens != null ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {run.totalTokens.toLocaleString()} tokens
            </span>
          ) : null}
          {run.totalToolCalls != null ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {run.totalToolCalls} tool calls
            </span>
          ) : null}
        </div>
      </div>

      {/* Summary */}
      {run.summary ? (
        <section className="flex flex-col gap-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</h4>
          <p className="text-sm text-foreground whitespace-pre-wrap">{run.summary}</p>
        </section>
      ) : null}

      {/* Progress tree: agents nested under their phase */}
      {groups.length > 0 ? (
        <section className="flex flex-col gap-4" data-testid="workflow-progress-tree">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                {group.phaseIndex != null ? (
                  <span
                    aria-hidden
                    className="flex size-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-medium text-muted-foreground tabular-nums"
                  >
                    {group.phaseIndex}
                  </span>
                ) : null}
                <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {group.title}
                </h4>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {group.agents.length} {group.agents.length === 1 ? "agent" : "agents"}
                </span>
              </div>
              {group.detail ? <p className="text-xs text-muted-foreground">{group.detail}</p> : null}
              {group.agents.length > 0 ? (
                <ul className="ml-1.5 flex flex-col gap-0.5 border-l border-border pl-2.5">
                  {group.agents.map((agent) => (
                    <WorkflowAgentRow key={agent.agentId ?? agent.index} agent={agent} onSelectAgent={onSelectAgent} />
                  ))}
                </ul>
              ) : (
                <p className="ml-1.5 border-l border-border pl-2.5 text-xs italic text-muted-foreground/70">
                  No agents yet
                </p>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {/* Result */}
      {run.result ? (
        <section className="flex flex-col gap-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Result</h4>
          <pre className="max-h-80 overflow-auto rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-foreground whitespace-pre-wrap break-words">
            {formatWorkflowResult(run.result)}
          </pre>
        </section>
      ) : null}

      {/* Script (collapsed by default) */}
      {run.script ? (
        <details className="flex flex-col gap-1">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
            Script
          </summary>
          <pre className="mt-1.5 max-h-96 overflow-auto rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-foreground whitespace-pre-wrap break-words">
            {run.script}
          </pre>
        </details>
      ) : null}

      {/* Error */}
      {run.error && run.status !== "completed" ? (
        <section className="flex flex-col gap-1">
          <h4 className={cn("text-xs font-medium uppercase tracking-wide", workflowStatusTextClass(tone))}>
            Error
          </h4>
          <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
            {run.error}
          </p>
        </section>
      ) : null}
    </div>
  )
}

// ── WorkflowsSectionWithDetail ────────────────────────────────────────────────
// Self-contained version that manages its own dialog state.
// Used when the parent provides a getRunDetail fetcher.

export interface WorkflowsSectionWithDetailProps {
  runs: WorkflowRunSummary[]
  getRunDetail: (runId: string) => Promise<WorkflowRun | null>
}

export function WorkflowsSectionWithDetail({ runs, getRunDetail }: WorkflowsSectionWithDetailProps) {
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null | "loading">(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const isOpen = selectedRun !== null
  // Track the runs reference that was present when the run was last selected
  // via a click. The push-refetch effect only fires when runs changes identity
  // AFTER the selection has already been established.
  const runsAtSelectionRef = useRef<WorkflowRunSummary[] | null>(null)

  const handleSelectRun = useCallback(async (runId: string) => {
    runsAtSelectionRef.current = runs
    setSelectedRunId(runId)
    setSelectedRun("loading")
    const detail = await getRunDetail(runId)
    setSelectedRun(detail)
  }, [getRunDetail, runs])

  const handleClose = useCallback(() => {
    setSelectedRunId(null)
    setSelectedRun(null)
    runsAtSelectionRef.current = null
  }, [])

  // Re-fetch the selected run's detail in-place (no "loading" swap) whenever
  // the snapshot push delivers a new `runs` reference AND the selected run is
  // still running. Stops naturally once the sidecar lands (status flips).
  // Guard: skip when `runs` is the same reference as when the row was clicked
  // (that click already initiated the initial fetch).
  useEffect(() => {
    if (selectedRunId === null) return
    if (runs === runsAtSelectionRef.current) return
    const row = runs.find((r) => r.runId === selectedRunId)
    if (!row || row.status !== "running") return
    let stale = false
    void getRunDetail(selectedRunId).then((detail) => {
      if (stale || detail === null) return
      setSelectedRun(detail)
    })
    return () => { stale = true }
  }, [runs, selectedRunId, getRunDetail])

  return (
    <>
      <WorkflowsSection
        runs={runs}
        onSelectRun={(runId) => { void handleSelectRun(runId) }}
      />
      <WorkflowRunDetailDialog
        run={selectedRun === "loading" ? null : selectedRun}
        open={isOpen}
        onClose={handleClose}
      />
    </>
  )
}
