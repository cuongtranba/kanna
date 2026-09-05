import { SkipForward } from "lucide-react"
import type { ProcessedCronRunSkippedMessage } from "./types"

interface Props {
  message: ProcessedCronRunSkippedMessage
}

export function CronRunSkippedMessage({ message }: Props) {
  const count = message.missedCount ?? 1
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <SkipForward className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <span className="text-xs tabular-nums">
        {count === 1 ? "Cron run skipped" : `Cron runs skipped ${count}×`}
        <span className="font-mono"> {message.jobId}</span>
        {" — "}
        {describeSkip(message.reason)}
      </span>
    </div>
  )
}

function describeSkip(reason: ProcessedCronRunSkippedMessage["reason"]): string {
  switch (reason) {
    case "chat_busy":
      return "chat was busy"
    case "previous_run_active":
      return "previous run still running"
    case "server_offline":
      return "missed while the server was offline"
  }
}
