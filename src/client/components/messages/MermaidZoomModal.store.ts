import type { StateCreator } from "zustand"
import { createScopedStore } from "../../lib/createScopedStore"

const MIN_SCALE = 0.25
const MAX_SCALE = 8
const SCALE_STEP = 0.25

/** Pointer position at gesture start, already corrected for the current offset. */
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

  /** Step the zoom by one notch, clamped. No-op at the boundary. */
  zoomIn: () => void
  zoomOut: () => void
  /** Restore scale and offset together — one transition, not two writes. */
  resetView: () => void
  /** Anchor a pan gesture on the current offset. */
  beginDrag: (pointerX: number, pointerY: number) => void
  /** Move to an absolute offset derived from the anchor. No-op without one. */
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
