import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { type ReactNode, useCallback } from "react"
import type { SplitPosition } from "../../lib/paneTree"
import { usePaneDragStore } from "../../stores/paneDragStore"
import { resolvePaneDropIntent } from "./paneDropGeometry"

/**
 * Drag-and-drop for tabs: move a tab into another pane, or split a pane by
 * dropping onto its edge.
 *
 * Only a PointerSensor is registered. It already covers mouse, touch and pen,
 * and a keyboard drag would duplicate what the pane keybindings do directly
 * (split, close, cycle, focus a direction) — so the capability is reachable
 * without a mouse even though the drag itself is not.
 *
 * `pointerWithin` is the right collision strategy here because panes tile the
 * viewport without gaps: the pointer is always inside exactly one, and
 * rectangle-overlap strategies would report several.
 */

export interface PaneDndProviderProps {
  children: ReactNode
  /** Merge the dragged tab into a pane, at an insertion index if known. */
  onMoveTab: (tabId: string, toPaneId: string) => void
  /** Split `paneId` and put the dragged tab in the new pane. */
  onSplitWithTab: (tabId: string, paneId: string, position: SplitPosition) => void
}

/**
 * Current pointer position, derived from where the drag started plus how far it
 * has moved. dnd-kit does not surface live coordinates on its move event, but
 * the activator event plus the accumulated delta is exactly equivalent.
 */
function pointerFromDrag(activatorEvent: Event, delta: { x: number; y: number }) {
  if (!(activatorEvent instanceof MouseEvent)) return null
  return { x: activatorEvent.clientX + delta.x, y: activatorEvent.clientY + delta.y }
}

export function PaneDndProvider({ children, onMoveTab, onSplitWithTab }: PaneDndProviderProps) {
  // A small distance threshold keeps a plain click on a tab a selection.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const beginDrag = usePaneDragStore((state) => state.beginDrag)
  const hoverPane = usePaneDragStore((state) => state.hoverPane)
  const clearHover = usePaneDragStore((state) => state.clearHover)
  const endDrag = usePaneDragStore((state) => state.endDrag)

  const handleDragStart = useCallback(
    (event: DragStartEvent) => beginDrag(String(event.active.id)),
    [beginDrag],
  )

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const over = event.over
      if (!over) {
        clearHover()
        return
      }

      const pointer = pointerFromDrag(event.activatorEvent, event.delta)
      if (!pointer) {
        clearHover()
        return
      }

      hoverPane(String(over.id), resolvePaneDropIntent({ pointer, rect: over.rect }))
    },
    [clearHover, hoverPane],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { intent, overPaneId } = usePaneDragStore.getState()
      const tabId = String(event.active.id)
      endDrag()

      if (!event.over || !overPaneId || !intent) return

      if (intent.kind === "merge") {
        onMoveTab(tabId, overPaneId)
        return
      }

      onSplitWithTab(tabId, overPaneId, intent.position)
    },
    [endDrag, onMoveTab, onSplitWithTab],
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      {children}
    </DndContext>
  )
}
