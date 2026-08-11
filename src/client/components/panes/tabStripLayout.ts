/**
 * Tab strip sizing.
 *
 * Tabs are equal width and shrink together as more open, down to an icon-only
 * floor; past that the strip scrolls. Deliberately not an overflow menu — a
 * hidden "…" list makes a tab you can see disappear, whereas shrinking keeps
 * every tab addressable and only sheds the label.
 */

/*
 * The strip's HEIGHT is deliberately not here. It is the shell's top chrome
 * band, shared with the sidebar header — see SHELL_TOP_BAND_CLASS in
 * src/client/lib/shellChrome.ts. A local height constant is what let the two
 * bands drift out of line in the first place.
 */

// The floor and ceiling live in shared because app-settings clamps the user's
// tab-width preference into exactly this range; a local copy here is how the
// settings range and the layout floor would drift apart.
import { MAX_TAB_WIDTH, MIN_TAB_WIDTH } from "../../../shared/pane-tab-width"

export { MAX_TAB_WIDTH, MIN_TAB_WIDTH }

/**
 * The floor a phone strip uses instead.
 *
 * Shrinking to the icon-only floor is a pointer affordance: it relies on hover
 * tooltips to tell the tabs apart, and every chat tab carries the same icon. A
 * touch strip keeps its labels and scrolls, the way a mobile browser's tab bar
 * does — chosen so three tabs still fill a 390px strip and the fourth clips,
 * which is what tells the user there is more to reach.
 */
export const PHONE_MIN_TAB_WIDTH = 124

/** Rough advance width; only used to decide whether a label fits at all. */
const ESTIMATED_CHAR_WIDTH = 7

export interface TabStripLayoutInput {
  /** Measured width of the strip; 0 when unmeasured. */
  availableWidth: number
  tabCount: number
  /** Width reserved for the pane's split/close buttons at the end of the strip. */
  actionsWidth: number
  /**
   * Narrowest a tab may get before the strip scrolls instead of shrinking
   * further. Clamped into [MIN_TAB_WIDTH, MAX_TAB_WIDTH]; defaults to the
   * icon-only floor.
   */
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

  // Static markup and the first paint report 0. Assume roomy rather than
  // collapsing to icon-only, which would otherwise be the rendered state in
  // every server-rendered test.
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { tabWidth: MAX_TAB_WIDTH, showLabel: true, scrolls: false }
  }

  const usable = Math.max(0, availableWidth - Math.max(0, actionsWidth))
  const floor = clamp(minTabWidth ?? MIN_TAB_WIDTH, MIN_TAB_WIDTH, MAX_TAB_WIDTH)
  const scrolls = usable < floor * tabCount

  const tabWidth = scrolls ? floor : Math.round(clamp(usable / tabCount, floor, MAX_TAB_WIDTH))

  // A label needs at least one character's worth of room beyond the icon and
  // close button; below that the tab is icon-only.
  const showLabel = tabWidth - MIN_TAB_WIDTH >= ESTIMATED_CHAR_WIDTH

  return { tabWidth, showLabel, scrolls }
}
