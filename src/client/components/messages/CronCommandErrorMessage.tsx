import { useCallback } from "react"
import { CalendarX2, Check, Copy } from "lucide-react"
import { useCopyFeedback } from "../../stores/copyFeedbackStore"
import { runDetached } from "../../lib/runDetached"
import type { TranscriptMessageOf } from "../../../shared/types"

interface Props {
  message: TranscriptMessageOf<"cron_command_error">
}

export function CronCommandErrorMessage({ message }: Props) {
  const { copied, copy } = useCopyFeedback()
  const suggestion = message.suggestion

  const handleCopy = useCallback(() => {
    if (suggestion === undefined) return
    runDetached("copy cron fix", copy(suggestion))
  }, [copy, suggestion])

  return (
    <div className="bg-destructive/10 px-4 py-3">
      <div className="flex items-center gap-2">
        <CalendarX2 className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">Invalid /cron command</span>
      </div>
      {message.input !== undefined ? (
        <code className="mt-1.5 block truncate rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
          {message.input}
        </code>
      ) : null}
      <p className="mt-1.5 text-sm text-foreground/90">{message.message}</p>
      {suggestion !== undefined ? (
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs text-foreground">
            {suggestion}
          </code>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
            onClick={handleCopy}
          >
            {copied
              ? <Check className="h-3.5 w-3.5 text-success-text" aria-hidden="true" />
              : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? "Copied" : "Copy fix"}
          </button>
        </div>
      ) : null}
    </div>
  )
}
