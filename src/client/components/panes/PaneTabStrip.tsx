import { Columns2, Rows2, X } from "lucide-react"
import { useCallback } from "react"
import type { PaneLeaf, SplitPosition } from "../../lib/paneTree"
import { cn } from "../../lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import { computeTabStripLayout, TAB_STRIP_HEIGHT } from "./tabStripLayout"
import { describeTab, type TabPresentationContext } from "./tabPresentation"

/**
 * One strip per pane.
 *
 * The only pane-focus affordance is the 2px bar on top of the active tab —
 * accent when the pane has focus, muted border when it does not. No pane
 * outline, no extra chrome: the strip already tells you which pane you are in.
 */

export interface PaneTabStripProps {
  pane: PaneLeaf
  isPaneFocused: boolean
  /** Measured strip width; 0 before the first measurement. */
  width: number
  presentation: TabPresentationContext
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onSplit: (position: SplitPosition) => void
}

/** Width of the trailing split buttons, reserved when sizing the tabs. */
const ACTIONS_WIDTH = 52

export function PaneTabStrip({
  pane,
  isPaneFocused,
  width,
  presentation,
  onSelectTab,
  onCloseTab,
  onSplit,
}: PaneTabStripProps) {
  const layout = computeTabStripLayout({
    availableWidth: width,
    tabCount: pane.tabs.length,
    actionsWidth: ACTIONS_WIDTH,
  })

  const handleSplitRight = useCallback(() => onSplit("right"), [onSplit])
  const handleSplitDown = useCallback(() => onSplit("bottom"), [onSplit])

  return (
    <div
      data-pane-tab-strip
      className="flex shrink-0 items-stretch border-b border-border bg-background"
      style={{ height: TAB_STRIP_HEIGHT }}
    >
      <div
        className={cn(
          "flex min-w-0 flex-1 items-stretch",
          layout.scrolls && "overflow-x-auto scrollbar-hide",
        )}
      >
        {pane.tabs.map((tab) => {
          const isActive = pane.focusedTabId === tab.tabId
          const { label, icon: Icon, closable } = describeTab(tab.target, presentation)

          return (
            <PaneTab
              key={tab.tabId}
              tabId={tab.tabId}
              label={label}
              Icon={Icon}
              isActive={isActive}
              isPaneFocused={isPaneFocused}
              showLabel={layout.showLabel}
              closable={closable}
              width={layout.tabWidth}
              onSelect={onSelectTab}
              onClose={onCloseTab}
            />
          )
        })}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 px-1">
        <StripAction label="Split right" onClick={handleSplitRight} icon={Columns2} />
        <StripAction label="Split down" onClick={handleSplitDown} icon={Rows2} />
      </div>
    </div>
  )
}

interface PaneTabProps {
  tabId: string
  label: string
  Icon: React.ComponentType<{ className?: string }>
  isActive: boolean
  isPaneFocused: boolean
  showLabel: boolean
  closable: boolean
  width: number
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
}

function PaneTab({
  tabId,
  label,
  Icon,
  isActive,
  isPaneFocused,
  showLabel,
  closable,
  width,
  onSelect,
  onClose,
}: PaneTabProps) {
  const handleSelect = useCallback(() => onSelect(tabId), [onSelect, tabId])
  const handleClose = useCallback(
    (event: React.MouseEvent) => {
      // Keep the click off the tab body, which would otherwise select the tab
      // being closed.
      event.stopPropagation()
      onClose(tabId)
    },
    [onClose, tabId],
  )

  const tab = (
    <div
      role="tab"
      aria-selected={isActive}
      data-tab-id={tabId}
      data-tab-active={isActive ? "true" : "false"}
      onClick={handleSelect}
      className={cn(
        "group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3",
        isActive ? "bg-background text-foreground" : "text-muted-foreground hover:bg-muted/40",
      )}
      style={{ width }}
    >
      {/* The pane-focus signal: accent only when this pane holds focus. */}
      {isActive ? (
        <span
          aria-hidden
          data-tab-indicator={isPaneFocused ? "focused" : "unfocused"}
          className={cn(
            "absolute inset-x-0 top-0 h-0.5",
            isPaneFocused ? "bg-destructive" : "bg-border",
          )}
        />
      ) : null}

      <Icon className="size-3.5 shrink-0" />
      {showLabel ? <span className="min-w-0 flex-1 truncate text-xs">{label}</span> : null}

      {closable ? (
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={handleClose}
          className="ml-auto flex size-[18px] shrink-0 items-center justify-center rounded-sm opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )

  // Icon-only tabs lose their label, so the tooltip is the only way to tell
  // them apart. The project Tooltip, never a native title — the design gate
  // rejects `title` on intrinsic elements.
  if (showLabel) return tab
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tab}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

interface StripActionProps {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
}

function StripAction({ label, icon: Icon, onClick }: StripActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="flex size-[22px] items-center justify-center rounded-sm text-muted-icon hover:bg-muted hover:text-foreground"
        >
          <Icon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
