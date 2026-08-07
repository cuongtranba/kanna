import { useDraggable } from "@dnd-kit/core"
import { Columns2, Rows2, X } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import type { PaneLeaf, SplitPosition } from "../../lib/paneTree"
import { cn } from "../../lib/utils"
import { isMobileViewport } from "../../lib/viewport"
import { useViewportStore } from "../../stores/viewportStore"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import { SHELL_TOP_BAND_CLASS } from "../../lib/shellChrome"
import { computeTabStripLayout, PHONE_MIN_TAB_WIDTH } from "./tabStripLayout"
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

const SPLIT_NEEDS_TWO_TABS = "Open another tab to split — a pane cannot be left empty"

export function PaneTabStrip({
  pane,
  isPaneFocused,
  width,
  presentation,
  onSelectTab,
  onCloseTab,
  onSplit,
}: PaneTabStripProps) {
  const viewportWidth = useViewportStore((state) => state.width)
  const isPhone = isMobileViewport(viewportWidth)
  const canSplit = !isPhone
  // A split moves the active tab into the new pane, so the pane must have
  // another tab left to show. Splitting its only tab is refused by the engine —
  // the button must not offer what will not happen.
  const hasTabToKeep = pane.tabs.length > 1

  const layout = computeTabStripLayout({
    availableWidth: width,
    tabCount: pane.tabs.length,
    actionsWidth: canSplit ? ACTIONS_WIDTH : 0,
    minTabWidth: isPhone ? PHONE_MIN_TAB_WIDTH : undefined,
  })

  const handleSplitRight = useCallback(() => onSplit("right"), [onSplit])
  const handleSplitDown = useCallback(() => onSplit("bottom"), [onSplit])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const hasAlignedRef = useRef(false)
  const focusedTabId = pane.focusedTabId

  // Selecting a half-visible tab glides it fully into view. No `behavior`
  // argument on purpose: that defers to the CSS scroll-behavior below, which is
  // gated on motion-safe, so prefers-reduced-motion lands the same scroll
  // instantly. The first alignment after mount is instant either way — a strip
  // that has just appeared has nothing to animate from.
  useEffect(() => {
    const active = scrollerRef.current?.querySelector<HTMLElement>('[data-tab-active="true"]')
    if (typeof active?.scrollIntoView !== "function") return

    const instant = !hasAlignedRef.current
    hasAlignedRef.current = true
    active.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      ...(instant ? { behavior: "instant" as const } : {}),
    })
  }, [focusedTabId])

  return (
    <div
      data-pane-tab-strip
      className={cn(
        "flex shrink-0 items-stretch border-b border-border bg-background",
        // Same band as the sidebar header — see lib/shellChrome.ts.
        SHELL_TOP_BAND_CLASS,
      )}
    >
      <div
        ref={scrollerRef}
        // Read by the app-wide sidebar swipe gesture, which must not claim a
        // rightward swipe that is scrolling this strip back to its first tab.
        data-swipe-scroll-x={layout.scrolls ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-stretch",
          layout.scrolls &&
            "overflow-x-auto scrollbar-hide overscroll-x-contain touch-pan-x motion-safe:scroll-smooth",
        )}
        style={{ WebkitOverflowScrolling: "touch" }}
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
              isPhone={isPhone}
              width={layout.tabWidth}
              onSelect={onSelectTab}
              onClose={onCloseTab}
            />
          )
        })}
      </div>

      {/*
        Splitting is meaningless below the md breakpoint: the tree renders as a
        single pane there, so a split would create a pane the user cannot see.
      */}
      {canSplit ? (
        <div className="flex shrink-0 items-center gap-0.5 px-1">
          <StripAction
            label="Split right"
            disabledReason={SPLIT_NEEDS_TWO_TABS}
            disabled={!hasTabToKeep}
            onClick={handleSplitRight}
            icon={Columns2}
          />
          <StripAction
            label="Split down"
            disabledReason={SPLIT_NEEDS_TWO_TABS}
            disabled={!hasTabToKeep}
            onClick={handleSplitDown}
            icon={Rows2}
          />
        </div>
      ) : null}
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
  /** Phone strip: the horizontal gesture scrolls, so the drag sensor stands down. */
  isPhone: boolean
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
  isPhone,
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

  // The whole tab is the drag handle. The sensor's small distance threshold is
  // what keeps a plain click a selection rather than a drag.
  //
  // A phone shows the whole tree as ONE pane, so a tab can only be dragged into
  // the pane it already sits in — the gesture buys nothing there, and it costs
  // the strip its scroll.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tabId,
    disabled: isPhone,
  })

  const tab = (
    <div
      ref={setNodeRef}
      // Spread first: dnd-kit's attributes carry role="button", and this element
      // must stay role="tab" for the strip's semantics. Its tabIndex and
      // aria-describedby (the drag instructions) are still worth keeping.
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      data-tab-id={tabId}
      data-tab-active={isActive ? "true" : "false"}
      onClick={handleSelect}
      className={cn(
        "group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3",
        isActive ? "bg-background text-foreground" : "text-muted-foreground hover:bg-muted/40",
        // touch-action intersects down the ancestor chain, so this one class
        // decides who owns a swipe on the strip: the pointer sensor (drag), or
        // the browser (scroll the strip).
        isPhone ? "touch-pan-x" : "touch-none",
        isDragging && "opacity-50",
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
  disabled?: boolean
  /** Shown instead of `label` when disabled, so the tooltip explains why. */
  disabledReason?: string
}

function StripAction({ label, icon: Icon, onClick, disabled, disabledReason }: StripActionProps) {
  // `aria-disabled` rather than `disabled`: a truly disabled button fires no
  // pointer events, so the tooltip explaining WHY it is unavailable would never
  // open, and it would drop out of the focus order too. The handler is guarded
  // instead.
  const handleClick = useCallback(() => {
    if (!disabled) onClick()
  }, [disabled, onClick])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-disabled={disabled}
          onClick={handleClick}
          className={cn(
            "flex size-[22px] items-center justify-center rounded-sm text-muted-icon",
            disabled ? "cursor-default opacity-40" : "hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {disabled && disabledReason ? disabledReason : label}
      </TooltipContent>
    </Tooltip>
  )
}
