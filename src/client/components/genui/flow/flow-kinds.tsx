import { Database, Diamond, Globe, Play, RectangleHorizontal, Square, type LucideIcon } from "lucide-react"
import type { FlowNode } from "../../../../shared/genui"
import { cn } from "../../../lib/utils"
import { toneInkClass, type Tone } from "../components/primitives"

type FlowNodeKind = NonNullable<FlowNode["kind"]>

export const FLOW_KIND: Readonly<Record<FlowNodeKind, { icon: LucideIcon; label: string }>> = {
  start: { icon: Play, label: "Start" },
  end: { icon: Square, label: "End" },
  process: { icon: RectangleHorizontal, label: "Step" },
  decision: { icon: Diamond, label: "Decision" },
  store: { icon: Database, label: "Store" },
  external: { icon: Globe, label: "External" },
}

const TONE_MARK: Readonly<Record<Tone, string>> = {
  neutral: "bg-muted-foreground",
  positive: "bg-success",
  negative: "bg-destructive",
  attention: "bg-warning",
  info: "bg-info",
}

export function FlowKindIcon({ node, className }: { node: FlowNode; className?: string }) {
  const kind = FLOW_KIND[node.kind ?? "process"]
  const Icon = kind.icon
  return <Icon className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} aria-label={kind.label} />
}

export function FlowStatus({ node }: { node: FlowNode }) {
  if (!node.status) return null
  const tone = node.tone ?? "neutral"
  return (
    <span className={cn("flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap tabular-nums", toneInkClass(tone))}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_MARK[tone])} aria-hidden="true" />
      {node.status}
    </span>
  )
}

export function flowFileLabel(node: FlowNode): string | null {
  if (!node.path) return null
  const name = node.path.split("/").pop() ?? node.path
  return node.line ? `${name}:${node.line}` : name
}
