import { useCallback, useEffect, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { chatDotBgClass } from "../../lib/chatStatusIndicator"
import { formatBindingKeys, getBindingsForAction, pickPlatformBinding } from "../../lib/keybindings"
import { collectPaneBounds, collectPanes, type PaneBounds, type PaneLayout } from "../../lib/paneTree"
import { isMacUserAgent } from "../../lib/quickSwitcher"
import { cn } from "../../lib/utils"
import { useTabSwitcherStore } from "../../stores/tabSwitcherStore"
import type { KeybindingsSnapshot } from "../../../shared/types"
import type { DomPort } from "../../ports/domPort"
import { domAdapter } from "../../adapters/dom.adapter"
import { Kbd, KbdGroup } from "../ui/kbd"
import { describeTab, type TabPresentation, type TabPresentationContext } from "./tabPresentation"

const LIST_ID = "tab-switcher-list"

interface SwitcherRow {
  tabId: string
  paneId: string
  view: TabPresentation
}

export interface TabSwitcherProps {
  layout: PaneLayout
  presentation: TabPresentationContext
  keybindings: KeybindingsSnapshot | null
  onCommit: (tabId: string) => void
  ports?: { dom?: DomPort }
}

export function TabSwitcher({ layout, presentation, keybindings, onCommit, ports }: TabSwitcherProps) {
  const dom = ports?.dom ?? domAdapter
  const order = useTabSwitcherStore((state) => state.order)
  const highlight = useTabSwitcherStore((state) => state.highlight)
  const holdBinding = useTabSwitcherStore((state) => state.holdBinding)
  const highlightTab = useTabSwitcherStore((state) => state.highlightTab)
  const commitSwitcher = useTabSwitcherStore((state) => state.commitSwitcher)
  const listRef = useRef<HTMLUListElement | null>(null)

  const rows = useMemo(() => (order ? buildRows(layout, order, presentation) : []), [layout, order, presentation])
  const paneBounds = useMemo(() => collectPaneBounds(layout.root), [layout.root])
  const isMac = isMacUserAgent(dom.getUserAgent())
  const jumpBinding = pickPlatformBinding(getBindingsForAction(keybindings, "jumpToPaneTab"), isMac)

  const commitTab = useCallback((index: number) => {
    highlightTab(index)
    const tabId = commitSwitcher()
    if (tabId) onCommit(tabId)
  }, [commitSwitcher, highlightTab, onCommit])

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-tab-switcher-active="true"]')
    if (active instanceof HTMLElement && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" })
    }
  }, [highlight])

  if (!order || rows.length === 0) return null

  const active = rows[highlight] ?? rows[0]
  const showPanes = paneBounds.length > 1

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[16vh] z-50 flex justify-center px-4">
      <div
        role="dialog"
        aria-label="Switch tab"
        data-tab-switcher
        className="kanna-tab-switcher-in pointer-events-auto flex w-full max-w-[520px] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg"
      >
        <div className="flex items-baseline gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Recent tabs</span>
          {jumpBinding ? (
            <span className="ml-auto">
              <Hint keys={[...formatBindingKeys(jumpBinding, isMac), "1–9"]}>by position</Hint>
            </span>
          ) : null}
        </div>

        <ul
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label="Recent tabs"
          aria-activedescendant={optionId(active.tabId)}
          className="max-h-[min(22rem,56vh)] overflow-y-auto py-1"
        >
          {rows.map((row, index) => (
            <SwitcherOption
              key={row.tabId}
              row={row}
              index={index}
              active={index === highlight}
              current={index === 0}
              paneBounds={showPanes ? paneBounds : null}
              onHighlight={highlightTab}
              onCommit={commitTab}
            />
          ))}
        </ul>

        <p aria-live="polite" className="sr-only">
          {active.view.label}, {highlight + 1} of {rows.length}
        </p>

        <FooterHints isMac={isMac} holdBinding={holdBinding} />
      </div>
    </div>,
    dom.getBodyElement(),
  )
}

