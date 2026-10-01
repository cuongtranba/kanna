import { memo, useMemo } from "react"
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import "./flow-diagram.css"
import { flowEdgeType, type FlowNode } from "../../../../shared/genui"
import { useOptionalResolvedTheme } from "../../../hooks/useTheme"
import { cn } from "../../../lib/utils"
import { FlowKindIcon, FlowStatus, flowFileLabel } from "./flow-kinds"
import type { FlowDirection, FlowLayout, FlowPoint } from "./flow-layout"
import type { FlowRendererProps } from "./flow-renderer"

type StepData = {
  node: FlowNode
  direction: FlowDirection
  selected: boolean
}

type GroupData = {
  label: string
}

type RoutedData = {
  points: FlowPoint[]
  labelAt: FlowPoint | null
  flow: boolean
}

const CORNER_RADIUS = 8

function roundedPath(points: readonly FlowPoint[]): string {
  const [first, ...rest] = points
  if (!first || rest.length === 0) return ""
  const segments = [`M ${first.x} ${first.y}`]
  for (let index = 1; index < points.length - 1; index++) {
    const prev = points[index - 1]
    const here = points[index]
    const next = points[index + 1]
    if (!prev || !here || !next) continue
    const inLength = Math.hypot(here.x - prev.x, here.y - prev.y) || 1
    const outLength = Math.hypot(next.x - here.x, next.y - here.y) || 1
    const radius = Math.min(CORNER_RADIUS, inLength / 2, outLength / 2)
    const enter = { x: here.x - ((here.x - prev.x) / inLength) * radius, y: here.y - ((here.y - prev.y) / inLength) * radius }
    const leave = { x: here.x + ((next.x - here.x) / outLength) * radius, y: here.y + ((next.y - here.y) / outLength) * radius }
    segments.push(`L ${enter.x} ${enter.y}`, `Q ${here.x} ${here.y} ${leave.x} ${leave.y}`)
  }
  const last = points[points.length - 1] ?? first
  segments.push(`L ${last.x} ${last.y}`)
  return segments.join(" ")
}

function stepBorderClass(node: FlowNode, selected: boolean): string {
  if (selected) return "border-foreground"
  return node.tone === "negative" ? "border-destructive" : "border-border"
}

const StepNode = memo(({ data }: NodeProps<Node<StepData>>) => {
  const { node, direction, selected } = data
  const across = direction === "LR"
  const file = flowFileLabel(node)
  const terminal = node.kind === "start" || node.kind === "end"
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col justify-center gap-0.5 border bg-card px-3 text-left text-foreground",
        terminal ? "rounded-full px-4" : "rounded-md",
        node.kind === "external" && "border-dashed bg-muted",
        node.kind === "store" && "border-b-2",
        node.kind === "decision" && "border-l-2",
        stepBorderClass(node, selected),
      )}
    >
      <Handle type="target" position={across ? Position.Left : Position.Top} isConnectable={false} />
      <div className="flex min-w-0 items-center gap-1.5">
        <FlowKindIcon node={node} />
        <span className="truncate text-sm font-medium">{node.label}</span>
        {node.status ? (
          <span className="ml-auto pl-1">
            <FlowStatus node={node} />
          </span>
        ) : null}
      </div>
      {node.description ? <div className="truncate pl-5 text-xs text-muted-foreground">{node.description}</div> : null}
      {file ? <div className="truncate pl-5 font-mono text-xs text-muted-foreground">{file}</div> : null}
      <Handle type="source" position={across ? Position.Right : Position.Bottom} isConnectable={false} />
    </div>
  )
})

const GroupNode = memo(({ data }: NodeProps<Node<GroupData>>) => {
  return (
    <div className="h-full w-full rounded-lg border border-dashed border-border bg-muted/50">
      <div className="truncate px-3 py-1.5 text-xs font-medium text-muted-foreground">{data.label}</div>
    </div>
  )
})

const RoutedEdge = memo(({ id, data, label, markerEnd }: EdgeProps<Edge<RoutedData>>) => {
  if (!data) return null
  const path = roundedPath(data.points)
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={0} />
      {data.flow ? <path d={path} className="kanna-flow-run" aria-hidden="true" /> : null}
      {label && data.labelAt ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-sm bg-card px-1 text-xs whitespace-nowrap text-muted-foreground"
            style={{ transform: `translate(-50%, -50%) translate(${data.labelAt.x}px, ${data.labelAt.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
})

const NODE_TYPES = { step: StepNode, group: GroupNode }
const EDGE_TYPES = { routed: RoutedEdge }
const FIT_VIEW_OPTIONS = { padding: 0.08, minZoom: 0.5, maxZoom: 1.25 }
const PRO_OPTIONS = { hideAttribution: false }

const TONE_COLOR = {
  neutral: "var(--muted-foreground)",
  positive: "var(--success)",
  negative: "var(--destructive)",
  attention: "var(--warning)",
  info: "var(--info)",
} as const

function toFlowElements(layout: FlowLayout, selectedId: string | null): { nodes: Node[]; edges: Edge[] } {
  const groups: Node<GroupData>[] = layout.groups.map((group) => ({
    id: `group:${group.id}`,
    type: "group",
    position: { x: group.x, y: group.y },
    width: group.width,
    height: group.height,
    data: { label: group.label },
    zIndex: -1,
    selectable: false,
  }))
  const steps: Node<StepData>[] = layout.nodes.map((placed) => ({
    id: placed.node.id,
    type: "step",
    position: { x: placed.x, y: placed.y },
    width: placed.width,
    height: placed.height,
    data: { node: placed.node, direction: layout.direction, selected: placed.node.id === selectedId },
  }))
  const edges: Edge<RoutedData>[] = layout.edges.filter((routed) => routed.points.length > 1).map((routed) => {
    const flow = flowEdgeType(routed.edge) === "flow"
    const tone = routed.edge.tone ?? (flow ? "info" : "neutral")
    return {
      id: routed.key,
      source: routed.edge.from,
      target: routed.edge.to,
      type: "routed",
      label: routed.edge.label,
      className: cn("kanna-flow-edge", `tone-${tone}`, flow && "is-flow", routed.edge.style === "dashed" && "is-dashed"),
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: TONE_COLOR[tone] },
      data: { points: routed.points, labelAt: routed.labelAt, flow },
    }
  })
  return { nodes: [...groups, ...steps], edges }
}

export default function FlowSurface({ layout, height, label, selectedId, onSelect }: FlowRendererProps) {
  const theme = useOptionalResolvedTheme()
  const { nodes, edges } = useMemo(() => toFlowElements(layout, selectedId), [layout, selectedId])
  return (
    <div className="kanna-flow w-full overflow-hidden rounded-md border border-border" style={{ height }} role="group" aria-label={label}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        colorMode={theme ?? "light"}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        proOptions={PRO_OPTIONS}
        onNodeClick={(_, node) => onSelect(node.type === "step" ? node.id : null)}
        onPaneClick={() => onSelect(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  )
}
