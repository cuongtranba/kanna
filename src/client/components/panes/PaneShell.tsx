import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import type { PaneLeaf, SplitPosition } from "../../lib/paneTree"
import { cn } from "../../lib/utils"
import { PaneScopedStore } from "../../stores/paneScopedStore"
import type { PaneContentRegistry } from "./paneContentRegistry"
import { renderPaneContent } from "./paneContentRegistry"
import { PaneTabStrip } from "./PaneTabStrip"
import { selectRetainedTabIds } from "./paneRetention"
import type { TabPresentationContext } from "./tabPresentation"


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
  onSplit: (args: SplitArgs) => void
}

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

  const handleSplit = useCallback(
    (position: SplitPosition) => {
      const tabId = pane.focusedTabId ?? pane.tabs[0]?.tabId
      if (tabId) onSplit({ tabId, paneId: pane.id, position })
    },
    [pane.focusedTabId, pane.tabs, pane.id, onSplit],
  )

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
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {pane.tabs
          .filter((tab) => retainedTabIds.has(tab.tabId))
          .map((tab) => {
            const isActiveTab = tab.tabId === activeTabId
            return (
              <div
                key={tab.tabId}
                className={cn(
                  "absolute inset-0 flex min-h-0 min-w-0 flex-col",
                  !isActiveTab && "invisible pointer-events-none",
                )}
                inert={!isActiveTab}
              >
                {renderPaneContent(registry, tab.target, pane, isFocused && isActiveTab, isActiveTab)}
              </div>
            )
          })}
      </div>
    </div>
  )
}
