import { AlertTriangle, KeyRound, RotateCw } from "lucide-react"
import type { SubagentErrorCode } from "../../../shared/types"

interface SubagentErrorCardProps {
  error: { code: SubagentErrorCode; message: string }
  runId: string
  subagentId: string | null
  onRetry?: () => void
  onOpenSettings?: () => void
}

function badgeText(code: SubagentErrorCode) {
  switch (code) {
    case "AUTH_REQUIRED": return "Auth required"
    case "UNKNOWN_SUBAGENT": return "Unknown subagent"
    case "LOOP_DETECTED": return "Loop detected"
    case "DEPTH_EXCEEDED": return "Depth exceeded"
    case "TIMEOUT": return "Timeout"
    case "PROVIDER_ERROR": return "Provider error"
  }
}

export function SubagentErrorCard({ error, runId, onRetry, onOpenSettings }: SubagentErrorCardProps) {
  const canRetry = error.code === "TIMEOUT" || error.code === "PROVIDER_ERROR"
  const canOpenSettings = error.code === "AUTH_REQUIRED"
  return (
    <div
      data-testid={`subagent-error:${runId}`}
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
    >
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span>{badgeText(error.code)}</span>
      </div>
      <p className="mt-1 text-foreground">{error.message}</p>
      <div className="mt-2 flex gap-2">
        {canOpenSettings && onOpenSettings && (
          <button type="button" onClick={onOpenSettings} className="inline-flex items-center gap-1 text-xs underline">
            <KeyRound className="h-3 w-3" /> Open settings
          </button>
        )}
        {canRetry && onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-xs underline">
            <RotateCw className="h-3 w-3" /> Retry
          </button>
        )}
      </div>
    </div>
  )
}
