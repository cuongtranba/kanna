import type { PaneTab } from "../../lib/paneTree"


export const DEFAULT_RETENTION_CAP = 3

export const DEFAULT_RECENCY_LIMIT = 32

export interface RetentionInput {
  tabs: readonly PaneTab[]
  activeTabId: string | null
  recency: readonly string[]
  cap?: number
}

export function selectRetainedTabIds({
  tabs,
  activeTabId,
  recency,
  cap = DEFAULT_RETENTION_CAP,
}: RetentionInput): string[] {
  const retained = new Set<string>()

  for (const tab of tabs) {
    if (tab.tabId === activeTabId || tab.target.kind === "terminal") {
      retained.add(tab.tabId)
    }
  }

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

export function noteTabActivated(
  recency: readonly string[],
  tabId: string,
  limit: number = DEFAULT_RECENCY_LIMIT,
): readonly string[] {
  if (recency[0] === tabId) return recency

  const next = [tabId, ...recency.filter((id) => id !== tabId)]
  return next.length > limit ? next.slice(0, limit) : next
}
