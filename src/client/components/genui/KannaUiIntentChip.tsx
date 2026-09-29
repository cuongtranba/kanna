import { useMemo } from "react"
import { LayoutDashboard } from "lucide-react"
import { isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../../../shared/json"

const ACTION_LABELS: Readonly<Record<string, string>> = {
  "agent.ask": "Question from a view",
  "agent.investigate": "Investigation request from a view",
  "agent.fix": "Fix request from a view",
  "financial.explainVariance": "Variance explanation request from a report",
}

function describe(payload: JsonValue | null): { label: string; context: JsonObject | null } {
  if (payload === null || !isJsonObject(payload)) return { label: "Context from a view", context: null }
  const action = typeof payload.action === "string" ? payload.action : ""
  const context = payload.context !== undefined && isJsonObject(payload.context) ? payload.context : null
  return { label: ACTION_LABELS[action] ?? "Context from a view", context }
}

export function KannaUiIntentChip({ source }: { source: string }) {
  const { label, context } = useMemo(() => describe(safeJsonParse(source)), [source])
  return (
    <details className="not-prose my-1 w-fit max-w-full rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer select-none items-center gap-1.5">
        <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </summary>
      {context ? <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify(context, null, 2)}</pre> : null}
    </details>
  )
}
