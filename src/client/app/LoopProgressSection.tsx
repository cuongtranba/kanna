import { Check, CircleDashed, Clock, ListChecks, Loader2, TriangleAlert } from "lucide-react"
import type { LoopProgressSnapshot, LoopRowStatus } from "../../shared/types"
import { formatLocal } from "../lib/autoContinueTime"
import { Button } from "../components/ui/button"
import { cn } from "../lib/utils"

const ROW_STATUS_CONFIG: Record<
  LoopRowStatus,
  { Icon: typeof Check; iconClass: string; textClass: string }
> = {
  done: { Icon: Check, iconClass: "text-success", textClass: "text-muted-foreground" },
  running: { Icon: Loader2, iconClass: "text-foreground animate-spin", textClass: "text-foreground font-medium" },
  pending: { Icon: CircleDashed, iconClass: "text-muted-foreground", textClass: "text-muted-foreground" },
  failed: { Icon: TriangleAlert, iconClass: "text-destructive", textClass: "text-muted-foreground line-through decoration-destructive/40" },
}

interface Props {
  loopProgress: LoopProgressSnapshot
  /** Accept the live rate-limit schedule to resume immediately. */
  onResume?: (scheduleId: string, scheduledAt: number) => void
}

export function LoopProgressSection({ loopProgress, onResume }: Props) {
  const { armed, rows, rateLimit } = loopProgress
  // Nothing to show once a loop was never armed and produced no rows.
  if (!armed && rows.length === 0) return null

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-border overflow-hidden">
        <h3 className="font-medium text-foreground text-sm p-3 px-4 bg-card border-b border-border flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          Progress
          {armed ? (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Loop running
            </span>
          ) : null}
        </h3>

        {rateLimit ? (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/[0.06] border-b border-border">
            <Clock className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
            <span className="text-sm text-foreground">
              {rateLimit.scheduled ? "Resumes" : "Usage limit — resets"} {formatLocal(rateLimit.resetAt, rateLimit.tz)}
            </span>
            {!rateLimit.scheduled && onResume ? (
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                onClick={() => onResume(rateLimit.scheduleId, Date.now())}
              >
                Resume now
              </Button>
            ) : null}
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted-foreground bg-background">
            Waiting for the first chunk…
          </div>
        ) : (
          <div>
            {rows.map((row, index) => {
              const isLast = index === rows.length - 1
              const { Icon, iconClass, textClass } = ROW_STATUS_CONFIG[row.status]
              return (
                <div
                  key={row.runId}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 bg-background",
                    !isLast && "border-b border-border",
                  )}
                >
                  <Icon className={cn("h-4 w-4 flex-shrink-0", iconClass)} />
                  <span className={cn("text-sm truncate", textClass)}>{row.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
