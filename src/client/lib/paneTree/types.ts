/**
 * The pane tree model.
 *
 * A tab is an ADDRESS, not a view-model: it carries only what is needed to say
 * *what* should be shown. Title, icon, status and dirty state are derived at
 * render time from the target plus the existing stores, so a persisted tab can
 * never hold a stale label.
 */

export type PaneTabTarget =
  /**
   * One chat transcript, addressed by chatId. NOT a singleton: opening a second
   * chat yields a second tab, and each renders its own live transcript from its
   * own `useKannaState(chatId)`.
   */
  | { kind: "chat"; chatId: string }
  /** The git changes / history panel. Singleton. */
  | { kind: "changes" }
  | { kind: "terminal"; terminalId: string }

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
  /** Always a member of `tabs`, or null when the pane is empty. */
  focusedTabId: string | null
}

export type SplitDirection = "horizontal" | "vertical"

export interface PaneGroup {
  kind: "group"
  id: string
  direction: SplitDirection
  children: PaneNode[]
  /** Fractions summing to 1, positionally aligned with `children`. */
  sizes: number[]
}

export type PaneNode = PaneLeaf | PaneGroup

export interface PaneLayout {
  root: PaneNode
  /** null is meaningful: "no pane is focused" (e.g. a modal owns focus). */
  focusedPaneId: string | null
}

/** Where a dropped tab lands relative to the pane it was dropped on. */
export type SplitPosition = "left" | "right" | "top" | "bottom"

/**
 * A pane counts as depth 1; a group is 1 + its deepest child. Capped so the
 * layout stays comprehensible and every pane keeps a usable minimum size.
 */
export const MAX_TREE_DEPTH = 4

/** The id of the pane that always exists in a default layout. */
export const DEFAULT_PANE_ID = "main"

/**
 * Ids for nodes created by an operation are passed IN rather than generated.
 * Keeping the engine free of `crypto.randomUUID()` is what makes every
 * operation deterministic and unit-testable.
 */
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
