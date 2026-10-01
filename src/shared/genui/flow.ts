import type { JsonObject } from "../json"
import type { FlowDiagramProps, FlowEdge, FlowNode } from "./catalog"

export interface FlowLink {
  node: FlowNode
  edge: FlowEdge
}

export interface FlowOutlineEntry {
  node: FlowNode
  groupLabel: string | null
  incoming: FlowLink[]
  outgoing: FlowLink[]
}

export function flowEdgeType(edge: FlowEdge): "static" | "flow" {
  return edge.type ?? "static"
}

function readingOrder(diagram: FlowDiagramProps): FlowNode[] {
  const indegree = new Map(diagram.nodes.map((node) => [node.id, 0]))
  for (const edge of diagram.edges) {
    if (edge.from !== edge.to) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }
  const placed = new Set<string>()
  const order: FlowNode[] = []
  while (order.length < diagram.nodes.length) {
    const next = diagram.nodes.find((node) => !placed.has(node.id) && indegree.get(node.id) === 0)
      ?? diagram.nodes.find((node) => !placed.has(node.id))
    if (!next) break
    placed.add(next.id)
    order.push(next)
    for (const edge of diagram.edges) {
      if (edge.from === next.id && edge.to !== next.id) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) - 1)
    }
  }
  return order
}

export function flowOutline(diagram: FlowDiagramProps): FlowOutlineEntry[] {
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]))
  const groupLabels = new Map((diagram.groups ?? []).map((group) => [group.id, group.label]))
  const link = (id: string, edge: FlowEdge): FlowLink[] => {
    const node = byId.get(id)
    return node ? [{ node, edge }] : []
  }
  return readingOrder(diagram).map((node) => ({
    node,
    groupLabel: node.group ? groupLabels.get(node.group) ?? null : null,
    incoming: diagram.edges.filter((edge) => edge.to === node.id).flatMap((edge) => link(edge.from, edge)),
    outgoing: diagram.edges.filter((edge) => edge.from === node.id).flatMap((edge) => link(edge.to, edge)),
  }))
}

function linkContext(link: FlowLink): JsonObject {
  return {
    step: link.node.label,
    edge: flowEdgeType(link.edge),
    ...(link.edge.label ? { label: link.edge.label } : {}),
  }
}

export function flowNodeContext(diagram: FlowDiagramProps, nodeId: string): JsonObject | null {
  const entry = flowOutline(diagram).find((candidate) => candidate.node.id === nodeId)
  if (!entry) return null
  const { node } = entry
  return {
    ...(diagram.title ? { diagram: diagram.title } : {}),
    step: node.label,
    ...(node.description ? { description: node.description } : {}),
    ...(node.kind ? { kind: node.kind } : {}),
    ...(node.status ? { status: node.status } : {}),
    ...(entry.groupLabel ? { group: entry.groupLabel } : {}),
    ...(node.path ? { path: node.path } : {}),
    ...(node.line ? { line: node.line } : {}),
    upstream: entry.incoming.map(linkContext),
    downstream: entry.outgoing.map(linkContext),
  }
}
