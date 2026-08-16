import { useCallback } from "react"
import { CalendarX2, Check, Copy } from "lucide-react"
import { CopyStateStore } from "./CopyState.store"
import { clipboardAdapter, timerAdapter } from "../../adapters"
import type { ProcessedCronCommandErrorMessage } from "./types"

interface Props {
  message: ProcessedCronCommandErrorMessage
}

/**
 * A `/cron` line that failed hard validation. Shows the precise error
 * (which part, why) and — when the fix was unambiguous — a complete
 * ready-to-send corrected command with a copy affordance. Nothing armed.
 */
export function CronCommandErrorMessage({ message }: Props) {
  return (
    <CopyStateStore.Provider init={undefined}>
      <CronCommandErrorMessageInner message={message} />
    </CopyStateStore.Provider>
  )
}

function CronCommandErrorMessageInner({ message }: Props) {
  const copied = CopyStateStore.useScopedStore((s) => s.copied)
  const setCopied = CopyStateStore.useScopedStore((s) => s.setCopied)
  const suggestion = message.suggestion

  const handleCopy = useCallback(async () => {
    if (suggestion === undefined) return
    await clipboardAdapter.writeText(suggestion)
    setCopied(true)
    timerAdapter.setTimeout(() => setCopied(false), 2000)
  }, [suggestion, setCopied])

  return (
    <div className="rounded-lg border border-destructive/30 bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <CalendarX2 className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">Invalid /cron command</span>
      </div>
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
              ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? "Copied" : "Copy fix"}
          </button>
        </div>
      ) : null}
    </div>
  )
}
