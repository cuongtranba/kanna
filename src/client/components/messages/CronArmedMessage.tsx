import { CalendarClock } from "lucide-react"
import { formatStartedClock } from "../../lib/formatters"
import type { ProcessedCronArmedMessage } from "./types"

interface Props {
  message: ProcessedCronArmedMessage
}

/**
 * Static confirmation card appended when a `/cron` job arms: what it will
 * do, the humanized schedule, run mode, and the first fire time. The footer
 * Cron Jobs panel is the LIVE surface; this card records the arming moment.
 */
export function CronArmedMessage({ message }: Props) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">Cron job armed</span>
        <span className="font-mono text-xs text-muted-foreground">{message.jobId}</span>
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {message.mode === "inline" ? "inline · runs in this chat" : "spawn · new chat per run"}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-foreground/90">{message.instruction}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {message.scheduleHuman}
          {message.scheduleHuman !== message.scheduleText ? (
            <span className="ml-1.5 font-mono opacity-70">{message.scheduleText}</span>
          ) : null}
        </span>
        {message.nextFireAt !== null ? (
          <span className="tabular-nums">next fire {formatStartedClock(message.nextFireAt)}</span>
        ) : null}
      </div>
      {message.mode === "inline" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Context is cleared before every run — this chat becomes a monitoring view.
        </p>
      ) : null}
    </div>
  )
}
