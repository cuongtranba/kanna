import { useDraggable } from "@dnd-kit/core"
import { SessionMark } from "../ui/session-mark"
import { Columns2, Rows2, X } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import type { PaneLeaf, SplitPosition } from "../../lib/paneTree"
import {
  chatDotBgClass,
  type ChatStatusIndicator,
  type SessionStateBadge,
} from "../../lib/chatStatusIndicator"
import { cn } from "../../lib/utils"
import { isMobileViewport } from "../../lib/viewport"
import { DEFAULT_TAB_MIN_WIDTH } from "../../../shared/pane-tab-width"
import { useAppSettingsStore } from "../../stores/appSettingsStore"
import { useViewportStore } from "../../stores/viewportStore"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import { SHELL_TOP_BAND_CLASS } from "../../lib/shellChrome"
import { computeTabStripLayout, PHONE_MIN_TAB_WIDTH } from "./tabStripLayout"
import { describeTab, type TabPresentationContext } from "./tabPresentation"


export interface PaneTabStripProps {
  pane: PaneLeaf
  isPaneFocused: boolean
  width: number
  presentation: TabPresentationContext
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onSplit: (position: SplitPosition) => void
}

const ACTIONS_WIDTH = 52

const SPLIT_NEEDS_TWO_TABS = "Open another tab to split — a pane cannot be left empty"

const MIDDLE_MOUSE_BUTTON = 1

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
  const tabMinWidth = useAppSettingsStore(
    (state) => state.settings?.panes.tabMinWidth ?? DEFAULT_TAB_MIN_WIDTH,
  )
  const canSplit = !isPhone
  const hasTabToKeep = pane.tabs.length > 1

  const layout = computeTabStripLayout({
    availableWidth: width,
    tabCount: pane.tabs.length,
    actionsWidth: canSplit ? ACTIONS_WIDTH : 0,
    minTabWidth: isPhone ? PHONE_MIN_TAB_WIDTH : tabMinWidth,
  })

  const handleSplitRight = useCallback(() => onSplit("right"), [onSplit])
  const handleSplitDown = useCallback(() => onSplit("bottom"), [onSplit])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const hasAlignedRef = useRef(false)
  const focusedTabId = pane.focusedTabId

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
        SHELL_TOP_BAND_CLASS,
      )}
    >
      <div
        ref={scrollerRef}
        data-swipe-scroll-x={layout.scrolls ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-stretch",
          layout.scrolls &&
            "overflow-x-auto overscroll-x-contain touch-pan-x motion-safe:scroll-smooth",
        )}
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {pane.tabs.map((tab) => {
          const isActive = pane.focusedTabId === tab.tabId
          const { label, icon: Icon, closable, indicator, sessionBadge } = describeTab(
            tab.target,
            presentation,
          )

          return (
            <PaneTab
              key={tab.tabId}
              tabId={tab.tabId}
              label={label}
              Icon={Icon}
              indicator={indicator}
              sessionBadge={sessionBadge}
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
  indicator: ChatStatusIndicator | null
  sessionBadge: SessionStateBadge | null
  isActive: boolean
  isPaneFocused: boolean
  showLabel: boolean
  closable: boolean
  isPhone: boolean
  width: number
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
}

function PaneTab({
  tabId,
  label,
  Icon,
  indicator,
  sessionBadge,
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
      event.stopPropagation()
      onClose(tabId)
    },
    [onClose, tabId],
  )

  const handleAuxClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== MIDDLE_MOUSE_BUTTON || !closable) return
      event.preventDefault()
      event.stopPropagation()
      onClose(tabId)
    },
    [closable, onClose, tabId],
  )

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button === MIDDLE_MOUSE_BUTTON) event.preventDefault()
  }, [])

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tabId,
    disabled: isPhone,
  })

  const tab = (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      data-tab-id={tabId}
      data-tab-active={isActive ? "true" : "false"}
      onClick={handleSelect}
      onAuxClick={handleAuxClick}
      onMouseDown={handleMouseDown}
      className={cn(
        "group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3",
        isActive ? "bg-background text-foreground" : "text-muted-foreground hover:bg-muted/40",
        isPhone ? "touch-pan-x" : "touch-none",
        isDragging && "opacity-50",
      )}
      style={{ width }}
    >
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

      {indicator ? (
        <span
          aria-hidden
          data-tab-status={indicator.tone}
          className="flex size-3.5 shrink-0 items-center justify-center"
        >
          <span className={cn("h-2 w-2 rounded-full", chatDotBgClass(indicator.tone))} />
        </span>
      ) : (
        <Icon className="size-3.5 shrink-0" />
      )}
      {indicator ? <span className="sr-only">{indicator.label}</span> : null}

      {sessionBadge && showLabel ? (
        <span
          aria-hidden
          data-tab-session-badge
          className={cn("flex shrink-0 items-center", sessionBadge.toneClass)}
        >
          <SessionMark kind={sessionBadge.kind} />
        </span>
      ) : null}

      {showLabel ? <span className="min-w-0 flex-1 truncate text-xs">{label}</span> : null}

      {closable ? (
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={handleClose}
          className="ml-auto flex size-8 max-md:size-11 shrink-0 items-center justify-center rounded-sm opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )

  const statusLines: string[] = []
  if (indicator) statusLines.push(indicator.label)
  if (sessionBadge) statusLines.push(sessionBadge.title)
  if (showLabel && statusLines.length === 0) return tab
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tab}</TooltipTrigger>
      <TooltipContent side="bottom">
        <span>{label}</span>
        {statusLines.map((line) => (
          <span key={line} className="block text-muted-foreground">
            {line}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}

interface StripActionProps {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  disabledReason?: string
}

function StripAction({ label, icon: Icon, onClick, disabled, disabledReason }: StripActionProps) {
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
