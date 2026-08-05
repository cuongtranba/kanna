import { clampPairSizes, normalizeSizes, redistributeToMinimum } from "./sizes"
import { buildTabId } from "./tabTarget"
import {
  collectPanes,
  createGroup,
  createPane,
  createTab,
  detachTab,
  findNearestSiblingPaneId,
  findPaneContainingTab,
  findPanePath,
  getNodeAtPath,
  getTreeDepth,
  insertTabIntoPane,
  replaceNodeAtPath,
} from "./tree"
import {
  DEFAULT_PANE_ID,
  MAX_TREE_DEPTH,
  type NodeIdSource,
  type PaneLayout,
  type PaneNode,
  type PaneTabTarget,
  type SplitPosition,
  isGroup,
  isPane,
} from "./types"

/**
 * Every operation is pure and returns `null` when it changes nothing, so the
 * store can hand back the previous state object and skip a re-render.
 */

function directionOf(position: SplitPosition) {
  return position === "left" || position === "right" ? "horizontal" : "vertical"
}

function insertsAfter(position: SplitPosition) {
  return position === "right" || position === "bottom"
}

function firstPaneId(root: PaneNode): string | null {
  return collectPanes(root)[0]?.id ?? null
}

// ─── Split ──────────────────────────────────────────────────────────────────

export interface SplitPaneArgs {
  tabId: string
  targetPaneId: string
  position: SplitPosition
  ids: NodeIdSource
}

export function splitPane(layout: PaneLayout, args: SplitPaneArgs): PaneLayout | null {
  const { tabId, targetPaneId, position, ids } = args

  const targetPath = findPanePath(layout.root, targetPaneId)
  if (!targetPath) return null
  if (!findPaneContainingTab(layout.root, tabId)) return null

  // Preserve the target even if this detach empties it: splitting a pane's own
  // last tab must not delete the pane we are splitting out of.
  const detached = detachTab(layout.root, tabId, { preserveEmptyPaneId: targetPaneId })
  if (!detached.tab) return null

  // Indices may have shifted if a pane collapsed during the detach.
  const path = findPanePath(detached.root, targetPaneId)
  if (!path) return null

  const direction = directionOf(position)
  const after = insertsAfter(position)
  const newPane = createPane(ids.paneId, [detached.tab], detached.tab.tabId)

  const parentPath = path.slice(0, -1)
  const parent = parentPath.length > 0 || path.length > 0
    ? getNodeAtPath(detached.root, parentPath)
    : null

  let nextRoot: PaneNode

  if (parent && isGroup(parent) && parent.direction === direction) {
    // Same direction: become a sibling and halve the target's share, so the
    // tree stays flat no matter how many times the user splits the same way.
    const index = path.at(-1)!
    const children = [...parent.children]
    const sizes = [...parent.sizes]
    const share = sizes[index] ?? 1 / children.length
    const insertIndex = after ? index + 1 : index

    children.splice(insertIndex, 0, newPane)
    sizes.splice(insertIndex, 0, share / 2)
    sizes[after ? index : index + 1] = share / 2

    nextRoot = replaceNodeAtPath(
      detached.root,
      parentPath,
      createGroup(parent.id, parent.direction, children, sizes),
    )
  } else {
    // Different direction (or at the root): wrap the target in a new group.
    const target = getNodeAtPath(detached.root, path)
    if (!target) return null
    const children = after ? [target, newPane] : [newPane, target]
    nextRoot = replaceNodeAtPath(
      detached.root,
      path,
      createGroup(ids.groupId, direction, children, [0.5, 0.5]),
    )
  }

  // Build-then-reject: measuring the real candidate is simpler and more correct
  // than trying to predict the resulting depth up front.
  if (getTreeDepth(nextRoot) > MAX_TREE_DEPTH) return null

  return { root: nextRoot, focusedPaneId: ids.paneId }
}

// ─── Close ──────────────────────────────────────────────────────────────────

