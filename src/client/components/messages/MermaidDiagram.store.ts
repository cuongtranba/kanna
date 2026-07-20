import { createScopedStore } from "../../lib/createScopedStore"

type RenderState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message?: string }

interface MermaidDiagramState {
  renderState: RenderState
  showSource: boolean
  zoomOpen: boolean
  copied: boolean
  setRenderState: (renderState: RenderState) => void
  setShowSource: (showSource: boolean) => void
  setZoomOpen: (zoomOpen: boolean) => void
  setCopied: (copied: boolean) => void
}

export const MermaidDiagramStore = createScopedStore<void, MermaidDiagramState>(
  "MermaidDiagram",
  () => (set) => ({
    renderState: { status: "loading" },
    showSource: false,
    zoomOpen: false,
    copied: false,
    setRenderState: (renderState) => set({ renderState }),
    setShowSource: (showSource) => set({ showSource }),
    setZoomOpen: (zoomOpen) => set({ zoomOpen }),
    setCopied: (copied) => set({ copied }),
  }),
)
