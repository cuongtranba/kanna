import { lazy, Suspense, useCallback, useId, useMemo } from "react"
import type { ComponentRenderProps } from "@json-render/react"
import { useQuery } from "@tanstack/react-query"
import { FileCode2, MessageSquareText, X } from "lucide-react"
import {
  contentHash,
  flowEdgeType,
  flowNodeContext,
  flowOutline,
  GENUI_COMPONENTS,
  type FlowDiagramProps,
  type FlowLink,
  type FlowNode,
  type FlowOutlineEntry,
} from "../../../../shared/genui"
import type { JsonObject, JsonValue } from "../../../../shared/json"
import { Button } from "../../ui/button"
import { SegmentedControl } from "../../ui/segmented-control"
import { Spinner } from "../../ui/spinner"
import { cn } from "../../../lib/utils"
import { FLOW_KIND, FlowKindIcon, FlowStatus } from "../flow/flow-kinds"
import { FLOW_HEIGHT, layoutFlowDiagram } from "../flow/flow-layout"
import { useGenUIHost } from "../host"
import { isString, useElementUiState } from "../useElementUiState"
import { EmptyNotice, PropsIssue } from "./primitives"
import { resolvedProps } from "./props"
import { useRunAction } from "./records"

const LazyFlowSurface = lazy(() => import("../flow/FlowSurface"))

const FLOW_LAYOUT_QUERY_KEY = "genui-flow-layout"

function isFlowView(value: JsonValue | undefined): value is "diagram" | "outline" {
  return value === "diagram" || value === "outline"
}

function parseFlowProps(props: ComponentRenderProps["element"]["props"]): FlowDiagramProps | null {
  const json = resolvedProps(props)
  if (!json) return null
  const parsed = GENUI_COMPONENTS.FlowDiagram.props.safeParse(json)
  return parsed.success ? parsed.data : null
}

function useFlowLayout(diagram: FlowDiagramProps) {
  return useQuery({
    queryKey: [FLOW_LAYOUT_QUERY_KEY, contentHash(JSON.stringify(diagram))],
    queryFn: async () => await layoutFlowDiagram(diagram),
    staleTime: Infinity,
    retry: false,
  })
}

function summary(diagram: FlowDiagramProps): string {
  const live = diagram.edges.filter((edge) => flowEdgeType(edge) === "flow").length
  const steps = `${diagram.nodes.length} ${diagram.nodes.length === 1 ? "step" : "steps"}`
  const connections = `${diagram.edges.length} ${diagram.edges.length === 1 ? "connection" : "connections"}`
  return live > 0 ? `${steps} · ${connections} · ${live} live` : `${steps} · ${connections}`
}

function LinkList({ heading, links, direction }: { heading: string; links: readonly FlowLink[]; direction: "in" | "out" }) {
  if (links.length === 0) return null
  return (
    <p className="text-xs text-muted-foreground">
      <span>{heading} </span>
      {links.map((link, index) => (
        <span key={`${direction}-${link.node.id}-${index}`}>
          {index > 0 ? ", " : null}
          <span className="text-foreground">{link.node.label}</span>
          {link.edge.label ? <span> ({link.edge.label})</span> : null}
          {flowEdgeType(link.edge) === "flow" ? <span className="text-info-text"> · live</span> : null}
        </span>
      ))}
    </p>
  )
}

