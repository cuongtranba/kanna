import type { PaneTab } from "../../lib/paneTree"

/**
 * Which tabs in a pane stay MOUNTED.
 *
 * A pane shows one tab at a time, but unmounting the others throws away state
 * the app cannot rebuild: a terminal's PTY-backed scrollback, a transcript's
 * scroll offset, an expanded tool group. Retention keeps a bounded set alive
 * behind the active one (hidden with `visibility:hidden`, never `display:none`
 * — the latter collapses the layout box and discards scroll offsets).
 *
 * Three tiers, in priority order:
 *
 *   1. The active tab. Always retained.
 *   2. Terminal tabs. Uncapped — a terminal owns a live process and scrollback
 *      the server cannot replay, so it is never evicted.
 *   3. Everything else, by recency, up to `cap`.
 *
 * Tier 3 does not bind with today's three tab kinds (chat and changes are
 * singletons, so a pane holds at most two non-terminal tabs). It is enforced
 * anyway so that adding a non-singleton, non-terminal kind later cannot
 * silently make a pane retain an unbounded number of live subtrees.
 */

/** Tier-3 budget: how many non-terminal, non-active tabs stay mounted. */
export const DEFAULT_RETENTION_CAP = 3

/** Upper bound on the tracked recency list, so a long session cannot grow it. */
export const DEFAULT_RECENCY_LIMIT = 32

export interface RetentionInput {
  tabs: readonly PaneTab[]
  activeTabId: string | null
  /** Most-recently-activated first. Entries for absent tabs are ignored. */
  recency: readonly string[]
  cap?: number
}

/**
 * The tab ids to keep mounted, ordered by their position in `tabs`.
 *
 * Tab order — not recency order — is deliberate: the result drives React's
 * child list, and reordering children on every tab switch would remount them,
 * which is the exact outcome retention exists to prevent.
 */
export function selectRetainedTabIds({
  tabs,
  activeTabId,
  recency,
  cap = DEFAULT_RETENTION_CAP,
}: RetentionInput): string[] {
  const retained = new Set<string>()

  for (const tab of tabs) {
    // Tier 1 + tier 2.
    if (tab.tabId === activeTabId || tab.target.kind === "terminal") {
      retained.add(tab.tabId)
    }
  }

  // Tier 3: rank the remainder by recency, falling back to tab order for tabs
  // that have never been activated. `indexOf` on a bounded list is cheap and
  // keeps the ranking obvious.
  const remainder = tabs.filter((tab) => !retained.has(tab.tabId))
  const ranked = remainder
    .map((tab, tabIndex) => {
      const recencyIndex = recency.indexOf(tab.tabId)
      return {
        tabId: tab.tabId,
        rank: recencyIndex === -1 ? recency.length + tabIndex : recencyIndex,
      }
    })
    .sort((a, b) => a.rank - b.rank)

  for (const { tabId } of ranked.slice(0, Math.max(0, cap))) {
    retained.add(tabId)
  }

  return tabs.filter((tab) => retained.has(tab.tabId)).map((tab) => tab.tabId)
}

/**
 * Record that `tabId` became active: most-recent-first, deduplicated, bounded.
 *
 * Returns the SAME array reference when `tabId` is already most recent, so
 * re-activating the current tab does not publish a new store snapshot.
 */
export function noteTabActivated(
  recency: readonly string[],
  tabId: string,
  limit: number = DEFAULT_RECENCY_LIMIT,
): readonly string[] {
  if (recency[0] === tabId) return recency

  const next = [tabId, ...recency.filter((id) => id !== tabId)]
  return next.length > limit ? next.slice(0, limit) : next
}
