
export type PaneTabTarget =
  | { kind: "chat"; chatId: string }
  | { kind: "changes" }
  | { kind: "terminal"; terminalId: string }
  | { kind: "board"; boardId: string }

export type PaneTabKind = PaneTabTarget["kind"]

export interface PaneTab {
  tabId: string
  target: PaneTabTarget
  createdAt: number
}

export interface PaneLeaf {
  kind: "pane"
  id: string
  tabs: PaneTab[]
  focusedTabId: string | null
}

export type SplitDirection = "horizontal" | "vertical"

export interface PaneGroup {
  kind: "group"
  id: string
  direction: SplitDirection
  children: PaneNode[]
  sizes: number[]
}

export type PaneNode = PaneLeaf | PaneGroup

export interface PaneLayout {
  root: PaneNode
  focusedPaneId: string | null
}

export type SplitPosition = "left" | "right" | "top" | "bottom"

export const MAX_TREE_DEPTH = 4

export const DEFAULT_PANE_ID = "main"

export interface NodeIdSource {
  paneId: string
  groupId: string
}

export function isPane(node: PaneNode): node is PaneLeaf {
  return node.kind === "pane"
}

export function isGroup(node: PaneNode): node is PaneGroup {
  return node.kind === "group"
}
