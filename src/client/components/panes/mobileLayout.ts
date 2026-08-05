import { collectPanes, type PaneLayout, type PaneLeaf } from "../../lib/paneTree"

/**
 * Collapse a pane tree into the single pane a phone shows.
 *
 * Below `BREAKPOINT_MD` there is no room to split: a two-way split leaves each
 * pane too narrow to read, and a nested one is unusable. So the tree renders as
 * one pane.
 *
 * The subtlety is which tabs that pane carries. Showing only the focused pane's
 * tabs would STRAND the rest — layouts persist per project, so a tree split on a
 * desktop and then opened on a phone would hide tabs with no way to reach them.
 * Instead every tab in the tree is gathered, in tree order, into one strip. The
 * result reads like a mobile browser: one viewport, many tabs.
 *
 * The pane keeps the identity of the focused pane, so the pane-scoped store and
 * any pane-addressed action still refer to something real in the tree. Tab
 * selection and closing are layout-wide operations, so they keep working
 * unchanged across the flattened view.
 */
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
