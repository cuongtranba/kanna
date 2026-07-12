import { createScopedStore } from "../../lib/createScopedStore"

interface DragState {
  x: number
  y: number
}

interface OffsetState {
  x: number
  y: number
}

interface MermaidZoomModalState {
  scale: number
  offset: OffsetState
  drag: DragState | null
  setScale: (scale: number) => void
  setOffset: (offset: OffsetState) => void
  setDrag: (drag: DragState | null) => void
}

export const MermaidZoomModalStore = createScopedStore<void, MermaidZoomModalState>(
  "MermaidZoomModal",
  () => (set) => ({
    scale: 1,
    offset: { x: 0, y: 0 },
    drag: null,
    setScale: (scale) => set({ scale }),
    setOffset: (offset) => set({ offset }),
    setDrag: (drag) => set({ drag }),
  }),
)
