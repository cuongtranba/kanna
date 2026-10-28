import type { LucideIcon } from "lucide-react"
import { formatStartedClock } from "../../lib/formatters"
import { inboundModeLabel } from "../../lib/webhookPresentation"
import type { TranscriptMessageOf } from "../../../shared/types"

type Delivery = TranscriptMessageOf<"webhook_delivery"> | TranscriptMessageOf<"inbound_delivery">

interface Props {
  icon: LucideIcon
  title: string
  name: string
  delivery: Delivery
}

export function DeliveryMessage({ icon: Icon, title, name, delivery }: Props) {
  return (
    <div className="px-0.5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="truncate text-sm text-foreground/90">{name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span>{inboundModeLabel(delivery.mode)}</span>
          <span className="tabular-nums">{formatStartedClock(Date.parse(delivery.timestamp))}</span>
        </span>
      </div>
      {delivery.message ? <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/90">{delivery.message}</p> : null}
      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">delivery {delivery.deliveryId}</p>
    </div>
  )
}
