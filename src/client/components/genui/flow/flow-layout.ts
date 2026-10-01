import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api"
import type { FlowDiagramProps, FlowEdge, FlowNode } from "../../../../shared/genui"
import { domAdapter } from "../../../adapters/dom.adapter"

export type FlowDirection = "LR" | "TB"

export interface FlowPoint {
  x: number
  y: number
}

export interface FlowBox {
  x: number
  y: number
  width: number
  height: number
}

export interface FlowLayoutNode extends FlowBox {
  node: FlowNode
}

export interface FlowLayoutGroup extends FlowBox {
  id: string
  label: string
}

export interface FlowLayoutEdge {
  key: string
  edge: FlowEdge
  points: FlowPoint[]
  labelAt: FlowPoint | null
}

export interface FlowLayout {
  direction: FlowDirection
  width: number
  height: number
  groups: FlowLayoutGroup[]
  nodes: FlowLayoutNode[]
  edges: FlowLayoutEdge[]
}

export const FLOW_HEIGHT = { sm: 280, md: 420, lg: 600 } as const

const NOMINAL_WIDTH = 720
const GROUP_HEADER = 30
const GROUP_PAD = 14
const NODE_MIN_WIDTH = 132
const NODE_MAX_WIDTH = 300
const NODE_CHROME = 50
const TERMINAL_CHROME = 8
const NODE_ROW = 16
const NODE_BASE_HEIGHT = 38
const STATUS_CHROME = 24

function bodyFont(): string {
  return domAdapter.getCssVar("--kanna-font-body", "system-ui, sans-serif")
}

function monoFont(): string {
  return domAdapter.getCssVar("--kanna-font-mono", "ui-monospace, monospace")
}

function textWidth(text: string, font: string, perChar: number): number {
  return domAdapter.measureTextWidth(text, font) ?? text.length * perChar
}

function fileName(path: string, line: number | undefined): string {
  const name = path.split("/").pop() ?? path
  return line ? `${name}:${line}` : name
}

export function flowNodeSize(node: FlowNode): { width: number; height: number } {
  const body = bodyFont()
  const label = textWidth(node.label, `500 14px ${body}`, 7.6)
  const status = node.status ? textWidth(node.status, `500 12px ${body}`, 6.4) + STATUS_CHROME : 0
  const description = node.description ? textWidth(node.description, `12px ${body}`, 6.2) : 0
  const path = node.path ? textWidth(fileName(node.path, node.line), `12px ${monoFont()}`, 7.2) : 0
  const content = Math.max(label + status, description, path)
  return {
    width: Math.round(Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, content + NODE_CHROME + (node.kind === "start" || node.kind === "end" ? TERMINAL_CHROME : 0)))),
    height: NODE_BASE_HEIGHT + (node.description ? NODE_ROW : 0) + (node.path ? NODE_ROW : 0),
  }
}

function edgeKey(index: number): string {
  return `e${index}`
}

function elkGraph(diagram: FlowDiagramProps, direction: FlowDirection): ElkNode {
  const leaf = (node: FlowNode): ElkNode => ({ id: node.id, ...flowNodeSize(node) })
  const groupIds = new Set((diagram.groups ?? []).map((group) => group.id))
  const edges: ElkExtendedEdge[] = diagram.edges.map((edge, index) => ({
    id: edgeKey(index),
    sources: [edge.from],
    targets: [edge.to],
    ...(edge.label ? { labels: [{ text: edge.label, width: textWidth(edge.label, `12px ${bodyFont()}`, 6.4) + 10, height: 18 }] } : {}),
  }))
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "LR" ? "RIGHT" : "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.json.edgeCoords": "ROOT",
      "elk.edgeLabels.inline": "true",
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "52",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: [
      ...(diagram.groups ?? []).map((group) => ({
        id: group.id,
        layoutOptions: { "elk.padding": `[top=${GROUP_HEADER + 8},left=${GROUP_PAD},bottom=${GROUP_PAD},right=${GROUP_PAD}]` },
        children: diagram.nodes.filter((node) => node.group === group.id).map(leaf),
      })).filter((group) => group.children.length > 0),
      ...diagram.nodes.filter((node) => node.group === undefined || !groupIds.has(node.group)).map(leaf),
    ],
    edges,
  }
}

function readLayout(diagram: FlowDiagramProps, direction: FlowDirection, result: ElkNode): FlowLayout {
  const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]))
  const groupLabels = new Map((diagram.groups ?? []).map((group) => [group.id, group.label]))
  const groups: FlowLayoutGroup[] = []
  const nodes: FlowLayoutNode[] = []
  const place = (shape: ElkNode, offset: FlowPoint) => {
    const box = { x: offset.x + (shape.x ?? 0), y: offset.y + (shape.y ?? 0), width: shape.width ?? 0, height: shape.height ?? 0 }
    const node = nodesById.get(shape.id)
    if (node) {
      nodes.push({ ...box, node })
      return
    }
    groups.push({ ...box, id: shape.id, label: groupLabels.get(shape.id) ?? shape.id })
    for (const child of shape.children ?? []) place(child, { x: box.x, y: box.y })
  }
  for (const child of result.children ?? []) place(child, { x: 0, y: 0 })

  const routed = new Map((result.edges ?? []).map((edge) => [edge.id, edge]))
  const edges = diagram.edges.map((edge, index): FlowLayoutEdge => {
    const section = routed.get(edgeKey(index))?.sections?.[0]
    const label = routed.get(edgeKey(index))?.labels?.[0]
    return {
      key: edgeKey(index),
      edge,
      points: section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] : [],
      labelAt: label?.x !== undefined && label.y !== undefined ? { x: label.x + (label.width ?? 0) / 2, y: label.y + (label.height ?? 0) / 2 } : null,
    }
  })
  return { direction, width: result.width ?? 0, height: result.height ?? 0, groups, nodes, edges }
}

async function layoutOnce(diagram: FlowDiagramProps, direction: FlowDirection): Promise<FlowLayout> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js")
  const result = await new ELK().layout(elkGraph(diagram, direction))
  return readLayout(diagram, direction, result)
}

function fitScale(layout: FlowLayout, height: number): number {
  if (layout.width === 0 || layout.height === 0) return 1
  return Math.min(NOMINAL_WIDTH / layout.width, height / layout.height)
}

export async function layoutFlowDiagram(diagram: FlowDiagramProps): Promise<FlowLayout> {
  await domAdapter.whenFontsReady()
  const direction = diagram.direction ?? "auto"
  if (direction !== "auto") return await layoutOnce(diagram, direction)
  const height = FLOW_HEIGHT[diagram.height ?? "md"]
  const [across, down] = await Promise.all([layoutOnce(diagram, "LR"), layoutOnce(diagram, "TB")])
  return fitScale(across, height) >= fitScale(down, height) ? across : down
}
