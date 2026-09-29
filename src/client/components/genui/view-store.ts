import type { FileProbeResult } from "../../api/files"
import { createScopedStore } from "../../lib/createScopedStore"

export interface PendingAgentMessage {
  headline: string
  message: string
}

export interface GenUIViewState {
  pendingAgentMessage: PendingAgentMessage | null
  previewPath: string | null
  previewProbe: FileProbeResult | null
  refreshNonce: Readonly<Record<string, number>>
  notice: string | null
  proposeAgentMessage: (pending: PendingAgentMessage) => void
  cancelAgentMessage: () => void
  openPreview: (path: string) => void
  closePreview: () => void
  setPreviewProbe: (probe: FileProbeResult | null) => void
  refreshDataset: (datasetId: string) => void
  showNotice: (notice: string | null) => void
}

export const GenUIViewStore = createScopedStore<void, GenUIViewState>("GenUIView", () => (set) => ({
  pendingAgentMessage: null,
  previewPath: null,
  previewProbe: null,
  refreshNonce: {},
  notice: null,
  proposeAgentMessage: (pending) => set({ pendingAgentMessage: pending, notice: null }),
  cancelAgentMessage: () => set({ pendingAgentMessage: null }),
  openPreview: (path) => set({ previewPath: path, previewProbe: null }),
  closePreview: () => set({ previewPath: null, previewProbe: null }),
  setPreviewProbe: (previewProbe) => set({ previewProbe }),
  refreshDataset: (datasetId) => set((state) => ({
    refreshNonce: { ...state.refreshNonce, [datasetId]: (state.refreshNonce[datasetId] ?? 0) + 1 },
  })),
  showNotice: (notice) => set({ notice }),
}))
