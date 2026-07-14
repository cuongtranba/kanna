import { useCallback, useEffect, useRef } from "react"
import { Boxes, X } from "lucide-react"
import { cn } from "../lib/utils"
import type {
  OrchRunDetail,
  OrchRunStatus,
  OrchRunSummary,
  OrchStage,
  OrchTaskView,
} from "../../shared/orchestration-types"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "../components/ui/dialog"
import { OrchestrationSectionDetailStore } from "./OrchestrationSection.store"

// ── Status + stage helpers ─────────────────────────────────────────────────────

// Tones follow Kanna's DESIGN.md semantic palette: Editor Amber = running,
// Verified Sage = success, Kanna Coral = failed, Reference Blue = informational.
type Tone = "muted" | "running" | "success" | "destructive" | "info"

function toneDotClass(tone: Tone): string {
  switch (tone) {
    case "running": return "bg-amber-500 dark:bg-amber-400"
    case "success": return "bg-emerald-500 dark:bg-emerald-400"
    case "destructive": return "bg-destructive"
    case "info": return "bg-sky-600 dark:bg-sky-400"
    case "muted":
    default: return "bg-muted-foreground"
  }
}

function toneTextClass(tone: Tone): string {
  switch (tone) {
    case "running": return "text-amber-600 dark:text-amber-400"
    case "success": return "text-emerald-600 dark:text-emerald-400"
    case "destructive": return "text-destructive"
    case "info": return "text-sky-600 dark:text-sky-400"
    case "muted":
    default: return "text-muted-foreground"
  }
}

function runStatusTone(status: OrchRunStatus): Tone {
  switch (status) {
    case "running": return "running"
    case "completed": return "success"
    case "cancelled": return "muted"
    default: return "muted"
  }
}

function runStatusLabel(status: OrchRunStatus): string {
  switch (status) {
    case "running": return "Running"
    case "completed": return "Completed"
    case "cancelled": return "Cancelled"
    default: return status
  }
}

export function stageTone(stage: OrchStage): Tone {
  switch (stage) {
    case "committed": return "success"
    case "failed": return "destructive"
    case "verify": return "info"
    case "queued": return "muted"
    default: return "running" // implement / review / fix
  }
}

const STAGE_LABEL: Record<OrchStage, string> = {
  queued: "Queued",
  implement: "Implement",
  review: "Review",
  fix: "Fix",
  verify: "Verify",
  committed: "Committed",
  failed: "Failed",
}

// ── Pills ───────────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: OrchRunStatus }) {
  const tone = runStatusTone(status)
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      <span aria-hidden className={cn("inline-block size-1.5 rounded-full", toneDotClass(tone))} />
      <span className={toneTextClass(tone)}>{runStatusLabel(status)}</span>
    </span>
  )
}

export function StageChip({ stage }: { stage: OrchStage }) {
  const tone = stageTone(stage)
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium">
      <span aria-hidden className={cn("inline-block size-1.5 rounded-full", toneDotClass(tone))} />
      <span className={toneTextClass(tone)}>{STAGE_LABEL[stage]}</span>
    </span>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface OrchestrationSectionProps {
  runs: OrchRunSummary[]
  onSelectRun: (runId: string) => void
  selectedRunId?: string | null
}

// ── Section (props-driven list) ─────────────────────────────────────────────────

export function OrchestrationSection({ runs, onSelectRun, selectedRunId }: OrchestrationSectionProps) {
  if (runs.length === 0) return <OrchEmptyState />
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Boxes className="size-3.5 text-muted-foreground" aria-hidden />
        <span
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          Orchestration · {runs.length} {runs.length === 1 ? "run" : "runs"}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {runs.map((run) => (
          <OrchRunRow key={run.runId} run={run} selected={run.runId === selectedRunId} onSelect={onSelectRun} />
        ))}
      </ul>
    </div>
  )
}

function OrchEmptyState() {
  return (
    <div
      className="flex w-full flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-14 text-center"
      data-testid="orch-empty"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Boxes className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">No orchestration runs</p>
      <p className="text-xs text-muted-foreground">Start a run to fan tasks across parallel worktrees.</p>
    </div>
  )
}

function OrchRunRow(props: { run: OrchRunSummary; selected: boolean; onSelect: (runId: string) => void }) {
  const { run, selected } = props
  const live = run.status === "running"
  const handleClick = useCallback(() => { props.onSelect(run.runId) }, [props, run.runId])
  return (
    <li>
      <button
        type="button"
        data-testid={`orch-row:${run.runId}`}
        onClick={handleClick}
        className={cn(
          "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
          selected && "bg-muted",
        )}
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span className={cn("truncate text-sm text-foreground", (live || selected) && "font-medium")}>{run.title}</span>
          <StatusPill status={run.status} />
        </span>
        <span
          className="flex w-full items-center gap-3 text-xs text-muted-foreground tabular-nums"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <span>{run.counts.total} {run.counts.total === 1 ? "task" : "tasks"}</span>
          {run.counts.committed > 0 ? <span className={toneTextClass("success")}>{run.counts.committed} done</span> : null}
          {run.counts.running > 0 ? <span className={toneTextClass("running")}>{run.counts.running} active</span> : null}
          {run.counts.failed > 0 ? <span className={toneTextClass("destructive")}>{run.counts.failed} failed</span> : null}
        </span>
      </button>
    </li>
  )
}

