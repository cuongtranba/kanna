import { type AnyValue, isRecord } from "../../../shared/errors"
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

/**
 * Rebuild a layout from untrusted input.
 *
 * Persisted state is the main caller, and it is genuinely untrusted: it may
 * come from an older release, a hand-edited localStorage entry, or a
 * half-written value. Reconstructing defensively on every read — rather than
 * trusting the shape and migrating it — is what lets the tree evolve without
 * migration code. Anything unusable is dropped; the result is always valid.
 */

/**
 * A node missing its id gets one derived from its position in the tree, so
 * normalizing the same input twice yields identical ids — otherwise React keys
 * would churn on every read and remount the panes.
 */
function fallbackId(prefix: string, path: string): string {
  return `${prefix}-recovered-${path || "root"}`
}

function readString(value: AnyValue): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function readDirection(value: AnyValue): SplitDirection {
  return value === "vertical" ? "vertical" : "horizontal"
}

function readNumber(value: AnyValue): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readTabs(value: AnyValue): PaneTab[] {
  if (!Array.isArray(value)) return []

  const tabs: PaneTab[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const target = normalizeTabTarget(entry.target)
    if (!target) continue

    // Re-derive the id rather than trusting the stored one, so a tab whose id
    // disagrees with its own target cannot poison dedup or React keys.
    tabs.push(createTab(target, readNumber(entry.createdAt) ?? 0))
  }
  return tabs
}

function readSizes(value: AnyValue): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const sizes: number[] = []
  for (const entry of value) {
    const size = readNumber(entry)
    if (size !== null) sizes.push(size)
  }
  return sizes
}

function readNode(value: AnyValue, depth: number, path: string): PaneNode | null {
  if (!isRecord(value)) return null

  const id = readString(value.id)

  if (value.kind === "pane") {
    return createPane(id ?? fallbackId("pane", path), readTabs(value.tabs), readString(value.focusedTabId))
  }

  if (value.kind !== "group") return null
  if (!Array.isArray(value.children)) return null

  // Past the cap, flatten the remaining subtree into the panes it contains
  // rather than discarding the user's tabs.
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

  // createGroup upholds the structural invariants: sizes are renormalized to
  // the real child count, and a single child collapses rather than staying wrapped.
  return createGroup(
    id ?? fallbackId("group", path),
    readDirection(value.direction),
    children,
    readSizes(value.sizes),
  )
}

function resolveFocusedPaneId(value: AnyValue, panes: readonly PaneNode[]): string | null {
  // null is a meaningful state ("nothing focused"), so it is preserved; an id
  // that no longer resolves falls back to the first pane.
  if (value === null) return null
  const requested = readString(value)
  if (requested && panes.some((pane) => pane.id === requested)) return requested
  return panes[0]?.id ?? DEFAULT_PANE_ID
}

export function normalizeLayout(value: AnyValue): PaneLayout {
  if (!isRecord(value)) return createDefaultLayout()

  const root = readNode(value.root, 1, "")
  if (!root) return createDefaultLayout()

  const panes = collectPanes(root)
  if (panes.length === 0) return createDefaultLayout()

  return { root, focusedPaneId: resolveFocusedPaneId(value.focusedPaneId, panes) }
}
