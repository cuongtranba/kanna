import { useCallback, type ReactNode } from "react"
import { Pause, Pencil, Play, X } from "lucide-react"
import { hasActiveRun, type CronJobPatch, type CronJobSnapshot } from "../../shared/cron/types"
import { errorMessage } from "../../shared/errors"
import type { ClientCommand } from "../../shared/protocol"
import { humanizeSchedule } from "../../shared/cron/humanize"
import { CronPausedPill, CronRunStatusPill } from "../components/messages/CronRunMessage"
import { Spinner } from "../components/ui/spinner"
import { HoverHint } from "../components/ui/truncated-text"
import { formatCompactDuration, formatLiveDuration } from "../lib/formatDuration"
import { useNow } from "../hooks/useNow"
import { cn } from "../lib/utils"
import { useKannaStateStore } from "../stores/kannaStateStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { CronJobEditDialog } from "./CronJobEditDialog"
import { CronJobRowStore } from "./CronJobRow.store"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface Props {
  job: CronJobSnapshot
  chatId: string
  trailing?: ReactNode
  divider: boolean
}

const ICON_BUTTON_CLASS = "rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"

const EDIT_BLOCKED_REASON = "cannot edit while a run is in flight"

type CronRowCommandType = "cron.pause" | "cron.resume" | "cron.remove"

function cronRowActionKey(type: CronRowCommandType, chatId: string, jobId: string): string {
  return pendingActionKey(type, chatId, jobId)
}

async function sendCronCommand(socket: ReturnType<typeof useOptionalKannaSocket>, command: ClientCommand): Promise<void> {
  if (!socket) return
  try {
    await socket.command(command)
    useKannaStateStore.getState().setCommandError(null)
  } catch (error) {
    useKannaStateStore.getState().setCommandError(errorMessage(error))
    throw error
  }
}

function CronJobRowContent({ job, chatId, trailing, divider }: Props) {
  const now = useNow(1_000)
  const socket = useOptionalKannaSocket()
  const editing = CronJobRowStore.useScopedStore((state) => state.editing)
  const openEditor = CronJobRowStore.useScopedStore((state) => state.openEditor)
  const setEditing = CronJobRowStore.useScopedStore((state) => state.setEditing)

  const pauseKey = cronRowActionKey("cron.pause", chatId, job.jobId)
  const resumeKey = cronRowActionKey("cron.resume", chatId, job.jobId)
  const removeKey = cronRowActionKey("cron.remove", chatId, job.jobId)
  const pausePending = usePendingAction(pauseKey)
  const resumePending = usePendingAction(resumeKey)
  const removePending = usePendingAction(removeKey)

  const send = useCallback(
    (command: { type: CronRowCommandType; chatId: string; jobId: string }) => {
      runPendingAction(cronRowActionKey(command.type, command.chatId, command.jobId), () => sendCronCommand(socket, command))
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
    if (hasActiveRun(job)) return
    openEditor()
  }, [job, openEditor])

  const handleSave = useCallback(
    (patch: CronJobPatch) => sendCronCommand(socket, { type: "cron.update", chatId, jobId: job.jobId, patch }),
    [chatId, job.jobId, socket],
  )

  const elapsedMs = now - job.armedAt
  const activeRun = job.lastRun?.status === "running" ? job.lastRun : null
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
            disabled={resumePending}
            aria-busy={resumePending || undefined}
            onClick={handleResume}
          >
            {resumePending ? <Spinner /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Pause cron job ${job.jobId}`}
            className={ICON_BUTTON_CLASS}
            disabled={pausePending}
            aria-busy={pausePending || undefined}
            onClick={handlePause}
          >
            {pausePending ? <Spinner /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove cron job ${job.jobId}`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-destructive"
          disabled={removePending}
          aria-busy={removePending || undefined}
          onClick={handleRemove}
        >
          {removePending ? <Spinner /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </span>
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

export function CronJobRow(props: Props) {
  return (
    <CronJobRowStore.Provider init={undefined}>
      <CronJobRowContent {...props} />
    </CronJobRowStore.Provider>
  )
}
