import { CalendarClock } from "lucide-react"
import type { ProcessedCronJobChangeMessage } from "./types"

interface Props {
  message: ProcessedCronJobChangeMessage
}

export function CronJobChangeMessage({ message }: Props) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <span className="text-xs">
        Cron job
        <span className="font-mono"> {message.jobId} </span>
        {message.change}
      </span>
    </div>
  )
}
