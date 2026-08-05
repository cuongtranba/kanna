import { normalizeSizes, redistributeToMinimum } from "./sizes"
import { buildTabId } from "./tabTarget"
import {
  DEFAULT_PANE_ID,
  type PaneGroup,
  type PaneLayout,
  type PaneLeaf,
  type PaneNode,
  type PaneTab,
  type PaneTabTarget,
  type SplitDirection,
  isGroup,
  isPane,
} from "./types"

// ─── Construction ───────────────────────────────────────────────────────────

export function createTab(target: PaneTabTarget, createdAt: number): PaneTab {
  return { tabId: buildTabId(target), target, createdAt }
}

/**
 * Build a pane, coercing `focusedTabId` to a real member and dropping duplicate
 * tab ids. Every path that changes a pane's tabs goes through here, so the
 * focus-is-a-member invariant cannot be violated by construction.
 */
export function createPane(
  id: string,
  tabs: readonly PaneTab[] = [],
  focusedTabId?: string | null,
): PaneLeaf {
  const seen = new Set<string>()
  const deduped: PaneTab[] = []
  for (const tab of tabs) {
    if (seen.has(tab.tabId)) continue
    seen.add(tab.tabId)
    deduped.push(tab)
  }

  const focused =
    focusedTabId && seen.has(focusedTabId) ? focusedTabId : (deduped[0]?.tabId ?? null)

  return { kind: "pane", id, tabs: deduped, focusedTabId: focused }
}

/**
 * Build a group, upholding two invariants: a group never has zero children (it
 * becomes an empty pane) and never has exactly one (it collapses to that child,
 * since a lone child has no boundary to drag).
 */
export function createGroup(
  id: string,
  direction: SplitDirection,
  children: readonly PaneNode[],
  sizes?: readonly number[],
): PaneNode {
  if (children.length === 0) return createPane(id)
  if (children.length === 1) return children[0]!

  return {
    kind: "group",
    id,
    direction,
    children: [...children],
    sizes: normalizeSizes(sizes, children.length),
  }
}