/**
 * Which tab should take focus when `tabId` closes: the one to its right, else
 * the one to its left. Closing a background tab never moves focus.
 */
function closeSuccessorTabId(tabIds: readonly string[], tabId: string): string | null {
  const index = tabIds.indexOf(tabId)
  if (index < 0) return null
  return tabIds[index + 1] ?? (index > 0 ? (tabIds[index - 1] ?? null) : null)
}

export function closeTab(layout: PaneLayout, tabId: string): PaneLayout | null {
  const found = findPaneContainingTab(layout.root, tabId)
  if (!found) return null

  const { pane } = found
  const wasFocused = pane.focusedTabId === tabId
  const successor = wasFocused
    ? closeSuccessorTabId(pane.tabs.map((tab) => tab.tabId), tabId)
    : null
  const fallbackPaneId = findNearestSiblingPaneId(layout.root, pane.id)

  const detached = detachTab(layout.root, tabId)
  const root = detached.root

  // Focus chain: keep the focused pane if it survived, else the nearest sibling
  // of the pane that collapsed, else the first pane, else the default.
  const focusedPaneId =
    layout.focusedPaneId === null
      ? null
      : ((findPanePath(root, layout.focusedPaneId) ? layout.focusedPaneId : null) ??
        (fallbackPaneId && findPanePath(root, fallbackPaneId) ? fallbackPaneId : null) ??
        firstPaneId(root) ??
        DEFAULT_PANE_ID)

  const next: PaneLayout = { root, focusedPaneId }
  if (!successor) return next
  return focusTab(next, successor) ?? next
}

// ─── Move ───────────────────────────────────────────────────────────────────

export function moveTabToPane(
  layout: PaneLayout,
  tabId: string,
  toPaneId: string,
  index?: number,
): PaneLayout | null {
  const source = findPaneContainingTab(layout.root, tabId)
  if (!source) return null
  if (!findPanePath(layout.root, toPaneId)) return null

  const samePane = source.pane.id === toPaneId
  const detached = detachTab(layout.root, tabId, {
    preserveEmptyPaneId: samePane ? toPaneId : undefined,
  })
  if (!detached.tab) return null

  const root = insertTabIntoPane(detached.root, toPaneId, detached.tab, { index })
  if (!root) return null

  return { root, focusedPaneId: toPaneId }
}

// ─── Focus ──────────────────────────────────────────────────────────────────

export function focusTab(layout: PaneLayout, tabId: string): PaneLayout | null {
  const found = findPaneContainingTab(layout.root, tabId)
  if (!found) return null

  const { pane, path } = found
  if (pane.focusedTabId === tabId && layout.focusedPaneId === pane.id) return null

  const root = replaceNodeAtPath(layout.root, path, createPane(pane.id, pane.tabs, tabId))
  return { root, focusedPaneId: pane.id }
}

export function focusPane(layout: PaneLayout, paneId: string): PaneLayout | null {
  if (layout.focusedPaneId === paneId) return null
  if (!findPanePath(layout.root, paneId)) return null
  return { ...layout, focusedPaneId: paneId }
}

// ─── Reorder ────────────────────────────────────────────────────────────────

export function reorderPaneTabs(
  layout: PaneLayout,
  paneId: string,
  orderedTabIds: readonly string[],
): PaneLayout | null {
  const path = findPanePath(layout.root, paneId)
  if (!path) return null
  const pane = getNodeAtPath(layout.root, path)
  if (!pane || !isPane(pane)) return null

  const byId = new Map(pane.tabs.map((tab) => [tab.tabId, tab]))
  const seen = new Set<string>()
  const ordered = []

  for (const tabId of orderedTabIds) {
    const tab = byId.get(tabId)
    if (!tab || seen.has(tabId)) continue
    seen.add(tabId)
    ordered.push(tab)
  }
  // A partial order is legal — anything unmentioned keeps its relative position.
  for (const tab of pane.tabs) {
    if (!seen.has(tab.tabId)) ordered.push(tab)
  }

  const unchanged = ordered.every((tab, index) => tab.tabId === pane.tabs[index]?.tabId)
  if (unchanged) return null

  const root = replaceNodeAtPath(
    layout.root,
    path,
    createPane(pane.id, ordered, pane.focusedTabId),
  )
  return { ...layout, root }
}

