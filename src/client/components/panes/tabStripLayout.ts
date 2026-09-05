

import { MAX_TAB_WIDTH, MIN_TAB_WIDTH } from "../../../shared/pane-tab-width"

export { MAX_TAB_WIDTH, MIN_TAB_WIDTH }

export const PHONE_MIN_TAB_WIDTH = 124

const ESTIMATED_CHAR_WIDTH = 7

export interface TabStripLayoutInput {
  availableWidth: number
  tabCount: number
  actionsWidth: number
  minTabWidth?: number
}

export interface TabStripLayout {
  tabWidth: number
  showLabel: boolean
  scrolls: boolean
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export function computeTabStripLayout({
  availableWidth,
  tabCount,
  actionsWidth,
  minTabWidth,
}: TabStripLayoutInput): TabStripLayout {
  if (tabCount <= 0) return { tabWidth: 0, showLabel: false, scrolls: false }

  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { tabWidth: MAX_TAB_WIDTH, showLabel: true, scrolls: false }
  }

  const usable = Math.max(0, availableWidth - Math.max(0, actionsWidth))
  const floor = clamp(minTabWidth ?? MIN_TAB_WIDTH, MIN_TAB_WIDTH, MAX_TAB_WIDTH)
  const scrolls = usable < floor * tabCount

  const tabWidth = scrolls ? floor : Math.round(clamp(usable / tabCount, floor, MAX_TAB_WIDTH))

  const showLabel = tabWidth - MIN_TAB_WIDTH >= ESTIMATED_CHAR_WIDTH

  return { tabWidth, showLabel, scrolls }
}
