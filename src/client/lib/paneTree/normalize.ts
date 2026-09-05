import { isJsonObject, type JsonValue } from "../../../shared/json"
import { normalizeTabTarget } from "./tabTarget"
import { collectPanes, createDefaultLayout, createGroup, createPane, createTab } from "./tree"
import {
  DEFAULT_PANE_ID,
  MAX_TREE_DEPTH,
  type PaneLayout,
  type PaneNode,
  type PaneTab,
  type SplitDirection,
} from "./types"


function fallbackId(prefix: string, path: string): string {
  return `${prefix}-recovered-${path || "root"}`
}

function readString(value: JsonValue): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function readDirection(value: JsonValue): SplitDirection {
  return value === "vertical" ? "vertical" : "horizontal"
}

function readNumber(value: JsonValue): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readTabs(value: JsonValue): PaneTab[] {
  if (!Array.isArray(value)) return []

  const tabs: PaneTab[] = []
  for (const entry of value) {
    if (!isJsonObject(entry)) continue
    const target = normalizeTabTarget(entry.target)
    if (!target) continue

    tabs.push(createTab(target, readNumber(entry.createdAt) ?? 0))
  }
  return tabs
}

function readSizes(value: JsonValue): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const sizes: number[] = []
  for (const entry of value) {
    const size = readNumber(entry)
    if (size !== null) sizes.push(size)
  }
  return sizes
}

function readNode(value: JsonValue | undefined, depth: number, path: string): PaneNode | null {
  if (value === undefined || !isJsonObject(value)) return null

  const id = readString(value.id)

  if (value.kind === "pane") {
    return createPane(id ?? fallbackId("pane", path), readTabs(value.tabs), readString(value.focusedTabId))
  }

  if (value.kind !== "group") return null
  if (!Array.isArray(value.children)) return null

  if (depth >= MAX_TREE_DEPTH) {
    const panes = value.children
      .map((child, index) => readNode(child, depth, `${path}.${index}`))
      .filter((child): child is PaneNode => child !== null)
      .flatMap(collectPanes)
    const first = panes[0]
    if (!first) return null
    return createPane(first.id, panes.flatMap((pane) => pane.tabs))
  }

  const children = value.children
    .map((child, index) => readNode(child, depth + 1, `${path}.${index}`))
    .filter((child): child is PaneNode => child !== null)
  if (children.length === 0) return null

  return createGroup(
    id ?? fallbackId("group", path),
    readDirection(value.direction),
    children,
    readSizes(value.sizes),
  )
}

function resolveFocusedPaneId(value: JsonValue, panes: readonly PaneNode[]): string | null {
  if (value === null) return null
  const requested = readString(value)
  if (requested && panes.some((pane) => pane.id === requested)) return requested
  return panes[0]?.id ?? DEFAULT_PANE_ID
}

export function normalizeLayout(value: JsonValue | undefined): PaneLayout {
  if (value === undefined || !isJsonObject(value)) return createDefaultLayout()

  const root = readNode(value.root, 1, "")
  if (!root) return createDefaultLayout()

  const panes = collectPanes(root)
  if (panes.length === 0) return createDefaultLayout()

  return { root, focusedPaneId: resolveFocusedPaneId(value.focusedPaneId, panes) }
}
