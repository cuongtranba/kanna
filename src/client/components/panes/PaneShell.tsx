import { useCallback, useLayoutEffect, useRef } from "react"
import type { PaneLeaf, SplitPosition } from "../../lib/paneTree"
import { PaneScopedStore } from "../../stores/paneScopedStore"
import type { PaneContentRegistry } from "./paneContentRegistry"
import { renderPaneContent } from "./paneContentRegistry"
import { PaneTabStrip } from "./PaneTabStrip"
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

  const activeTab = pane.tabs.find((t) => t.tabId === pane.focusedTabId) ?? pane.tabs[0]

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
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {activeTab ? renderPaneContent(registry, activeTab.target, pane, isFocused) : null}
      </div>
    </div>
  )
}
