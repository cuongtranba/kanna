import { collectPanes, type PaneLayout, type PaneLeaf } from "../../lib/paneTree"

export function flattenLayoutForMobile(layout: PaneLayout): PaneLeaf {
  const panes = collectPanes(layout.root)
  const focused = panes.find((pane) => pane.id === layout.focusedPaneId) ?? panes[0] ?? null
  const tabs = panes.flatMap((pane) => pane.tabs)

  return {
    kind: "pane",
    id: focused?.id ?? "mobile",
    tabs,
    focusedTabId: focused?.focusedTabId ?? tabs[0]?.tabId ?? null,
  }
}
