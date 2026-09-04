import { useCallback } from "react"
import { CalendarClock, Check, Copy, Trash2 } from "lucide-react"
import { CopyStateStore } from "./CopyState.store"
import { clipboardAdapter, timerAdapter } from "../../adapters"
import { TruncatedText } from "../ui/truncated-text"
import type { ProcessedCronArmedMessage } from "./types"

interface Props {
  message: ProcessedCronArmedMessage
  onRemove?: (jobId: string) => void
}

export function CronArmedMessage({ message, onRemove }: Props) {
  return (
    <CopyStateStore.Provider init={undefined}>
      <CronArmedMessageInner message={message} onRemove={onRemove} />
    </CopyStateStore.Provider>
  )
}

function CronArmedMessageInner({ message, onRemove }: Props) {
  const copied = CopyStateStore.useScopedStore((s) => s.copied)
  const setCopied = CopyStateStore.useScopedStore((s) => s.setCopied)

  const editCommand = `/cron ${message.instruction} ${message.mode} ${message.scheduleText}`

  const handleCopyEdit = useCallback(async () => {
    await clipboardAdapter.writeText(editCommand)
    setCopied(true)
    timerAdapter.setTimeout(() => setCopied(false), 2000)
  }, [editCommand, setCopied])

  const fires = message.upcomingFires ?? (message.nextFireAt !== null ? [message.nextFireAt] : [])

  return (
    <div className="px-0.5">
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">Cron job armed</span>
            <span className="font-mono text-xs text-muted-foreground">{message.jobId}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {message.mode === "inline" ? "inline · runs in this chat" : "spawn · new chat per run"}
            </span>
          </div>
        </div>
      </div>

      <TruncatedText tooltip={message.instruction} className="mt-1.5 text-sm text-foreground/90">
        {message.instruction}
      </TruncatedText>

      <div className="mt-2 space-y-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            {message.scheduleHuman}
            {message.scheduleHuman !== message.scheduleText ? (
              <span className="ml-1.5 font-mono opacity-70">{message.scheduleText}</span>
            ) : null}
          </span>
          {message.model ? (
            <span className="font-mono">{message.model}</span>
          ) : null}
          {message.mode === "spawn" && message.cwd ? (
            <TruncatedText tooltip={message.cwd} className="max-w-48" inline>
              <span className="font-mono">{message.cwd}</span>
            </TruncatedText>
          ) : null}
        </div>

        {fires.length > 0 ? (
          <div className="flex flex-col gap-0.5 text-xs tabular-nums text-muted-foreground">
            {fires.map((fireAt, i) => (
              <span key={fireAt}>
                {i === 0 ? "next" : `   ${i + 1}.`} {new Date(fireAt).toLocaleString()}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {message.mode === "inline" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Context is cleared before every run — this chat becomes a monitoring view.
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
          onClick={handleCopyEdit}
        >
          {copied
            ? <Check className="h-3.5 w-3.5 text-success-text" aria-hidden="true" />
            : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Edit"}
        </button>
        {onRemove ? (
          <button
            type="button"
            aria-label={`Disarm cron job ${message.jobId}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-destructive/50 hover:text-destructive"
            onClick={() => onRemove(message.jobId)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Disarm
          </button>
        ) : null}
      </div>
    </div>
  )
}
