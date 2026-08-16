import { SkipForward } from "lucide-react"
import type { ProcessedCronRunSkippedMessage } from "./types"

interface Props {
  message: ProcessedCronRunSkippedMessage
}

/**
 * Quiet one-line notice for a cron tick that did not run — skip-and-record
 * is the overlap policy, so the monitoring chat always shows the miss.
 */
export function CronRunSkippedMessage({ message }: Props) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <SkipForward className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <span className="text-xs">
        Cron run skipped
        <span className="font-mono"> {message.jobId}</span>
        {" — "}
        {describeSkip(message)}
      </span>
    </div>
  )
}

function describeSkip(message: ProcessedCronRunSkippedMessage): string {
  switch (message.reason) {
    case "chat_busy":
      return "chat was busy"
    case "previous_run_active":
      return "previous run still running"
    case "server_offline": {
      const count = message.missedCount ?? 1
      return `${count} fire${count === 1 ? "" : "s"} missed while the server was offline`
    }
  }
}
