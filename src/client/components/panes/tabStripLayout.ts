/**
 * Tab strip sizing.
 *
 * Tabs are equal width and shrink together as more open, down to an icon-only
 * floor; past that the strip scrolls. Deliberately not an overflow menu — a
 * hidden "…" list makes a tab you can see disappear, whereas shrinking keeps
 * every tab addressable and only sheds the label.
 */

export const TAB_STRIP_HEIGHT = 36

/** Icon (14) + horizontal padding (24) + close button (22). */
export const MIN_TAB_WIDTH = 60
export const MAX_TAB_WIDTH = 200

/** Rough advance width; only used to decide whether a label fits at all. */
const ESTIMATED_CHAR_WIDTH = 7

export interface TabStripLayoutInput {
  /** Measured width of the strip; 0 when unmeasured. */
  availableWidth: number
  tabCount: number
  /** Width reserved for the pane's split/close buttons at the end of the strip. */
  actionsWidth: number
}

export interface TabStripLayout {
  tabWidth: number
  showLabel: boolean
  scrolls: boolean
}

export function computeTabStripLayout({
  availableWidth,
  tabCount,
  actionsWidth,
}: TabStripLayoutInput): TabStripLayout {
  if (tabCount <= 0) return { tabWidth: 0, showLabel: false, scrolls: false }

  // Static markup and the first paint report 0. Assume roomy rather than
  // collapsing to icon-only, which would otherwise be the rendered state in
  // every server-rendered test.
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { tabWidth: MAX_TAB_WIDTH, showLabel: true, scrolls: false }
  }

  const usable = Math.max(0, availableWidth - Math.max(0, actionsWidth))
  const scrolls = usable < MIN_TAB_WIDTH * tabCount

  const tabWidth = scrolls
    ? MIN_TAB_WIDTH
    : Math.round(Math.min(MAX_TAB_WIDTH, Math.max(MIN_TAB_WIDTH, usable / tabCount)))

  // A label needs at least one character's worth of room beyond the icon and
  // close button; below that the tab is icon-only.
  const showLabel = tabWidth - MIN_TAB_WIDTH >= ESTIMATED_CHAR_WIDTH

  return { tabWidth, showLabel, scrolls }
}
