import type { StateCreator } from "zustand"
import { createScopedStore } from "../../lib/createScopedStore"

const MIN_SCALE = 0.25
const MAX_SCALE = 8
const SCALE_STEP = 0.25

interface DragState {
  x: number
  y: number
}

interface OffsetState {
  x: number
  y: number
}

export interface MermaidZoomModalState {
  scale: number
  offset: OffsetState
  drag: DragState | null

  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  beginDrag: (pointerX: number, pointerY: number) => void
  dragTo: (pointerX: number, pointerY: number) => void
  endDrag: () => void
}

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function createMermaidZoomModalState(): StateCreator<MermaidZoomModalState> {
  return (set) => ({
    scale: 1,
    offset: { x: 0, y: 0 },
    drag: null,

    zoomIn: () =>
      set((state) => {
        const scale = clampScale(state.scale + SCALE_STEP)
        return scale === state.scale ? state : { scale }
      }),

    zoomOut: () =>
      set((state) => {
        const scale = clampScale(state.scale - SCALE_STEP)
        return scale === state.scale ? state : { scale }
      }),

    resetView: () => set({ scale: 1, offset: { x: 0, y: 0 } }),

    beginDrag: (pointerX, pointerY) =>
      set((state) => ({
        drag: { x: pointerX - state.offset.x, y: pointerY - state.offset.y },
      })),

    dragTo: (pointerX, pointerY) =>
      set((state) => {
        if (!state.drag) return state
        return { offset: { x: pointerX - state.drag.x, y: pointerY - state.drag.y } }
      }),

    endDrag: () => set({ drag: null }),
  })
}

export const MermaidZoomModalStore = createScopedStore<void, MermaidZoomModalState>(
  "MermaidZoomModal",
  createMermaidZoomModalState,
)