function FlowOutline({ entries, selectedId, onSelect }: { entries: readonly FlowOutlineEntry[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ol className="divide-y divide-border rounded-md border border-border">
      {entries.map((entry, index) => (
        <li key={entry.node.id} className={cn("flex gap-3 px-3 py-2", entry.node.id === selectedId && "bg-muted")}>
          <span className="w-5 shrink-0 pt-0.5 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <FlowKindIcon node={entry.node} />
              <button
                type="button"
                className="rounded-sm text-left text-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-pressed={entry.node.id === selectedId}
                onClick={() => onSelect(entry.node.id)}
              >
                {entry.node.label}
              </button>
              <span className="text-xs text-muted-foreground">{FLOW_KIND[entry.node.kind ?? "process"].label}</span>
              {entry.groupLabel ? <span className="text-xs text-muted-foreground">in {entry.groupLabel}</span> : null}
              <FlowStatus node={entry.node} />
            </div>
            {entry.node.description ? <p className="text-xs text-muted-foreground">{entry.node.description}</p> : null}
            <LinkList heading="From" links={entry.incoming} direction="in" />
            <LinkList heading="To" links={entry.outgoing} direction="out" />
          </div>
        </li>
      ))}
    </ol>
  )
}

function OpenFileButton({ node }: { node: FlowNode & { path: string } }) {
  const params = useMemo((): JsonObject => (node.line ? { path: node.path, line: node.line } : { path: node.path }), [node.line, node.path])
  const { run, pending } = useRunAction("file.open", params, `${node.id}:${node.path}`)
  return (
    <Button size="sm" variant="secondary" className="gap-1.5" pending={pending} onClick={run}>
      {pending ? null : <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />}
      Open file
    </Button>
  )
}

function AskAgentButton({ diagram, node }: { diagram: FlowDiagramProps; node: FlowNode }) {
  const context = useMemo(() => flowNodeContext(diagram, node.id) ?? {}, [diagram, node.id])
  const params = useMemo(() => ({ subject: node.label, context }), [context, node.label])
  const { run, pending } = useRunAction("agent.investigate", params, node.id)
  return (
    <Button size="sm" variant="secondary" className="gap-1.5" pending={pending} onClick={run}>
      {pending ? null : <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />}
      Ask agent
    </Button>
  )
}

function nodeLocation(node: FlowNode): string | null {
  if (!node.path) return null
  return node.line ? `${node.path}:${node.line}` : node.path
}

function hasPath(node: FlowNode): node is FlowNode & { path: string } {
  return node.path !== undefined
}

function NodeDetail({ diagram, entry, onClose }: { diagram: FlowDiagramProps; entry: FlowOutlineEntry; onClose: () => void }) {
  const host = useGenUIHost()
  const { node } = entry
  const location = nodeLocation(node)
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3" aria-label={`Step ${node.label}`}>
      <div className="flex items-start gap-2">
        <FlowKindIcon node={node} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-sm font-medium text-foreground">{node.label}</span>
            <FlowStatus node={node} />
          </div>
          {node.description ? <p className="text-sm text-muted-foreground">{node.description}</p> : null}
          {location ? <p className="font-mono text-xs break-all text-muted-foreground">{location}</p> : null}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close step details">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      <LinkList heading="From" links={entry.incoming} direction="in" />
      <LinkList heading="To" links={entry.outgoing} direction="out" />
      {host.readonly ? null : (
        <div className="flex flex-wrap gap-2">
          {hasPath(node) ? <OpenFileButton node={node} /> : null}
          {host.sendToAgent ? <AskAgentButton diagram={diagram} node={node} /> : null}
        </div>
      )}
    </section>
  )
}

function DiagramCanvas({ diagram, height, label, selectedId, onSelect }: { diagram: FlowDiagramProps; height: number; label: string; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const host = useGenUIHost()
  const layout = useFlowLayout(diagram)
  const Renderer = host.FlowRenderer ?? LazyFlowSurface
  if (layout.error) return <EmptyNotice label="This diagram could not be laid out. The Outline view still lists every step." minHeight={height} />
  if (!layout.data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-md border border-border text-sm text-muted-foreground" style={{ height }} role="status">
        <Spinner /> Laying out diagram…
      </div>
    )
  }
  return (
    <Suspense fallback={<div className="w-full rounded-md border border-border" style={{ height }} aria-hidden="true" />}>
      <Renderer layout={layout.data} height={height} label={label} selectedId={selectedId} onSelect={onSelect} />
    </Suspense>
  )
}

export function FlowDiagramElement({ element }: ComponentRenderProps) {
  const diagram = useMemo(() => parseFlowProps(element.props), [element.props])
  const outline = useMemo(() => (diagram ? flowOutline(diagram) : []), [diagram])
  const [view, setView] = useElementUiState(element, "view", "diagram", isFlowView)
  const [selected, setSelected] = useElementUiState(element, "selected", "", isString)
  const titleId = useId()
  const select = useCallback((id: string | null) => setSelected(id ?? ""), [setSelected])
  const toggle = useCallback((id: string) => setSelected(id === selected ? "" : id), [selected, setSelected])
  const closeDetail = useCallback(() => setSelected(""), [setSelected])

  if (!diagram) return <PropsIssue component="FlowDiagram" />
  const height = FLOW_HEIGHT[diagram.height ?? "md"]
  const selectedEntry = outline.find((entry) => entry.node.id === selected) ?? null
  const label = `Diagram${diagram.title ? ` of ${diagram.title}` : ""}: ${summary(diagram)}. Switch to Outline to read it as a list.`

  return (
    <figure className="flex min-w-0 flex-col gap-2" aria-labelledby={titleId}>
      <figcaption className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div id={titleId} className="text-sm font-medium text-foreground">{diagram.title ?? "Diagram"}</div>
          <div className="text-xs text-muted-foreground tabular-nums">{summary(diagram)}</div>
        </div>
        <SegmentedControl size="sm" value={view} onValueChange={setView} options={[{ value: "diagram", label: "Diagram" }, { value: "outline", label: "Outline" }]} />
      </figcaption>
      {view === "diagram"
        ? <DiagramCanvas diagram={diagram} height={height} label={label} selectedId={selectedEntry?.node.id ?? null} onSelect={select} />
        : <FlowOutline entries={outline} selectedId={selectedEntry?.node.id ?? null} onSelect={toggle} />}
      {selectedEntry ? <NodeDetail diagram={diagram} entry={selectedEntry} onClose={closeDetail} /> : null}
    </figure>
  )
}
