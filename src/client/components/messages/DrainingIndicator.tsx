import { Loader2, X } from "lucide-react"
import { MetaRow, MetaContent } from "./shared"
import { AnimatedShinyText } from "../ui/animated-shiny-text"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../stores/pendingActionsStore"
import { Spinner } from "../ui/spinner"
import { cn } from "../../lib/utils"

interface DrainingIndicatorProps {
  chatId: string | null
  onStop: () => Promise<void>
}

export function DrainingIndicator({ chatId, onStop }: DrainingIndicatorProps) {
  const stopKey = pendingActionKey("chat.stopDraining", chatId ?? "")
  const stopPending = usePendingAction(stopKey)
  return (
    <MetaRow className="ml-[1px]">
      <MetaContent>
        <div className="group/draining relative flex items-center gap-1.5">
          <div className={cn("flex items-center gap-1.5 group-hover/draining:opacity-0 transition-opacity", stopPending && "opacity-0")}>
            <Loader2 className="size-4.5 animate-spin text-muted-icon" />
            <AnimatedShinyText className="ml-[1px] text-sm" shimmerWidth={44}>
              Running...
            </AnimatedShinyText>
          </div>
          <button
            type="button"
            onClick={() => runPendingAction(stopKey, onStop)}
            disabled={stopPending}
            aria-busy={stopPending || undefined}
            className={cn(
              "absolute inset-0 flex items-center gap-1.5 opacity-0 group-hover/draining:opacity-100 transition-opacity cursor-pointer disabled:cursor-default",
              stopPending && "opacity-100",
            )}
          >
            {stopPending
              ? <Spinner className="size-4.5 text-muted-foreground" />
              : <X className="size-4.5 text-muted-foreground" />}
            <span className="text-sm text-muted-foreground">
              {stopPending ? "Stopping…" : "Stop"}
            </span>
          </button>
        </div>
      </MetaContent>
    </MetaRow>
  )
}