// ── Detail dialog ───────────────────────────────────────────────────────────────

export interface OrchRunDetailProps {
  run: OrchRunDetail
  onCancel?: (runId: string) => void
}

export function OrchRunDetailView({ run, onCancel }: OrchRunDetailProps) {
  const cancellable = run.status === "running"
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={run.status} />
        <span className="text-xs text-muted-foreground tabular-nums">
          {run.counts.total} {run.counts.total === 1 ? "task" : "tasks"}
        </span>
        {run.verifyEnabled ? (
          <span className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            verify on
          </span>
        ) : null}
        {cancellable && onCancel ? (
          <button
            type="button"
            data-testid={`orch-cancel:${run.runId}`}
            onClick={() => onCancel(run.runId)}
            className="ml-auto inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="size-3" aria-hidden />
            Cancel run
          </button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-0.5">
        {run.tasks.map((task) => <OrchTaskRow key={task.taskId} task={task} />)}
      </ul>
    </div>
  )
}

function OrchTaskRow({ task }: { task: OrchTaskView }) {
  return (
    <li
      data-testid={`orch-task:${task.taskId}`}
      className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-foreground">{task.title}</span>
          <StageChip stage={task.stage} />
        </div>
        {task.commitSha ? (
          <span className="text-xs text-muted-foreground tabular-nums">commit {task.commitSha.slice(0, 9)}</span>
        ) : null}
        {task.error ? (
          <p className="rounded border border-destructive/20 bg-destructive/5 px-2 py-1 text-xs text-destructive whitespace-pre-wrap break-words">
            {task.error}
          </p>
        ) : null}
      </div>
    </li>
  )
}

interface OrchRunDetailDialogProps {
  run: OrchRunDetail | null
  open: boolean
  onClose: () => void
  onCancel?: (runId: string) => void
}

export function OrchRunDetailDialog({ run, open, onClose, onCancel }: OrchRunDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent size="lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{run ? run.title : "Orchestration run"}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {run ? <OrchRunDetailView run={run} onCancel={onCancel} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

// ── Self-contained variant (manages its own dialog state) ───────────────────────

export interface OrchestrationSectionWithDetailProps {
  runs: OrchRunSummary[]
  getRunDetail: (runId: string) => Promise<OrchRunDetail | null>
  onCancelRun: (runId: string) => void
}

function OrchestrationSectionWithDetailInner({ runs, getRunDetail, onCancelRun }: OrchestrationSectionWithDetailProps) {
  const selectedRun = OrchestrationSectionDetailStore.useScopedStore((s) => s.selectedRun)
  const selectedRunId = OrchestrationSectionDetailStore.useScopedStore((s) => s.selectedRunId)
  const setSelectedRun = OrchestrationSectionDetailStore.useScopedStore((s) => s.setSelectedRun)
  const setSelectedRunId = OrchestrationSectionDetailStore.useScopedStore((s) => s.setSelectedRunId)
  const clearSelection = OrchestrationSectionDetailStore.useScopedStore((s) => s.clearSelection)
  const isOpen = selectedRun !== null
  const runsAtSelectionRef = useRef<OrchRunSummary[] | null>(null)

  const handleSelectRun = useCallback(async (runId: string) => {
    runsAtSelectionRef.current = runs
    setSelectedRunId(runId)
    setSelectedRun("loading")
    const detail = await getRunDetail(runId)
    setSelectedRun(detail)
  }, [getRunDetail, runs, setSelectedRun, setSelectedRunId])

  const handleClose = useCallback(() => {
    clearSelection()
    runsAtSelectionRef.current = null
  }, [clearSelection])

  // Re-fetch the open run's detail when a live snapshot push changes `runs` and
  // the selected run is still running (mirrors WorkflowsSectionWithDetail).
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
  }, [runs, selectedRunId, getRunDetail, setSelectedRun])

  return (
    <>
      <OrchestrationSection runs={runs} onSelectRun={(runId) => { void handleSelectRun(runId) }} selectedRunId={selectedRunId} />
      <OrchRunDetailDialog
        run={selectedRun === "loading" ? null : selectedRun}
        open={isOpen}
        onClose={handleClose}
        onCancel={onCancelRun}
      />
    </>
  )
}

export function OrchestrationSectionWithDetail(props: OrchestrationSectionWithDetailProps) {
  return (
    <OrchestrationSectionDetailStore.Provider init={undefined}>
      <OrchestrationSectionWithDetailInner {...props} />
    </OrchestrationSectionDetailStore.Provider>
  )
}
