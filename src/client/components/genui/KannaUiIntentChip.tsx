import { useMemo } from "react"
import { LayoutDashboard } from "lucide-react"
import { describeIntentPayload } from "../../../shared/genui/intent"

export function KannaUiIntentChip({ source }: { source: string }) {
  const { label, context } = useMemo(() => describeIntentPayload(source), [source])
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
