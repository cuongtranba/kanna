import { createScopedStore } from "../../lib/createScopedStore"
import type { MermaidRepair } from "../../lib/mermaidRepair"

type RenderState =
  | { status: "loading" }
  // `repairs` is non-empty when mermaid rejected the authored source and
  // rendered a repaired copy instead — the UI must say so rather than pass the
  // corrected diagram off as what was written.
  | { status: "ready"; svg: string; repairs: readonly MermaidRepair[] }
  // `kind: "stale-chunk"` means the mermaid bundle itself could not be fetched
  // because the tab is older than the deployed build — recoverable by reloading,
  // and not the diagram author's fault.
  | { status: "error"; message?: string; kind?: "stale-chunk" }

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