function buildRows(
  layout: PaneLayout,
  order: readonly string[],
  presentation: TabPresentationContext,
): SwitcherRow[] {
  const located = new Map<string, SwitcherRow>()
  for (const pane of collectPanes(layout.root)) {
    for (const tab of pane.tabs) {
      located.set(tab.tabId, {
        tabId: tab.tabId,
        paneId: pane.id,
        view: describeTab(tab.target, presentation),
      })
    }
  }
  return order.flatMap((tabId) => {
    const row = located.get(tabId)
    return row ? [row] : []
  })
}

function optionId(tabId: string): string {
  return `tab-switcher-option-${tabId}`
}

function SwitcherOption({ row, index, active, current, paneBounds, onHighlight, onCommit }: {
  row: SwitcherRow
  index: number
  active: boolean
  current: boolean
  paneBounds: readonly PaneBounds[] | null
  onHighlight: (index: number) => void
  onCommit: (index: number) => void
}) {
  const handlePointerMove = useCallback(() => {
    if (!active) onHighlight(index)
  }, [active, index, onHighlight])
  const handleClick = useCallback(() => onCommit(index), [index, onCommit])
  const { label, icon: Icon, indicator } = row.view

  const meta = current ? "Current" : indicator?.label

  return (
    <li
      id={optionId(row.tabId)}
      role="option"
      aria-selected={active}
      data-tab-switcher-active={active}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
      className={cn(
        "grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-1.5",
        active ? "bg-muted" : "hover:bg-muted/40",
      )}
    >
      <span aria-hidden className="flex size-4 items-center justify-center">
        {indicator ? (
          <span className={cn("size-2 rounded-full", chatDotBgClass(indicator.tone))} />
        ) : (
          <Icon className="size-3.5 text-muted-foreground" />
        )}
      </span>
      <span
        className={cn(
          "truncate text-sm",
          active ? "font-semibold text-foreground" : "font-medium",
          current && !active && "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {meta ? <span>{meta}</span> : null}
        {paneBounds ? <PaneMinimap bounds={paneBounds} paneId={row.paneId} /> : null}
      </span>
    </li>
  )
}

const MAP_WIDTH = 18
const MAP_HEIGHT = 12
const MAP_GAP = 1

function PaneMinimap({ bounds, paneId }: { bounds: readonly PaneBounds[]; paneId: string }) {
  return (
    <svg
      aria-hidden
      data-pane-minimap={paneId}
      width={MAP_WIDTH}
      height={MAP_HEIGHT}
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      className="shrink-0"
    >
      {bounds.map(({ paneId: id, rect }) => (
        <rect
          key={id}
          x={rect.left * MAP_WIDTH + MAP_GAP / 2}
          y={rect.top * MAP_HEIGHT + MAP_GAP / 2}
          width={Math.max((rect.right - rect.left) * MAP_WIDTH - MAP_GAP, MAP_GAP)}
          height={Math.max((rect.bottom - rect.top) * MAP_HEIGHT - MAP_GAP, MAP_GAP)}
          rx={1}
          className={id === paneId ? "fill-foreground" : "fill-muted-foreground/30"}
        />
      ))}
    </svg>
  )
}

function FooterHints({ isMac, holdBinding }: { isMac: boolean; holdBinding: string | null }) {
  const holdKeys = holdBinding ? formatBindingKeys(holdBinding, isMac) : []
  const modifiers = holdKeys.slice(0, -1)
  const trigger = holdKeys.at(-1) ?? ""
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
      {modifiers.length > 0 ? <Hint keys={modifiers}>Release to open</Hint> : null}
      <Hint keys={[trigger]}>Next</Hint>
      <Hint keys={[isMac ? "⇧" : "Shift", trigger]}>Back</Hint>
      <Hint keys={["Esc"]}>Cancel</Hint>
    </div>
  )
}

const GLYPH_KEYS: ReadonlySet<string> = new Set(["⌘", "⌃", "⌥", "⇧", "`"])

function isGlyphKey(key: string): boolean {
  return GLYPH_KEYS.has(key)
}

function Hint({ keys, children }: { keys: readonly string[]; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <KbdGroup>
        {keys.map((key) => (
          <Kbd key={key} className={cn(isGlyphKey(key) && "font-sans text-sm")}>{key}</Kbd>
        ))}
      </KbdGroup>
      <span>{children}</span>
    </span>
  )
}
