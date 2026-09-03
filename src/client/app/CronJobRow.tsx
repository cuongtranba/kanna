import { useCallback, type ReactNode } from "react"
import { Pause, Pencil, Play, X } from "lucide-react"
import { hasActiveRun, type CronJobPatch, type CronJobSnapshot } from "../../shared/cron/types"
import { humanizeSchedule } from "../../shared/cron/humanize"
import { CronPausedPill, CronRunStatusPill } from "../components/messages/CronRunMessage"
import { HoverHint } from "../components/ui/truncated-text"
import { formatCompactDuration, formatLiveDuration } from "../lib/formatDuration"
import { useNow } from "../hooks/useNow"
import { cn } from "../lib/utils"
import { CronJobEditDialog } from "./CronJobEditDialog"
import { CronJobRowStore } from "./CronJobRow.store"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface Props {
  job: CronJobSnapshot
  /** The ARMING chat — every cron command is addressed to it. */
  chatId: string
  /** The global page's link into the arming chat; the per-chat panel has none. */
  trailing?: ReactNode
  divider: boolean
}

const ICON_BUTTON_CLASS = "rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"

const EDIT_BLOCKED_REASON = "cannot edit while a run is in flight"

function CronJobRowContent({ job, chatId, trailing, divider }: Props) {
  const now = useNow(1_000)
  const socket = useOptionalKannaSocket()
  const editing = CronJobRowStore.useScopedStore((state) => state.editing)
  const openEditor = CronJobRowStore.useScopedStore((state) => state.openEditor)
  const setEditing = CronJobRowStore.useScopedStore((state) => state.setEditing)

  const send = useCallback(
    (command: { type: "cron.pause" | "cron.resume" | "cron.remove"; chatId: string; jobId: string }) => {
      void socket?.command(command).catch(() => {})
    },
    [socket],
  )

  const handlePause = useCallback(() => {
    send({ type: "cron.pause", chatId, jobId: job.jobId })
  }, [chatId, job.jobId, send])

  const handleResume = useCallback(() => {
    send({ type: "cron.resume", chatId, jobId: job.jobId })
  }, [chatId, job.jobId, send])

  const handleRemove = useCallback(() => {
    send({ type: "cron.remove", chatId, jobId: job.jobId })
  }, [chatId, job.jobId, send])

  const handleEdit = useCallback(() => {
    // `aria-disabled` leaves the button clickable, so the guard has to be here
    // as well as on the attribute — the server would refuse the update anyway,
    // in a chat the user may not be looking at.
    if (hasActiveRun(job)) return
    openEditor()
  }, [job, openEditor])

  const handleSave = useCallback(
    (patch: CronJobPatch) => {
      void socket?.command({ type: "cron.update", chatId, jobId: job.jobId, patch }).catch(() => {})
    },
    [chatId, job.jobId, socket],
  )

  const elapsedMs = now - job.armedAt
  const activeRun = job.lastRun?.status === "running" ? job.lastRun : null
  // The server refuses an update mid-run and reports it as a cron_command_error
  // in the ARMING chat — which the global page never shows. Disabling here is
  // what keeps that refusal from being invisible.
  const runInFlight = hasActiveRun(job)

  return (
    <div className={cn("flex items-center gap-3 bg-background px-4 py-2.5", divider && "border-b border-border")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-foreground">{job.instruction}</span>
          {job.paused ? <CronPausedPill /> : null}
          {!job.paused && job.lastRun ? <CronRunStatusPill status={job.lastRun.status} /> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{job.jobId}</span>
          <span>{humanizeSchedule(job.schedule, job.scheduleText)}</span>
          <span>· {job.mode}</span>
          {job.model ? <span className="font-mono">{job.model}</span> : null}
          <HoverHint label={new Date(job.armedAt).toLocaleString()} side="top">
            <span className="tabular-nums">created {formatCompactDuration(elapsedMs)} ago</span>
          </HoverHint>
          {activeRun ? (
            <span className="tabular-nums">running for {formatLiveDuration(now - activeRun.firedAt)}</span>
          ) : null}
          {job.paused && job.lastRun ? (
            <span className="tabular-nums">
              Last run: <CronRunStatusPill status={job.lastRun.status} />
            </span>
          ) : null}
          {!job.paused && job.nextFireAt !== null ? (
            <span className="tabular-nums">next in {formatLiveDuration(Math.max(0, job.nextFireAt - now))}</span>
          ) : null}
          {trailing}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1">
        {/* `aria-disabled` rather than `disabled`: a disabled button emits no
            pointer events, so the tooltip explaining WHY it is unavailable
            would never open on the one state that needs explaining. The reason
            also rides the accessible name, because Radix mounts the tooltip
            content only while open — a screen reader would otherwise be told
            the control is unavailable and never told why. */}
        <HoverHint label={runInFlight ? EDIT_BLOCKED_REASON : "Edit cron job"} side="top">
          <button
            type="button"
            aria-label={`Edit cron job ${job.jobId}${runInFlight ? ` — ${EDIT_BLOCKED_REASON}` : ""}`}
            aria-disabled={runInFlight}
            className={cn(
              ICON_BUTTON_CLASS,
              runInFlight && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground",
            )}
            onClick={handleEdit}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </HoverHint>
        {job.paused ? (
          <button
            type="button"
            aria-label={`Resume cron job ${job.jobId}`}
            className={ICON_BUTTON_CLASS}
            onClick={handleResume}
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Pause cron job ${job.jobId}`}
            className={ICON_BUTTON_CLASS}
            onClick={handlePause}
          >
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove cron job ${job.jobId}`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-destructive"
          onClick={handleRemove}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </span>
      {/* Mounted only while open, and keyed by the job's arming, so the form
          always initializes from the current job without an effect. */}
      {editing ? (
        <CronJobEditDialog
          key={`${job.jobId} ${String(job.armedAt)}`}
          job={job}
          open
          onOpenChange={setEditing}
          onSave={handleSave}
        />
      ) : null}
    </div>
  )
}

/**
 * One armed cron job: schedule (humanized), run mode, next-fire countdown, last
 * run status, and the pause / resume / edit / remove controls.
 *
 * Rendered by BOTH cron surfaces — the global `/cron` page and the per-chat
 * footer panel — which were previously two hand-maintained copies of the same
 * markup. The row owns its own socket rather than taking callbacks, so a new
 * control costs nothing at either call site; `BackgroundTasksSection` sets the
 * same precedent.
 *
 * Display model: schedule lifecycle (paused/active) takes precedence over run
 * execution status. A paused job shows the Paused pill as its primary
 * indicator; any last-run status is rendered as a clearly-labeled secondary so
 * it cannot override the schedule state.
 */
export function CronJobRow(props: Props) {
  return (
    <CronJobRowStore.Provider init={undefined}>
      <CronJobRowContent {...props} />
    </CronJobRowStore.Provider>
  )
}
