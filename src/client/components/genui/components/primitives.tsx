import type { ReactNode } from "react"
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, Minus, ShieldQuestion, XCircle } from "lucide-react"
import type { Sentiment, Trend } from "../../../../shared/genui"
import { Button } from "../../ui/button"
import { Spinner } from "../../ui/spinner"
import { cn } from "../../../lib/utils"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../../stores/pendingActionsStore"
import { useGenUIHost } from "../host"
import { GENUI_DATASET_QUERY_KEY, type DatasetState } from "../useDatasetQuery"
import { useQueryClient } from "@tanstack/react-query"

export type Tone = "neutral" | "positive" | "negative" | "attention" | "info"

const TONE_INK: Readonly<Record<Tone, string>> = {
  neutral: "text-muted-foreground",
  positive: "text-success-text",
  negative: "text-destructive-text",
  attention: "text-warning-text",
  info: "text-info-text",
}

export function toneInkClass(tone: Tone): string {
  return TONE_INK[tone]
}

export function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  const iconClass = cn("h-3.5 w-3.5 shrink-0", className)
  switch (tone) {
    case "positive":
      return <CheckCircle2 className={iconClass} aria-hidden="true" />
    case "negative":
      return <XCircle className={iconClass} aria-hidden="true" />
    case "attention":
      return <AlertTriangle className={iconClass} aria-hidden="true" />
    case "info":
      return <Info className={iconClass} aria-hidden="true" />
    case "neutral":
      return <Minus className={iconClass} aria-hidden="true" />
  }
}

export function sentimentTone(sentiment: Sentiment): Tone {
  if (sentiment === "positive") return "positive"
  if (sentiment === "negative") return "negative"
  return "neutral"
}

export function TrendIcon({ trend, className }: { trend: Trend; className?: string }) {
  const iconClass = cn("h-3.5 w-3.5 shrink-0", className)
  if (trend === "up") return <ArrowUpRight className={iconClass} aria-hidden="true" />
  if (trend === "down") return <ArrowDownRight className={iconClass} aria-hidden="true" />
  return <Minus className={iconClass} aria-hidden="true" />
}

export function PropsIssue({ component }: { component: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      {component} could not be shown: its settings changed to an unsupported value
    </p>
  )
}

function ApproveToolButton({ server, tool }: { server: string; tool: string }) {
  const host = useGenUIHost()
  const queryClient = useQueryClient()
  const key = pendingActionKey("genui.dataset.approve", host.chatId ?? "", server, tool)
  const pending = usePendingAction(key)
  const approve = host.approveTool
  if (!approve) return null
  const handleApprove = () => {
    runPendingAction(key, async () => {
      await approve(server, tool)
      await queryClient.invalidateQueries({ queryKey: [GENUI_DATASET_QUERY_KEY, host.chatId] })
    })
  }
  return (
    <Button size="sm" variant="outline" pending={pending} onClick={handleApprove}>
      Allow for this chat
    </Button>
  )
}

export function DataStateNotice({ state, minHeight, emptyLabel }: { state: Exclude<DatasetState, { status: "ok" }>; minHeight?: number; emptyLabel?: string }) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed border-border px-3 py-4 text-sm" style={minHeight ? { minHeight } : undefined}>
      <DataStateBody state={state} emptyLabel={emptyLabel} />
    </div>
  )
}

function DataStateBody({ state, emptyLabel }: { state: Exclude<DatasetState, { status: "ok" }>; emptyLabel?: string }): ReactNode {
  switch (state.status) {
    case "loading":
      return (
        <span className="flex items-center gap-2 text-muted-foreground" role="status">
          <Spinner /> Loading data…
        </span>
      )
    case "needs_approval":
      return (
        <span className="flex flex-col items-center gap-2 text-center text-muted-foreground">
          <span className="flex items-center gap-1.5 text-foreground">
            <ShieldQuestion className="h-4 w-4" aria-hidden="true" />
            Action requires approval
          </span>
          <span className="max-w-prose text-xs">{state.message}</span>
          <ApproveToolButton server={state.server} tool={state.tool} />
        </span>
      )
    case "unavailable":
      return <span className="text-muted-foreground">{emptyLabel ?? state.message}</span>
    case "error":
      return (
        <span className="flex items-center gap-1.5 text-destructive-text" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {state.message}
        </span>
      )
  }
}

export function EmptyNotice({ label, minHeight }: { label: string; minHeight?: number }) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground" style={minHeight ? { minHeight } : undefined}>
      {label}
    </div>
  )
}
