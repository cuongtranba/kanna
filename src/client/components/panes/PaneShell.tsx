import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import type { PaneLeaf, SplitPosition } from "../../lib/paneTree"
import { cn } from "../../lib/utils"
import { PaneScopedStore } from "../../stores/paneScopedStore"
import type { PaneContentRegistry } from "./paneContentRegistry"
import { renderPaneContent } from "./paneContentRegistry"
import { PaneTabStrip } from "./PaneTabStrip"
import { selectRetainedTabIds } from "./paneRetention"
import type { TabPresentationContext } from "./tabPresentation"

/**
 * One pane in the SplitContainer tree.
 *
 * Owns:
 *   - the PaneScopedStore.Provider (all per-pane ephemeral state lives here)
 *   - width measurement for the tab strip (stored in PaneScopedStore.layoutWidth)
 *   - the PaneTabStrip
 *   - content lookup via the registry
 *
 * Split-pane actions (select/close/split) are forwarded up to the store via
 * the callbacks, which are computed once in ChatPage and stable across renders
 * of the same layout shape.
 */

export interface SplitArgs {
  tabId: string
  paneId: string
  position: SplitPosition
}

export interface PaneShellProps {
  pane: PaneLeaf
  isFocused: boolean
  registry: PaneContentRegistry
  presentation: TabPresentationContext
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  /** Called with the resolved tab id, pane id, and split direction. */
  onSplit: (args: SplitArgs) => void
}

/**
 * Outer shell: mounts the Provider so the inner shell can access the scoped
 * store.  Keeping Provider and consumer in separate components is the standard
 * React pattern — a component cannot consume a context it provides itself.
 */
export function PaneShell(props: PaneShellProps) {
  return (
    <PaneScopedStore.Provider init={undefined}>
      <PaneShellInner {...props} />
    </PaneScopedStore.Provider>
  )
}

function PaneShellInner({
  pane,
  isFocused,
  registry,
  presentation,
  onSelectTab,
  onCloseTab,
  onSplit,
}: PaneShellProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const storeApi = PaneScopedStore.useScopedStoreApi()
  const setLayoutWidth = PaneScopedStore.useScopedStore((s) => s.setLayoutWidth)
  const layoutWidth = PaneScopedStore.useScopedStore((s) => s.layoutWidth)

  // Measure the pane container and keep PaneScopedStore.layoutWidth in sync.
  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return

    const update = () => {
      const next = element.clientWidth
      const current = storeApi.getState().layoutWidth
      if (Math.abs(current - next) >= 1) {
        setLayoutWidth(next)
      }
    }

    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [storeApi, setLayoutWidth])

  // Forward the split action with the pane's currently-focused tab + pane id.
  const handleSplit = useCallback(
    (position: SplitPosition) => {
      const tabId = pane.focusedTabId ?? pane.tabs[0]?.tabId
      if (tabId) onSplit({ tabId, paneId: pane.id, position })
    },
    [pane.focusedTabId, pane.tabs, pane.id, onSplit],
  )

  // A pane with no explicit focus still shows its first tab.
  const activeTabId = pane.focusedTabId ?? pane.tabs[0]?.tabId ?? null

  const tabRecency = PaneScopedStore.useScopedStore((s) => s.tabRecency)
  const noteTabActivated = PaneScopedStore.useScopedStore((s) => s.noteTabActivated)

  useEffect(() => {
    if (activeTabId) noteTabActivated(activeTabId)
  }, [activeTabId, noteTabActivated])

  const retainedTabIds = useMemo(
    () => new Set(selectRetainedTabIds({ tabs: pane.tabs, activeTabId, recency: tabRecency })),
    [pane.tabs, activeTabId, tabRecency],
  )

  return (
    <div ref={containerRef} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <PaneTabStrip
        pane={pane}
        isPaneFocused={isFocused}
        width={layoutWidth}
        presentation={presentation}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onSplit={handleSplit}
      />
      {/*
        Retained tabs are all mounted and absolutely stacked. `visibility:hidden`
        (not `display:none`) keeps each one's layout box, so scroll offsets and
        xterm's measured geometry survive a tab switch; `inert` takes the hidden
        subtrees out of the focus and accessibility trees.
      */}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {pane.tabs
          .filter((tab) => retainedTabIds.has(tab.tabId))
          .map((tab) => {
            const isActiveTab = tab.tabId === activeTabId
            return (
              <div
                key={tab.tabId}
                className={cn(
                  // flex-COL, not the default row: a row container sizes each
                  // child to its content width, which collapsed the chat card to
                  // 24px in a 1117px pane. A column stretches children across
                  // the cross axis, so any registry content fills the pane
                  // without needing its own flex-1.
                  "absolute inset-0 flex min-h-0 min-w-0 flex-col",
                  !isActiveTab && "invisible pointer-events-none",
                )}
                inert={!isActiveTab}
              >
                {renderPaneContent(registry, tab.target, pane, isFocused && isActiveTab)}
              </div>
            )
          })}
      </div>
    </div>
  )
}
