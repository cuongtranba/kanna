/**
 * Simple flat pane model for session-tab navigation.
 *
 * Each Pane holds exactly one chat session identified by chatId.
 * All operations are pure — they return a new PaneTree or the
 * identical reference when nothing changed, so callers can use
 * referential equality to short-circuit renders.
 */

export type Pane = { readonly chatId: string }

export type PaneTree = { readonly panes: readonly Pane[]; readonly activeIndex: number }

/** Returns the same tree when chatId is already open (dedup). */
export function openPane(tree: PaneTree, chatId: string): PaneTree {
  if (tree.panes.some((p) => p.chatId === chatId)) return tree
  return { panes: [...tree.panes, { chatId }], activeIndex: tree.panes.length }
}

/**
 * Removes the pane for chatId.
 * - Returns same tree if chatId is not found.
 * - Closing the last pane yields `{ panes: [], activeIndex: 0 }`.
 * - Closing the active pane selects the previous pane when one exists,
 *   otherwise the next (now at the same index in the shortened array).
 * - Closing a pane before the active one shifts activeIndex left by 1.
 * - Closing a pane after the active one leaves activeIndex unchanged.
 */
export function closePane(tree: PaneTree, chatId: string): PaneTree {
  const idx = tree.panes.findIndex((p) => p.chatId === chatId)
  if (idx === -1) return tree

  const newPanes = tree.panes.filter((p) => p.chatId !== chatId)
  if (newPanes.length === 0) return { panes: [], activeIndex: 0 }

  let newActive = tree.activeIndex
  if (idx < tree.activeIndex) {
    // Closed pane was before the active one — shift active left.
    newActive = tree.activeIndex - 1
  } else if (idx === tree.activeIndex) {
    // Closed pane WAS the active one — select prev if possible, else next.
    newActive = idx > 0 ? idx - 1 : 0
  }
  // idx > activeIndex: activeIndex is unaffected.

  // Clamp (safety net for edge cases).
  newActive = Math.min(newActive, newPanes.length - 1)

  return { panes: newPanes, activeIndex: newActive }
}

/** Selects the pane with chatId. Returns same tree when already active or not found. */
export function selectPane(tree: PaneTree, chatId: string): PaneTree {
  const idx = tree.panes.findIndex((p) => p.chatId === chatId)
  if (idx === -1 || idx === tree.activeIndex) return tree
  return { ...tree, activeIndex: idx }
}

/** Moves to the next pane, wrapping around. No-op on a single pane. */
export function nextPane(tree: PaneTree): PaneTree {
  if (tree.panes.length <= 1) return tree
  return { ...tree, activeIndex: (tree.activeIndex + 1) % tree.panes.length }
}

/** Moves to the previous pane, wrapping around. No-op on a single pane. */
export function prevPane(tree: PaneTree): PaneTree {
  if (tree.panes.length <= 1) return tree
  return {
    ...tree,
    activeIndex: (tree.activeIndex - 1 + tree.panes.length) % tree.panes.length,
  }
}
