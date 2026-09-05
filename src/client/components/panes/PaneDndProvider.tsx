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


export interface PaneDndProviderProps {
  children: ReactNode
  onMoveTab: (tabId: string, toPaneId: string) => void
  onSplitWithTab: (tabId: string, paneId: string, position: SplitPosition) => void
}

function pointerFromDrag(activatorEvent: Event, delta: { x: number; y: number }) {
  if (!(activatorEvent instanceof MouseEvent)) return null
  return { x: activatorEvent.clientX + delta.x, y: activatorEvent.clientY + delta.y }
}

export function PaneDndProvider({ children, onMoveTab, onSplitWithTab }: PaneDndProviderProps) {
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