// ─── Open ───────────────────────────────────────────────────────────────────

export interface OpenTabResult {
  layout: PaneLayout
  tabId: string
}

/**
 * Open a target, or focus it if it is already open anywhere in the tree.
 *
 * Because the id is derived from the target, this is idempotent — which is what
 * makes the singleton kinds (chat, changes) singletons by construction.
 */
export function openTab(
  layout: PaneLayout,
  target: PaneTabTarget,
  options: { createdAt: number; focus?: boolean } = { createdAt: 0 },
): OpenTabResult | null {
  const tabId = buildTabId(target)
  const focus = options.focus ?? true

  if (findPaneContainingTab(layout.root, tabId)) {
    if (!focus) return { layout, tabId }
    return { layout: focusTab(layout, tabId) ?? layout, tabId }
  }

  const paneId =
    (layout.focusedPaneId && findPanePath(layout.root, layout.focusedPaneId)
      ? layout.focusedPaneId
      : null) ?? firstPaneId(layout.root)
  if (!paneId) return null

  const root = insertTabIntoPane(layout.root, paneId, createTab(target, options.createdAt), {
    focus,
  })
  if (!root) return null

  return { layout: { root, focusedPaneId: focus ? paneId : layout.focusedPaneId }, tabId }
}

// ─── Resize ─────────────────────────────────────────────────────────────────

function findGroupPath(node: PaneNode, groupId: string, path: number[] = []): number[] | null {
  if (isGroup(node)) {
    if (node.id === groupId) return path
    for (const [index, child] of node.children.entries()) {
      const found = findGroupPath(child, groupId, [...path, index])
      if (found) return found
    }
  }
  return null
}

/**
 * Set a group's sizes outright.
 *
 * The resize library reports absolute sizes rather than a delta, so this is the
 * commit path for a finished drag. Sizes are floored and renormalized, which
 * is the structural clamp — `resizeGroup` remains the pairwise one used for
 * keyboard nudges, where only the dragged boundary should move.
 */
export function setGroupSizes(
  layout: PaneLayout,
  groupId: string,
  sizes: readonly number[],
): PaneLayout | null {
  const path = findGroupPath(layout.root, groupId)
  if (!path) return null
  const group = getNodeAtPath(layout.root, path)
  if (!group || !isGroup(group)) return null
  if (sizes.length !== group.children.length) return null

  const next = redistributeToMinimum(normalizeSizes(sizes, group.children.length))
  const unchanged = next.every((size, i) => Math.abs(size - (group.sizes[i] ?? 0)) < 1e-6)
  if (unchanged) return null

  const root = replaceNodeAtPath(
    layout.root,
    path,
    createGroup(group.id, group.direction, group.children, next),
  )
  return { ...layout, root }
}

export function resizeGroup(
  layout: PaneLayout,
  groupId: string,
  index: number,
  deltaRatio: number,
): PaneLayout | null {
  if (deltaRatio === 0 || !Number.isFinite(deltaRatio)) return null

  const path = findGroupPath(layout.root, groupId)
  if (!path) return null
  const group = getNodeAtPath(layout.root, path)
  if (!group || !isGroup(group)) return null

  const sizes = clampPairSizes(group.sizes, index, deltaRatio)
  const unchanged = sizes.every((size, i) => Math.abs(size - (group.sizes[i] ?? 0)) < 1e-9)
  if (unchanged) return null

  const root = replaceNodeAtPath(
    layout.root,
    path,
    createGroup(group.id, group.direction, group.children, sizes),
  )
  return { ...layout, root }
}
