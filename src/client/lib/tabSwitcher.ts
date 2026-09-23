import type { KeybindingsSnapshot } from "../../shared/types"
import {
  bindingMatchesEventIgnoringShift,
  bindingModifiersMatch,
  getBindingsForAction,
} from "./keybindings"
import { collectPanes, type PaneLayout, type PaneLeaf, type PaneTab } from "./paneTree"

export const TAB_JUMP_LAST_DIGIT = 9
export const RECENT_TAB_LIMIT = 50

export interface TabSwitcherEntry {
  tab: PaneTab
  paneOrdinal: number
}

export interface TabSwitcherTrigger {
  binding: string
  reverse: boolean
}

export function focusedPaneOf(layout: PaneLayout): PaneLeaf | null {
  return collectPanes(layout.root).find((pane) => pane.id === layout.focusedPaneId) ?? null
}

function focusedTabIdOf(layout: PaneLayout): string | null {
  return focusedPaneOf(layout)?.focusedTabId ?? null
}

export function recordRecentTab(recent: readonly string[], layout: PaneLayout): readonly string[] {
  const focused = focusedTabIdOf(layout)
  if (!focused || recent[0] === focused) return recent
  return [focused, ...recent.filter((tabId) => tabId !== focused)].slice(0, RECENT_TAB_LIMIT)
}

export function orderTabsByRecency(layout: PaneLayout, recent: readonly string[]): TabSwitcherEntry[] {
  const entries = collectPanes(layout.root).flatMap((pane, index) =>
    pane.tabs.map((tab) => ({ tab, paneOrdinal: index + 1 })),
  )
  const rankOf = new Map<string, number>()
  const focused = focusedTabIdOf(layout)
  if (focused) rankOf.set(focused, -1)
  recent.forEach((tabId, index) => {
    if (!rankOf.has(tabId)) rankOf.set(tabId, index)
  })

  const unranked = Number.MAX_SAFE_INTEGER
  return entries
    .map((entry, layoutIndex) => ({ entry, layoutIndex, rank: rankOf.get(entry.tab.tabId) ?? unranked }))
    .sort((left, right) => left.rank - right.rank || left.layoutIndex - right.layoutIndex)
    .map(({ entry }) => entry)
}

export function tabJumpTarget(pane: PaneLeaf | null, digit: number): string | null {
  if (!pane || pane.tabs.length === 0) return null
  if (digit === TAB_JUMP_LAST_DIGIT) return pane.tabs[pane.tabs.length - 1].tabId
  return pane.tabs[digit - 1]?.tabId ?? null
}

export function tabJumpHint(index: number, tabCount: number): string | null {
  if (index < TAB_JUMP_LAST_DIGIT - 1) return String(index + 1)
  if (index === tabCount - 1) return String(TAB_JUMP_LAST_DIGIT)
  return null
}

export function matchTabSwitcherTrigger(
  keybindings: KeybindingsSnapshot | null,
  event: KeyboardEvent,
): TabSwitcherTrigger | null {
  const binding = getBindingsForAction(keybindings, "openTabSwitcher")
    .find((candidate) => bindingMatchesEventIgnoringShift(candidate, event))
  if (!binding) return null
  const bindingHasShift = binding.split("+").some((token) => token.trim().toLowerCase() === "shift")
  return { binding, reverse: event.shiftKey && !bindingHasShift }
}

export function shouldShowTabJumpHints(
  keybindings: KeybindingsSnapshot | null,
  event: Pick<KeyboardEvent, "metaKey" | "altKey" | "ctrlKey" | "shiftKey">,
): boolean {
  return getBindingsForAction(keybindings, "jumpToPaneTab")
    .some((binding) => bindingModifiersMatch(binding, event))
}

export function tabJumpDigit(keybindings: KeybindingsSnapshot | null, event: KeyboardEvent): number | null {
  if (!shouldShowTabJumpHints(keybindings, event)) return null
  if (!event.code.startsWith("Digit")) return null
  const digit = Number(event.code.slice("Digit".length))
  return digit >= 1 && digit <= TAB_JUMP_LAST_DIGIT ? digit : null
}