export function createDefaultLayout(): PaneLayout {
  return { root: createPane(DEFAULT_PANE_ID), focusedPaneId: DEFAULT_PANE_ID }
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function getTreeDepth(node: PaneNode): number {
  if (isPane(node)) return 1
  return 1 + Math.max(...node.children.map(getTreeDepth))
}

export function collectPanes(node: PaneNode): PaneLeaf[] {
  if (isPane(node)) return [node]
  return node.children.flatMap(collectPanes)
}

/** Child-index path from the root to a pane, or null when absent. */
export function findPanePath(node: PaneNode, paneId: string): number[] | null {
  if (isPane(node)) return node.id === paneId ? [] : null

  for (const [index, child] of node.children.entries()) {
    const path = findPanePath(child, paneId)
    if (path) return [index, ...path]
  }
  return null
}

export function findPaneContainingTab(
  node: PaneNode,
  tabId: string,
): { pane: PaneLeaf; path: number[] } | null {
  if (isPane(node)) {
    return node.tabs.some((tab) => tab.tabId === tabId) ? { pane: node, path: [] } : null
  }

  for (const [index, child] of node.children.entries()) {
    const found = findPaneContainingTab(child, tabId)
    if (found) return { pane: found.pane, path: [index, ...found.path] }
  }
  return null
}

export function getNodeAtPath(node: PaneNode, path: readonly number[]): PaneNode | null {
  let current: PaneNode | undefined = node
  for (const index of path) {
    if (!current || !isGroup(current)) return null
    current = current.children[index]
  }
  return current ?? null
}

/**
 * The pane a user would most naturally land on when `paneId` disappears: walk
 * outward, preferring the nearest pane to the left, then the nearest to the right.
 */
export function findNearestSiblingPaneId(root: PaneNode, paneId: string): string | null {
  const path = findPanePath(root, paneId)
  if (!path) return null

  for (let depth = path.length - 1; depth >= 0; depth--) {
    const parent = getNodeAtPath(root, path.slice(0, depth))
    if (!parent || !isGroup(parent)) continue
    const index = path[depth]!

    for (let left = index - 1; left >= 0; left--) {
      const panes = collectPanes(parent.children[left]!)
      const last = panes.at(-1)
      if (last) return last.id
    }
    for (let right = index + 1; right < parent.children.length; right++) {
      const first = collectPanes(parent.children[right]!)[0]
      if (first) return first.id
    }
  }
  return null
}

// ─── Structural primitives ──────────────────────────────────────────────────

/**
 * Replace the node at `path`, rebuilding every ancestor through `createGroup`
 * so sizes renormalize and single-child collapse cascades on the way back up.
 */
export function replaceNodeAtPath(
  root: PaneNode,
  path: readonly number[],
  next: PaneNode,
): PaneNode {
  if (path.length === 0) return next

  const [index, ...rest] = path
  if (!isGroup(root)) return root
  const child = root.children[index!]
  if (!child) return root

  const children = [...root.children]
  children[index!] = replaceNodeAtPath(child, rest, next)
  return createGroup(root.id, root.direction, children, root.sizes)
}

/**
 * Remove the pane at `path`.
 *
 * Removing the root pane empties it in place rather than deleting it — the tree
 * must always offer somewhere to render.
 */
export function removePaneByPath(root: PaneNode, path: readonly number[]): PaneNode {
  if (path.length === 0) return createPane(root.id)

  const parentPath = path.slice(0, -1)
  const index = path.at(-1)!
  const parent = getNodeAtPath(root, parentPath)
  if (!parent || !isGroup(parent)) return root

  const children = parent.children.filter((_, childIndex) => childIndex !== index)
  const sizes = parent.sizes.filter((_, sizeIndex) => sizeIndex !== index)
  const rebuilt = createGroup(parent.id, parent.direction, children, redistributeToMinimum(sizes))

  return replaceNodeAtPath(root, parentPath, rebuilt)
}

export interface DetachTabResult {
  root: PaneNode
  tab: PaneTab | null
  sourcePaneId: string | null
}

/**
 * Pull a tab out of the tree.
 *
 * The single primitive under split, move and close. `preserveEmptyPaneId` keeps
 * a pane alive even when the detach empties it — needed when splitting a pane's
 * own last tab, where deleting the source would destroy the split target.
 */
export function detachTab(
  root: PaneNode,
  tabId: string,
  options: { preserveEmptyPaneId?: string } = {},
): DetachTabResult {
  const found = findPaneContainingTab(root, tabId)
  if (!found) return { root, tab: null, sourcePaneId: null }

  const { pane, path } = found
  const tab = pane.tabs.find((candidate) => candidate.tabId === tabId) ?? null
  const remaining = pane.tabs.filter((candidate) => candidate.tabId !== tabId)

  if (remaining.length > 0 || pane.id === options.preserveEmptyPaneId) {
    const nextFocus = pane.focusedTabId === tabId ? undefined : pane.focusedTabId
    const nextPane = createPane(pane.id, remaining, nextFocus)
    return { root: replaceNodeAtPath(root, path, nextPane), tab, sourcePaneId: pane.id }
  }

  return { root: removePaneByPath(root, path), tab, sourcePaneId: pane.id }
}

/**
 * Put a tab into a pane. Returns null when the pane does not exist, so callers
 * decide how to recover rather than being thrown at.
 */
export function insertTabIntoPane(
  root: PaneNode,
  paneId: string,
  tab: PaneTab,
  options: { index?: number; focus?: boolean } = {},
): PaneNode | null {
  const path = findPanePath(root, paneId)
  if (!path) return null

  const pane = getNodeAtPath(root, path)
  if (!pane || !isPane(pane)) return null

  const tabs = pane.tabs.filter((candidate) => candidate.tabId !== tab.tabId)
  const index = options.index ?? tabs.length
  tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab)

  const focus = options.focus ?? true
  const focusedTabId = focus ? tab.tabId : (pane.focusedTabId ?? tab.tabId)

  return replaceNodeAtPath(root, path, createPane(pane.id, tabs, focusedTabId))
}

export type { PaneGroup }
