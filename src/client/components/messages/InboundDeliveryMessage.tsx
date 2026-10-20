import { Inbox } from "lucide-react"
import { formatStartedClock } from "../../lib/formatters"
import { webhookModeLabel } from "../../lib/webhookPresentation"
import type { ProcessedInboundDeliveryMessage } from "./types"

interface Props {
  message: ProcessedInboundDeliveryMessage
}

export function InboundDeliveryMessage({ message }: Props) {
  return (
    <div className="px-0.5">
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">Inbound</span>
        <span className="truncate text-sm text-foreground/90">{message.sourceName}</span>
        <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span>{webhookModeLabel(message.mode)}</span>
          <span className="tabular-nums">{formatStartedClock(Date.parse(message.timestamp))}</span>
        </span>
      </div>
      {message.message ? <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/90">{message.message}</p> : null}
      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">delivery {message.deliveryId}</p>
    </div>
  )
}
